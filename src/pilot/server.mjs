// S2.1 이어온 실증 서버(loopback 한정). 웹/외부 앱 API와 PC 연결부 API를 한 프로세스에서 제공한다.
// 사용: node src/pilot/server.mjs <configPath>
// 토큰 원문은 설정에 두지 않고 sha256만 둔다. body·header의 user_id·thread·경로는 신뢰하지 않는다.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { loadNewSessionsConfig, removeWorkspace } from './new-sessions.mjs';
import { botAppId, tokenEnvNames } from './bots.mjs';

const MAX_QUESTION = 8000;
const DEVICE_FRESH_MS = 30000;
const WEB_PAGE = fileURLToPath(new URL('./web/index.html', import.meta.url));

const sha = (s) => createHash('sha256').update(s).digest();
const matchToken = (header, entries) => {
  const raw = (header ?? '').replace(/^Bearer /, '');
  if (!raw) return null;
  const got = sha(raw);
  return entries.find((e) => timingSafeEqual(got, Buffer.from(e.tokenSha256, 'hex'))) ?? null;
};
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
async function readJson(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 32 * 1024) throw Object.assign(new Error('too_large'), { http: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('bad_json'), { http: 400 }); }
}

export function createApp(config) {
  const store = openStore(config.dbPath);
  for (const b of config.bindings) store.addBinding(b);
  store.ensureDefaultBots();
  // 메신저 프로세스가 보고한 봇 상태(토큰 있음·연결됨·실제 봇 이름). 토큰 값은 받지 않는다. 키 "<메신저>:<봇ID>".
  const botStatus = new Map();
  // 새 세션 만들기: server.json의 newSessionsConfigPath가 있으면 동시 실행 한도를 걸고 1분마다 정리(잠들기·보관)를 돌린다.
  const nsCfg = config.newSessionsConfigPath && existsSync(config.newSessionsConfigPath)
    ? loadNewSessionsConfig(JSON.parse(readFileSync(config.newSessionsConfigPath, 'utf8'))) : null;
  const notices = []; // 보관 예고. 각 항목에 at(알린 시각)을 붙이고 GET /v1/sessions/notices?after=로 가져간다.
  // 새 세션을 만들 PC: newSessionsHostId가 없으면 첫 번째 연결부(PC).
  const nsHost = config.newSessionsHostId ?? config.devices?.[0]?.hostId;
  const VIA = { app_web: 'web', app_messenger: 'chat' };
  let cleanupTimer = null;
  if (nsCfg?.enabled) {
    store.configureNewSessions(nsCfg);
    const cleanup = () => {
      const r = store.runCleanup(nsCfg);
      const at = new Date().toISOString();
      notices.push(...r.notices.map((n) => ({ ...n, at })));
      if (notices.length > 200) notices.splice(0, notices.length - 200);
      for (const c of r.changes) process.stderr.write(JSON.stringify({ ch: 'server', event: 'session_cleanup', name: c.name, from: c.from, to: c.to }) + '\n');
    };
    cleanupTimer = setInterval(cleanup, config.cleanupIntervalMs ?? 60000);
    cleanupTimer.unref();
  }
  const labels = Object.fromEntries(config.bindings.map((b) => [b.conversationId, b.label ?? b.conversationId]));
  const lastSeen = new Map();
  const online = (hostId) => Date.now() - (lastSeen.get(hostId) ?? 0) < DEVICE_FRESH_MS;
  const health = new Map();
  // 엔진이 준비됐는지: 연결부가 보고한 상태 기준. 모르면 undefined(막지 않음).
  const engineReady = (c) => {
    const h = health.get(c.hostId);
    if (!h || !online(c.hostId)) return undefined;
    if (c.engine === 'claude_channel') return h.claudeChannel === 'up';
    if (c.engine === 'codex_thread' && c.connectMode === 'shared_server') return h.codexShared === 'up';
    return true;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;

      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(WEB_PAGE));
      }

      // --- PC 연결부 API ---
      if (path.startsWith('/v1/device/')) {
        const device = matchToken(req.headers.authorization, config.devices);
        if (!device) return json(res, 401, { error: 'unauthorized' });
        lastSeen.set(device.hostId, Date.now());
        try {
          const h = JSON.parse(req.headers['x-ieon-health'] ?? 'null');
          if (h && typeof h === 'object') health.set(device.hostId, { codexShared: String(h.codexShared), claudeChannel: String(h.claudeChannel) });
        } catch { /* 형식이 틀린 상태 보고는 무시한다 */ }
        if (req.method === 'GET' && path === '/v1/device/jobs') {
          const job = store.claim(device.hostId);
          return job ? json(res, 200, job) : json(res, 204);
        }
        const m = path.match(/^\/v1\/device\/jobs\/([\w-]+)\/result$/);
        if (req.method === 'POST' && m) {
          const updated = store.report(device.hostId, m[1], await readJson(req));
          return updated ? json(res, 200, { status: updated.status }) : json(res, 409, { error: 'not_reportable' });
        }
        return json(res, 404, { error: 'not_found' });
      }

      // --- 사용자(웹·외부 앱) API ---
      if (!path.startsWith('/v1/')) return json(res, 404, { error: 'not_found' });
      const user = matchToken(req.headers.authorization, config.users);
      if (!user) return json(res, 401, { error: 'unauthorized' });
      const principal = { userId: user.userId, appId: user.appId };
      // 여러 봇: 메신저 토큰으로 온 요청이 x-ieon-bot: <메신저>:<봇ID>를 붙이면, 웹에 정의돼 있고 켜진 봇일 때만
      // 그 봇의 앱 ID로 처리한다. default 봇은 기존 app_messenger 그대로다. 정의 없는 봇은 거절한다.
      const botHeader = req.headers['x-ieon-bot'];
      if (botHeader !== undefined) {
        const [platform, botId] = String(botHeader).split(':');
        const bot = user.appId === 'app_messenger' && store.bot(platform, botId);
        if (!bot || !bot.enabled) return json(res, 403, { error: 'unknown_bot' });
        principal.appId = botAppId(platform, botId);
        principal.bot = { platform, botId };
      }

      // --- 봇 관리(웹 사용자만) ---
      if (path.startsWith('/v1/admin/')) {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        if (req.method === 'GET' && path === '/v1/admin/roles') return json(res, 200, { roles: store.listRoles() });
        if (req.method === 'GET' && path === '/v1/admin/bots') {
          return json(res, 200, { bots: store.listBots().map((b) => ({ ...b, appId: botAppId(b.platform, b.botId),
            sessions: store.botSessions(b.platform, b.botId), envNames: tokenEnvNames(b.platform, b.botId),
            status: botStatus.get(`${b.platform}:${b.botId}`) ?? null })) });
        }
        // 봇 관리 화면에서 고를 기존 세션 목록(웹 사용자가 볼 수 있는 것 = 모든 등록 세션 중 소유자 것)
        if (req.method === 'GET' && path === '/v1/admin/sessions') {
          return json(res, 200, { sessions: store.conversations(principal).map((c) => ({ conversationId: c.conversationId,
            label: labels[c.conversationId] ?? c.newSession?.name ?? c.conversationId, engine: c.engine, newSession: Boolean(c.newSession) })) });
        }
        const role = path.match(/^\/v1\/admin\/roles\/([\w-]+)$/);
        if (role && req.method === 'PUT') {
          const r = store.saveRole({ ...(await readJson(req)), roleId: role[1] });
          return r.http === 200 ? json(res, 200, r.role) : json(res, r.http, { error: r.code });
        }
        if (role && req.method === 'DELETE') {
          const r = store.deleteRole(role[1]);
          return r.http === 204 ? json(res, 204) : json(res, r.http, { error: r.code });
        }
        const bot = path.match(/^\/v1\/admin\/bots\/(\w+)\/([\w-]+)$/);
        if (bot && req.method === 'PUT') {
          const body = await readJson(req);
          const r = store.saveBot({ ...body, platform: bot[1], botId: bot[2] });
          if (r.http !== 200) return json(res, r.http, { error: r.code, ...(r.callName ? { callName: r.callName, botId: r.botId } : {}) });
          // sessions가 있으면 그 봇이 볼 수 있는 기존 세션 목록을 바꾼다(없으면 그대로).
          if (body.sessions !== undefined) {
            const g = store.setBotSessions(bot[1], bot[2], body.sessions);
            if (g.http !== 200) return json(res, g.http, { error: g.code });
          }
          return json(res, 200, { ...r.bot, sessions: store.botSessions(bot[1], bot[2]) });
        }
        if (bot && req.method === 'DELETE') {
          const r = store.deleteBot(bot[1], bot[2]);
          if (r.http === 204) botStatus.delete(`${bot[1]}:${bot[2]}`);
          return r.http === 204 ? json(res, 204) : json(res, r.http, { error: r.code });
        }
        return json(res, 404, { error: 'not_found' });
      }

      // --- 메신저 프로세스용: 봇 정의 받기·상태 보고(봇 헤더 없이 메신저 토큰으로만) ---
      if (path.startsWith('/v1/messenger/')) {
        if (user.appId !== 'app_messenger' || principal.bot) return json(res, 403, { error: 'messenger_only' });
        if (req.method === 'GET' && path === '/v1/messenger/bots') {
          const roles = Object.fromEntries(store.listRoles().map((r) => [r.roleId, r]));
          return json(res, 200, { bots: store.listBots().filter((b) => b.enabled).map((b) => ({ ...b, role: roles[b.roleId] ?? null })) });
        }
        if (req.method === 'POST' && path === '/v1/messenger/bots/status') {
          const body = await readJson(req);
          for (const s of Array.isArray(body.bots) ? body.bots.slice(0, 200) : []) {
            if (!store.bot(s.platform, s.botId)) continue;
            botStatus.set(`${s.platform}:${s.botId}`, { state: String(s.state ?? '').slice(0, 40),
              missing: Array.isArray(s.missing) ? s.missing.map(String).slice(0, 4) : [],
              username: s.username ? String(s.username).slice(0, 80) : null,
              canReadAll: typeof s.canReadAll === 'boolean' ? s.canReadAll : null, at: new Date().toISOString() });
          }
          return json(res, 204);
        }
        return json(res, 404, { error: 'not_found' });
      }

      if (req.method === 'GET' && path === '/v1/conversations') {
        return json(res, 200, { conversations: store.conversations(principal).map((c) => ({
          conversationId: c.conversationId, label: labels[c.conversationId] ?? c.newSession?.name ?? c.conversationId, engine: c.engine,
          deviceOnline: online(c.hostId), busy: c.busy, ...(c.connectMode ? { connectMode: c.connectMode } : {}),
          ...(c.heldBy ? { heldBy: c.heldBy } : {}),
          ...(c.newSession ? { newSession: c.newSession } : {}),
          ...(engineReady(c) === undefined ? {} : { engineReady: engineReady(c) }),
        })) });
      }
      // --- 새 세션 만들기(설계 NEW_SESSIONS) ---
      if (path === '/v1/sessions' || path.startsWith('/v1/sessions/')) {
        if (!nsCfg?.enabled) return json(res, 403, { error: 'new_sessions_disabled' });
        if (req.method === 'POST' && path === '/v1/sessions') {
          const body = await readJson(req);
          const r = store.createSession(principal, { engine: body.engine, name: body.name, profile: body.profile,
            hostId: nsHost, via: VIA[principal.appId] ?? 'api' }, nsCfg);
          return r.http === 201 ? json(res, 201, { conversationId: r.conversationId, name: r.name, engine: r.engine, profile: r.profile })
            : json(res, r.http, { error: r.code, ...(r.limit ? { limit: r.limit } : {}) });
        }
        if (req.method === 'GET' && path === '/v1/sessions/limits') return json(res, 200, store.sessionLimits(nsCfg, nsHost));
        if (req.method === 'GET' && path === '/v1/sessions/notices') {
          const after = url.searchParams.get('after') ?? '';
          const mine = new Set(store.conversations(principal).map((c) => c.conversationId));
          return json(res, 200, { notices: notices.filter((n) => n.at > after && mine.has(n.conversationId)) });
        }
        const a = path.match(/^\/v1\/sessions\/([\w-]+)\/(sleep|restore)$/);
        if (req.method === 'POST' && a) {
          const r = a[2] === 'sleep' ? store.sleepSession(principal, a[1]) : store.restoreSession(principal, a[1], nsCfg);
          return r.http === 200 ? json(res, 200, { conversationId: r.conversationId, state: r.state })
            : json(res, r.http, { error: r.code, ...(r.limit ? { limit: r.limit } : {}) });
        }
        const d = path.match(/^\/v1\/sessions\/([\w-]+)$/);
        if (req.method === 'DELETE' && d) {
          const r = store.deleteSession(principal, d[1], { confirm: (await readJson(req)).confirm }, nsCfg);
          if (r.http !== 200) return json(res, r.http, { error: r.code });
          let workspaceRemoved = false;
          if (r.removeWorkspace) { removeWorkspace(nsCfg, r.name, r.workspace); workspaceRemoved = true; }
          return json(res, 200, { conversationId: r.conversationId, deleted: true, workspaceRemoved });
        }
        return json(res, 404, { error: 'not_found' });
      }
      let s = path.match(/^\/v1\/conversations\/([\w-]+)\/settings$/);
      if (req.method === 'PUT' && s) {
        const r = store.setConnectMode(principal, s[1], (await readJson(req)).connectMode);
        return r.http === 200 ? json(res, 200, { connectMode: r.connectMode }) : json(res, r.http, { error: r.code });
      }
      let m = path.match(/^\/v1\/conversations\/([\w-]+)\/requests$/);
      if (req.method === 'POST' && m) {
        const key = req.headers['idempotency-key'];
        const body = await readJson(req);
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!key || !/^[\w-]{8,64}$/.test(key) || !question || question.length > MAX_QUESTION) return json(res, 400, { error: 'bad_request' });
        const conv = store.conversations(principal).find((c) => c.conversationId === m[1]);
        if (!conv) return json(res, 404, { error: 'not_found' });
        if (!online(conv.hostId)) return json(res, 503, { error: 'device_unavailable' });
        if (engineReady(conv) === false) {
          return json(res, 503, { error: conv.engine === 'claude_channel' ? 'session_not_running' : 'shared_server_down' });
        }
        const r = store.submit(principal, m[1], key, { question });
        return r.http === 202 ? json(res, 202, { requestId: r.requestId }) : json(res, r.http, { error: r.code });
      }
      m = path.match(/^\/v1\/requests\/([\w-]+)\/review$/);
      if (req.method === 'POST' && m) {
        const r = store.resolveByReview(principal, m[1], (await readJson(req)).executed);
        return r.http === 200 ? json(res, 200, { requestId: r.requestId, status: r.status, errorCode: r.errorCode })
          : json(res, r.http, { error: r.code });
      }
      m = path.match(/^\/v1\/requests\/([\w-]+)$/);
      if (req.method === 'GET' && m) {
        const r = store.getRequest(principal, m[1]);
        return r ? json(res, 200, { requestId: r.requestId, status: r.status, errorCode: r.errorCode, answer: r.answer, usage: r.usage })
          : json(res, 404, { error: 'not_found' });
      }
      m = path.match(/^\/v1\/conversations\/([\w-]+)\/messages$/);
      if (m && req.method === 'GET') {
        const list = store.messages(principal, m[1]);
        return list ? json(res, 200, { messages: list }) : json(res, 404, { error: 'not_found' });
      }
      if (m && req.method === 'DELETE') {
        const r = store.deleteMessages(principal, m[1]);
        return r.http === 204 ? json(res, 204) : json(res, r.http, { error: r.code });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      return json(res, error.http ?? 500, { error: error.http ? error.message : 'internal' });
    }
  });

  // 기본은 127.0.0.1만 연다. 추가 주소는 Tailscale 주소(100.64.0.0/10)만 허용한다. 0.0.0.0·사설 LAN은 열지 않는다.
  const extra = [];
  // allowedClients가 있으면 그 Tailscale 기기 주소에서 온 접속만 받는다(예: 신산님 휴대폰).
  const listenExtra = (port, host, allowedClients) => {
    if (!isTailscaleAddress(host)) throw new Error(`listen_host_not_allowed:${host}`);
    const s2 = createServer((req, res) => {
      const from = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      if (allowedClients?.length && !allowedClients.includes(from)) { res.writeHead(403); return res.end(); }
      server.emit('request', req, res);
    });
    extra.push(s2);
    return new Promise((r, j) => { s2.once('error', j); s2.listen(port, host, () => r(`${host}:${port}`)); });
  };

  return {
    server, store, listenExtra, newSessions: nsCfg, notices,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise((r) => { clearInterval(cleanupTimer); extra.forEach((s2) => s2.close()); server.close(() => { store.close(); r(); }); }),
  };
}

export function isTailscaleAddress(host) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host ?? '');
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return false;
  return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const app = createApp(config);
  const port = await app.listen(config.port ?? 28760);
  process.stderr.write(`ieon pilot server: http://127.0.0.1:${port}\n`);
  for (const host of config.extraHosts ?? []) {
    process.stderr.write(`ieon pilot server: http://${await app.listenExtra(port, host, config.extraAllowedClients)}\n`);
  }
}
