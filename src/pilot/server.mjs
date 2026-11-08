// S2.1 이어온 실증 서버(loopback 한정). 웹/외부 앱 API와 PC 연결부 API를 한 프로세스에서 제공한다.
// 사용: node src/pilot/server.mjs <configPath>
// 토큰 원문은 설정에 두지 않고 sha256만 둔다. body·header의 user_id·thread·경로는 신뢰하지 않는다.
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { loadNewSessionsConfig, removeWorkspace } from './new-sessions.mjs';
import { botAppId, tokenEnvNames } from './bots.mjs';
import { validateAllowedUsers, validateKakao, validateNewSessionsWeb, mergeNewSessions, validateBinding } from './settings.mjs';
import { createWebAccess, isExemptPath, validateWebAccess } from './web-access.mjs';
import { createRelay } from '../relay/relay.mjs';
import { createWebAuth } from './web-auth.mjs';
import { readEnvFile, writeEnvValue, validSecretValue } from './secrets-file.mjs';
import { createPairing } from './pairing.mjs';
import { createHubLink } from './hub-link.mjs';
import { readDevice, setLive, upsertCodexThread, removeCodexThread, createLocalConnector } from './device-settings.mjs';
import { createCodexLogin } from './codex-login.mjs';
import { supervise } from '../hub/run.mjs';
import { dirname, join } from 'node:path';

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
  // P4: 허브 웹 접속 제한(설정 파일 webAccess). 없으면 지금처럼 127.0.0.1 전용 로컬 서버다.
  // W7: 허브는 접속 제한을 웹 "보안" 화면에서도 바꾼다(DB 값이 있으면 그 값). 믿는 앞단·Tailscale 수신 주소는 파일 값만 쓴다.
  let accessInner = null;
  const access = config.webAccess ? {
    get modes() { return accessInner.modes; },
    clientIp: (req) => accessInner.clientIp(req),
    check: (req) => accessInner.check(req),
  } : null;
  const mergeAccess = (web) => (web ? { ...config.webAccess, modes: web.modes, ipAllowlist: web.ipAllowlist ?? [], cloudflare: web.cloudflare ?? config.webAccess.cloudflare } : config.webAccess);
  // P5: 허브 내장 카카오 수신(중계와 같은 코드). 카카오가 허브의 /kakao/skill/<비밀>을 직접 부르고,
  // 같은 기계의 메신저가 127.0.0.1로 /pc/poll을 가져간다. 비밀 값은 main에서 비밀 파일로 읽어 넘긴다(설정 파일·로그에 없음).
  const relay = config.relay ? createRelay({
    pcToken: config.relay.pcToken, kakaoSecret: config.relay.kakaoSecret,
    clientIp: (req) => (access ? access.clientIp(req) : (req.socket.remoteAddress ?? '?')),
    log: (e) => process.stderr.write(JSON.stringify(e) + '\n'),
  }) : null;
  const store = openStore(config.dbPath);
  if (access) accessInner = createWebAccess(mergeAccess(store.getSetting('security.webAccess')?.value));
  // W1: 웹 로그인(쿠키). 사용자는 토큰을 다루지 않는다.
  const auth = createWebAuth({ store, config, access, clientIp: (req) => (access ? access.clientIp(req) : (req.socket.remoteAddress ?? '?')) });
  for (const b of config.bindings) store.addBinding(b);
  store.ensureDefaultBots();
  // 메신저 프로세스가 보고한 봇 상태(토큰 있음·연결됨·실제 봇 이름). 토큰 값은 받지 않는다. 키 "<메신저>:<봇ID>".
  const botStatus = new Map();
  // 새 세션 만들기: 파일(server.json의 newSessionsConfigPath) 값 위에 웹에서 바꾼 값(설정 표 newSessions)을 겹친다(P1).
  // 켜져 있으면 동시 실행 한도를 걸고 1분마다 정리(잠들기·보관)를 돌린다. 웹에서 바꾸면 바로 다시 읽는다.
  const nsFileRaw = config.newSessionsConfigPath && existsSync(config.newSessionsConfigPath)
    ? JSON.parse(readFileSync(config.newSessionsConfigPath, 'utf8')) : null;
  let nsCfg = null;
  const reloadNewSessions = () => {
    const web = store.getSetting('newSessions')?.value;
    nsCfg = nsFileRaw || web ? loadNewSessionsConfig(mergeNewSessions(nsFileRaw ?? {}, web ?? {})) : null;
    store.configureNewSessions(nsCfg?.enabled ? nsCfg : null);
  };
  reloadNewSessions();
  const notices = []; // 보관 예고. 각 항목에 at(알린 시각)을 붙이고 GET /v1/sessions/notices?after=로 가져간다.
  // 새 세션을 만들 PC: newSessionsHostId가 없으면 첫 번째 연결부(PC).
  const nsHost = config.newSessionsHostId ?? config.devices?.[0]?.hostId;
  const VIA = { app_web: 'web', app_messenger: 'chat' };
  let cleanupTimer = null;
  {
    const cleanup = () => {
      if (!nsCfg?.enabled) return;
      const r = store.runCleanup(nsCfg);
      const at = new Date().toISOString();
      notices.push(...r.notices.map((n) => ({ ...n, at })));
      if (notices.length > 200) notices.splice(0, notices.length - 200);
      for (const c of r.changes) process.stderr.write(JSON.stringify({ ch: 'server', event: 'session_cleanup', name: c.name, from: c.from, to: c.to }) + '\n');
    };
    cleanupTimer = setInterval(cleanup, config.cleanupIntervalMs ?? 60000);
    cleanupTimer.unref();
  }
  // 기존 세션의 표시 이름은 DB(파일 등록은 server.json의 label, 웹 등록은 웹에서 정한 이름)에서 읽는다.
  const labelOf = (c) => c.label ?? c.newSession?.name ?? c.conversationId;
  // 기기: server.json(파일) + 웹에서 등록한 기기(DB, 폐기되지 않은 것). P1-c
  const fileHosts = new Set((config.devices ?? []).map((d) => d.hostId));
  const knownHosts = () => [...new Set([...fileHosts, ...store.listDevices().filter((d) => !d.revokedAt).map((d) => d.hostId)])];
  const deviceEntries = () => [...(config.devices ?? []), ...store.activeDeviceHashes()];
  const newDeviceToken = () => { const token = randomBytes(32).toString('hex'); return { token, hash: createHash('sha256').update(token).digest('hex') }; };
  const lastTouched = new Map();
  // W2: 봇 토큰 비밀 파일(웹에서 입력만, 값은 다시 보여 주지 않음). 허브는 내장 수신 비밀 파일과 같은 파일을 쓴다.
  const secretsFile = config.secretsFile ?? config.relayEnvFile ?? null;
  // 허브 내장 카카오 수신이 쓰는 토큰은 시스템이 관리한다(웹에서 바꾸면 수신과 메신저가 어긋남).
  const internalSecret = (name) => Boolean(relay) && (name === 'KAKAO_RELAY_TOKEN' || /^KAKAO_BOT_.+_RELAY_TOKEN$/.test(name));
  const secretNames = () => store.listBots().flatMap((b) => Object.values(tokenEnvNames(b.platform, b.botId) ?? {})
    .map((name) => ({ name, platform: b.platform, botId: b.botId, internal: internalSecret(name) })));
  // W2: 허용 목록에 없는 사람이 보낸 최근 메시지(메신저가 알려 줌). 웹의 "이 사람 허용" 버튼에 쓴다. 메시지 내용은 받지 않는다.
  const denied = new Map();
  // W7: PC 완결형 공개 중계 — 주소는 웹 설정(카카오 중계 주소) 또는 메신저 설정 파일, 비밀 경로는 운영자가 둔 중계 비밀 파일.
  const pcRelay = () => {
    let url = store.getSetting('messenger.kakao')?.value?.relayUrl ?? null;
    if (!url && config.messengerConfigPath && existsSync(config.messengerConfigPath)) {
      try { url = JSON.parse(readFileSync(config.messengerConfigPath, 'utf8')).kakaoRelayUrl ?? null; } catch { url = null; }
    }
    const f = config.relaySecretsFile ?? join(dirname(config.dbPath), '..', 'relay', 'relay.secrets');
    const secret = readEnvFile(existsSync(f) ? f : null).IEON_RELAY_KAKAO_SECRET ?? null;
    return url ? { url: String(url).replace(/\/+$/, ''), secret } : null;
  };
  // W3: 짝맺기. 허브(접속 제한 있음)는 PC의 요청을 받아 승인하고, PC(접속 제한 없음)는 허브에 연결한다.
  const pairing = access ? createPairing({ store, reserved: () => fileHosts }) : null;
  const hubLink = access ? null : createHubLink({ dir: config.hubLinkDir ?? join(dirname(config.dbPath), 'hub'),
    connectorConfigPath: config.connectorConfigPath, log: (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n') });
  const ipOf = (req) => (access ? access.clientIp(req) : (req.socket.remoteAddress ?? '?'));
  // W4: 이 PC의 로컬 연결부를 서버가 띄운다(설정 manageLocalConnector). 기기 설정을 바꾸면 다시 띄운다.
  const localConnector = !access && config.manageLocalConnector && config.connectorConfigPath
    ? createLocalConnector({ connectorConfigPath: config.connectorConfigPath, log: (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n') }) : null;
  // W5: 허브 웹의 Codex 로그인(기기 코드). 허브에만 있다(PC는 그 PC의 Codex 앱 로그인을 그대로 쓴다).
  const codexLogin = access ? (config.codexLogin ?? createCodexLogin({ log: (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n') })) : null;
  const localDirect = (req) => !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
  // 기기 설정이 바뀌면 그 설정을 읽는 연결부를 다시 띄운다. 이 서버가 띄운 것이 아니면 다시 켜야 한다고 알린다.
  const applyDevice = async () => {
    let restarted = false;
    if (localConnector?.running()) { await localConnector.restart(); restarted = true; }
    if (hubLink?.hubMode()) { hubLink.disconnect(); hubLink.reconnect(); restarted = true; }
    return { restarted, restartRequired: !restarted };
  };
  // P3: 기기 API 요청 횟수 제한(1분 창). 인증된 기기는 기기별, 인증 실패는 접속 주소별로 센다.
  // 유효한 토큰은 실패 횟수와 상관없이 먼저 확인하므로, 같은 앞단(NPM) 뒤의 정상 기기는 막히지 않는다.
  const rate = { perMinute: config.deviceRateLimit?.perMinute ?? 240, failPerMinute: config.deviceRateLimit?.failPerMinute ?? 30 };
  const windows = new Map();
  const overLimit = (key, limit) => {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || now - w.start >= 60000) { w = { start: now, n: 0 }; windows.set(key, w); }
    w.n += 1;
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start >= 60000) windows.delete(k);
    return w.n > limit ? Math.ceil((w.start + 60000 - now) / 1000) : 0;
  };
  const tooMany = (res, retry) => { res.setHeader('retry-after', String(Math.max(1, retry))); return json(res, 429, { error: 'rate_limited' }); };
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

      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      // P4: 접속 제한. 예외 경로(기기 API·카카오·Teams·health)는 각자 토큰·서명으로 인증한다.
      // 앞단 없이 이 PC의 127.0.0.1로 직접 온 요청(SSH 터널 관리)은 통과시킨다.
      if (access && !isExemptPath(path)) {
        const peer = req.socket.remoteAddress ?? '';
        const direct = !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && !req.headers['x-forwarded-for'];
        if (!direct && !(await access.check(req))) return json(res, 403, { error: 'access_denied' });
      }
      // P5: 내장 중계. /kakao/*는 접속 제한 예외(비밀 경로·요청 횟수 제한), /pc/poll은 제한 대상이라 사실상 이 기계 안에서만.
      if (relay && (path.startsWith('/kakao/') || path === '/pc/poll')) return relay.handler(req, res);
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(WEB_PAGE));
      }

      // --- PC 연결부 API ---
      if (path.startsWith('/v1/device/')) {
        const device = matchToken(req.headers.authorization, deviceEntries());
        if (!device) {
          const retry = overLimit('fail:' + (access ? access.clientIp(req) : (req.socket.remoteAddress ?? '')), rate.failPerMinute);
          return retry ? tooMany(res, retry) : json(res, 401, { error: 'unauthorized' });
        }
        const retry = overLimit('dev:' + device.hostId, rate.perMinute);
        if (retry) return tooMany(res, retry);
        lastSeen.set(device.hostId, Date.now());
        // 웹 등록 기기는 마지막 접속 시각을 DB에도 남긴다(1분에 한 번만 쓴다).
        if (!fileHosts.has(device.hostId) && Date.now() - (lastTouched.get(device.hostId) ?? 0) > 60000) {
          lastTouched.set(device.hostId, Date.now());
          store.touchDevice(device.hostId, new Date().toISOString());
        }
        try {
          const h = JSON.parse(req.headers['x-ieon-health'] ?? 'null');
          if (h && typeof h === 'object') health.set(device.hostId, { codexShared: String(h.codexShared), claudeChannel: String(h.claudeChannel) });
        } catch { /* 형식이 틀린 상태 보고는 무시한다 */ }
        // W3: 이 PC가 허브에 연결돼 있으면 이 PC 서버는 작업을 내주지 않는다(한 PC가 두 서버의 질문을 함께 실행하지 않게).
        if (req.method === 'GET' && path === '/v1/device/jobs' && hubLink?.hubMode()) return json(res, 204);
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

      // --- W3: 짝맺기(허브). PC가 부른다. 토큰은 관리자 승인 뒤 그 PC에 한 번만 간다. ---
      if (pairing && req.method === 'POST' && (path === '/v1/pair/start' || path === '/v1/pair/poll')) {
        const retry = overLimit(`pair:${path}:${ipOf(req)}`, path === '/v1/pair/start' ? 10 : 60);
        if (retry) return tooMany(res, retry);
        const body = await readJson(req);
        const r = path === '/v1/pair/start' ? pairing.start({ name: body.name, from: ipOf(req) }) : pairing.poll(body.pairId);
        if (r.error) return json(res, r.http, { error: r.error });
        if (path === '/v1/pair/start') process.stderr.write(JSON.stringify({ ch: 'server', event: 'pair_requested', from: ipOf(req) }) + '\n');
        return json(res, r.http, r.body);
      }

      // --- 사용자(웹·외부 앱) API ---
      if (!path.startsWith('/v1/')) return json(res, 404, { error: 'not_found' });
      if (await auth.handle(req, res, path, { json, readJson })) return;
      let user = matchToken(req.headers.authorization, config.users);
      if (!user) {
        const p = auth.principal(req);
        if (p?.error) return json(res, 403, { error: p.error });
        user = p;
      }
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
      if (path.startsWith('/v1/admin/') && !path.startsWith('/v1/admin/settings')) {
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
            label: labelOf(c), engine: c.engine, newSession: Boolean(c.newSession) })) });
        }
        // W3: 허브 기기 화면의 연결 요청(짝맺기) 승인·거절
        if (req.method === 'GET' && path === '/v1/admin/pairings') return json(res, 200, { pairings: pairing ? pairing.pending() : [] });
        const pr = path.match(/^\/v1\/admin\/pairings\/([\w-]{6,64})\/(approve|reject)$/);
        if (pr && req.method === 'POST') {
          if (!pairing) return json(res, 404, { error: 'not_found' });
          const r = pr[2] === 'approve' ? await (async () => { const b = await readJson(req); return pairing.approve(pr[1], b.code, principal.userId, b.replaceHostId || null); })() : pairing.reject(pr[1]);
          if (r.error) return json(res, r.http, { error: r.error });
          process.stderr.write(JSON.stringify({ ch: 'server', event: `pair_${pr[2]}d`, hostId: r.body?.hostId ?? null }) + '\n');
          return json(res, r.http, r.body);
        }
        // W7: 허브 보안(접속 제한). 지금 접속한 곳이 막히는 변경과 방식이 하나도 없는 변경은 거절한다(잠김·무방비 방지).
        if (path === '/v1/admin/security') {
          if (!access) return json(res, 404, { error: 'not_found' });
          const cur = store.getSetting('security.webAccess');
          const view = () => { const w = mergeAccess(store.getSetting('security.webAccess')?.value);
            return { modes: w.modes, ipAllowlist: w.ipAllowlist ?? [], cloudflare: w.cloudflare ?? null, source: store.getSetting('security.webAccess') ? 'web' : 'file', yourIp: access.clientIp(req) }; };
          if (req.method === 'GET') return json(res, 200, view());
          if (req.method === 'PUT' || req.method === 'DELETE') {
            let web = null;
            if (req.method === 'PUT') {
              const b = await readJson(req);
              web = { modes: Array.isArray(b.modes) ? b.modes.map(String) : [], ipAllowlist: Array.isArray(b.ipAllowlist) ? b.ipAllowlist.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : [],
                ...(b.cloudflare ? { cloudflare: { teamDomain: String(b.cloudflare.teamDomain ?? '').trim(), aud: String(b.cloudflare.aud ?? '').trim() } } : {}) };
              if (!web.modes.length) return json(res, 400, { error: 'closed_not_allowed' });
            }
            let candidate;
            try { candidate = createWebAccess(validateWebAccess(mergeAccess(web))); } catch (e) { return json(res, 400, { error: e.message }); }
            if (!(await candidate.check(req))) return json(res, 409, { error: 'would_lock_out' });
            if (web) store.setSetting('security.webAccess', web); else if (cur) store.deleteSetting('security.webAccess');
            accessInner = candidate;
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'security_changed', modes: candidate.modes }) + '\n');
            return json(res, 200, view());
          }
          return json(res, 404, { error: 'not_found' });
        }
        // 허브 자신의 연결부(허브 새 세션 전용) 실제 실행 스위치. 신산님 결정(2026-11-08): 허브는 로컬 화면이 없으므로 허브 웹에서 켜고 끈다.
        // PC의 안전 설정은 여전히 허브에서 바꿀 수 없다. 허브 연결부는 설정 파일이 바뀌면 다시 시작한다.
        if (path === '/v1/admin/hub/engine') {
          const cfgPath = config.connectorConfigPath ?? join(dirname(config.dbPath), 'connector.json');
          if (!access || !existsSync(cfgPath)) return json(res, 404, { error: 'not_found' });
          if (req.method === 'GET') return json(res, 200, { live: readDevice(cfgPath).live });
          if (req.method === 'PUT') {
            const live = (await readJson(req)).live;
            setLive(cfgPath, live);
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'hub_engine_live', live }) + '\n');
            return json(res, 200, { live });
          }
          return json(res, 404, { error: 'not_found' });
        }
        // W5: 허브 Codex 로그인
        if (path.startsWith('/v1/admin/codex')) {
          if (!codexLogin) return json(res, 404, { error: 'not_found' });
          if (req.method === 'GET' && path === '/v1/admin/codex') return json(res, 200, { login: await codexLogin.status(), job: codexLogin.view() });
          if (req.method === 'POST' && path === '/v1/admin/codex/login') return json(res, 200, codexLogin.start());
          if (req.method === 'POST' && path === '/v1/admin/codex/login/cancel') return json(res, 200, codexLogin.cancel());
          return json(res, 404, { error: 'not_found' });
        }
        // W4: 이 PC의 기기 설정(실제 실행·Codex 허용 목록·연결 방식·작업 폴더). 허브 웹에는 없다. 바꾸는 것은 이 PC에서 연 화면만.
        if (path.startsWith('/v1/admin/local/device')) {
          if (access) return json(res, 404, { error: 'not_found' });
          const cfgPath = config.connectorConfigPath;
          if (!cfgPath || !existsSync(cfgPath)) return json(res, 404, { error: 'no_connector_config' });
          if (req.method === 'GET' && path === '/v1/admin/local/device') {
            return json(res, 200, { ...readDevice(cfgPath), managed: Boolean(localConnector), running: localConnector?.running() ?? null });
          }
          if (!localDirect(req)) return json(res, 403, { error: 'local_only' });
          if (req.method === 'PUT' && path === '/v1/admin/local/device/live') {
            const live = (await readJson(req)).live;
            setLive(cfgPath, live);
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'device_live', live }) + '\n');
            return json(res, 200, { live, ...(await applyDevice()) });
          }
          const ct = path.match(/^\/v1\/admin\/local\/device\/codex\/([0-9a-fA-F-]{36})$/);
          if (ct && req.method === 'PUT') {
            upsertCodexThread(cfgPath, { threadId: ct[1], ...(await readJson(req)) });
            return json(res, 200, { ...readDevice(cfgPath), ...(await applyDevice()) });
          }
          if (ct && req.method === 'DELETE') {
            if (!removeCodexThread(cfgPath, ct[1])) return json(res, 404, { error: 'not_found' });
            return json(res, 200, { ...readDevice(cfgPath), ...(await applyDevice()) });
          }
          return json(res, 404, { error: 'not_found' });
        }
        // W3: 이 PC를 허브에 연결(PC 로컬 웹만)
        if (path.startsWith('/v1/admin/local/hub')) {
          if (!hubLink) return json(res, 404, { error: 'not_found' });
          if (req.method === 'GET' && path === '/v1/admin/local/hub') return json(res, 200, hubLink.status());
          if (req.method === 'POST' && path === '/v1/admin/local/hub/connect') {
            const body = await readJson(req);
            try { return json(res, 200, await hubLink.connect({ hubUrl: body.hubUrl, name: body.name })); } catch (e) { return json(res, e.http ?? 400, { error: e.message }); }
          }
          if (req.method === 'POST' && path === '/v1/admin/local/hub/disconnect') return json(res, 200, hubLink.disconnect({ forget: (await readJson(req)).forget === true }));
          if (req.method === 'POST' && path === '/v1/admin/local/hub/reconnect') return json(res, 200, { connector: hubLink.reconnect() });
          return json(res, 404, { error: 'not_found' });
        }
        // W2: 봇 토큰 입력(쓰기 전용). 정의된 봇의 토큰 이름만 받는다.
        if (req.method === 'GET' && path === '/v1/admin/secrets') {
          const env = readEnvFile(secretsFile);
          return json(res, 200, { configured: Boolean(secretsFile), names: secretNames().map((s) => ({ ...s, present: Boolean(env[s.name]) })) });
        }
        const sec = path.match(/^\/v1\/admin\/secrets\/([A-Z][A-Z0-9_]{1,80})$/);
        if (sec && ['PUT', 'DELETE'].includes(req.method)) {
          if (!secretsFile) return json(res, 409, { error: 'secrets_not_configured' });
          const s = secretNames().find((x) => x.name === sec[1]);
          if (!s) return json(res, 404, { error: 'unknown_secret' });
          if (s.internal) return json(res, 409, { error: 'internal_secret' });
          const value = req.method === 'PUT' ? (await readJson(req)).value : null;
          if (value !== null && !validSecretValue(value)) return json(res, 400, { error: 'bad_secret_value' });
          writeEnvValue(secretsFile, s.name, value);
          process.stderr.write(JSON.stringify({ ch: 'server', event: value === null ? 'secret_deleted' : 'secret_saved', name: s.name }) + '\n');
          return json(res, 200, { name: s.name, present: value !== null });
        }
        // W2: 카카오 스킬 URL(허브 내장 수신). 오픈빌더에 붙일 주소를 복사할 수 있게 준다.
        if (req.method === 'GET' && path === '/v1/admin/kakao/skill-url') {
          // W7: PC 완결형 — 운영자가 배포한 공개 중계의 비밀 파일(PC에 있음)로 주소를 만든다. 사용자는 값을 다루지 않는다.
          if (!relay) {
            const k = pcRelay();
            return k?.secret && k.url ? json(res, 200, { url: `${k.url}/kakao/skill/${k.secret}`, relay: 'public' }) : json(res, 404, { error: 'no_kakao_relay' });
          }
          const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
          const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
          const base = config.publicUrl ?? `${proto}://${host}`;
          return json(res, 200, { url: `${base}/kakao/skill/${config.relay.kakaoSecret}` });
        }
        // W7: PC 완결형 공개 중계 연결 상태(중계 /health의 pc 값)
        if (req.method === 'GET' && path === '/v1/admin/kakao/relay-status') {
          const k = relay ? null : pcRelay();
          if (!k?.url) return json(res, 404, { error: 'no_kakao_relay' });
          try {
            const h = await (await fetch(`${k.url}/health`, { signal: AbortSignal.timeout(5000) })).json();
            return json(res, 200, { url: k.url, reachable: true, pcConnected: Boolean(h.pc) });
          } catch { return json(res, 200, { url: k.url, reachable: false, pcConnected: false }); }
        }
        // W2: 허용 목록에 없던 사람 → 그 봇의 추가 허용 사용자로 넣는다(ID를 옮겨 적지 않음).
        if (req.method === 'GET' && path === '/v1/admin/denied') {
          const cut = Date.now() - 24 * 3600_000;
          for (const [k, v] of denied) if (v.atMs < cut) denied.delete(k);
          return json(res, 200, { denied: [...denied.values()].map(({ atMs, ...v }) => v) });
        }
        if (req.method === 'POST' && path === '/v1/admin/denied/allow') {
          const body = await readJson(req);
          const key = `${body.platform}:${body.botId}:${body.userId}`;
          const d = denied.get(key);
          if (!d) return json(res, 404, { error: 'not_found' });
          const b = store.bot(d.platform, d.botId);
          if (!b) return json(res, 404, { error: 'unknown_bot' });
          const r = store.saveBot({ platform: b.platform, botId: b.botId, name: b.name, roleId: b.roleId, callNames: b.callNames,
            extraUsers: [...new Set([...(b.extraUsers ?? []), d.userId])], enabled: b.enabled });
          if (r.http !== 200) return json(res, r.http, { error: r.code });
          denied.delete(key);
          return json(res, 200, { allowed: true });
        }
        // P1-c: 기기 목록·등록·재발급·폐기. 새 토큰은 응답에 한 번만 담고 서버에는 해시만 둔다.
        if (req.method === 'GET' && path === '/v1/admin/devices') {
          const web = store.listDevices();
          return json(res, 200, { devices: [
            ...[...fileHosts].map((h) => ({ hostId: h, name: h, source: 'file', online: online(h) })),
            ...web.map((d) => ({ ...d, source: 'web', online: !d.revokedAt && online(d.hostId) })),
          ], events: store.deviceEvents() });
        }
        if (req.method === 'POST' && path === '/v1/admin/devices') {
          const body = await readJson(req);
          const hostId = String(body.hostId ?? ''); const name = String(body.name ?? '').trim();
          if (!/^h_[a-z0-9_-]{1,40}$/.test(hostId)) return json(res, 400, { error: 'bad_host_id' });
          if (!name || name.length > 40) return json(res, 400, { error: 'bad_name' });
          if (fileHosts.has(hostId)) return json(res, 409, { error: 'host_taken' });
          const t = newDeviceToken();
          const r = store.addDevice(hostId, name, t.hash, principal.userId);
          return r.http === 201 ? json(res, 201, { hostId, name, token: t.token }) : json(res, r.http, { error: r.code });
        }
        const dv = path.match(/^\/v1\/admin\/devices\/([\w-]+)\/(reissue|revoke)$/);
        if (dv && req.method === 'POST') {
          if (fileHosts.has(dv[1])) return json(res, 409, { error: 'file_managed' });
          if (dv[2] === 'reissue') {
            const t = newDeviceToken();
            const r = store.reissueDevice(dv[1], t.hash, principal.userId);
            return r.http === 200 ? json(res, 200, { hostId: dv[1], token: t.token }) : json(res, r.http, { error: r.code });
          }
          const r = store.revokeDevice(dv[1], (await readJson(req)).confirm, principal.userId);
          if (r.http === 200) lastSeen.delete(dv[1]);
          return r.http === 200 ? json(res, 200, { hostId: dv[1], revoked: true, unknown: r.unknown, notExecuted: r.notExecuted }) : json(res, r.http, { error: r.code });
        }
        // P1-b: 기존 세션 등록(파일 등록은 보기만, 웹 등록은 추가·수정·삭제)
        if (req.method === 'GET' && path === '/v1/admin/bindings') return json(res, 200, { bindings: store.listBindings(), hosts: knownHosts() });
        const bd = path.match(/^\/v1\/admin\/bindings\/([\w-]+)$/);
        if (bd && req.method === 'PUT') {
          const r = store.saveBinding(principal.userId, validateBinding(bd[1], await readJson(req), knownHosts()));
          return r.http === 200 ? json(res, 200, r.binding) : json(res, r.http, { error: r.code });
        }
        if (bd && req.method === 'DELETE') {
          const r = store.deleteBinding(bd[1]);
          return r.http === 204 ? json(res, 204) : json(res, r.http, { error: r.code });
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

      // --- P1 설정(웹 사용자만): 메신저 허용 사용자·카카오·새 세션. 웹 값이 없으면 파일 값(source: file) ---
      if (path.startsWith('/v1/admin/settings')) {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        const view = () => {
          const au = store.getSetting('messenger.allowedUsers');
          const kk = store.getSetting('messenger.kakao');
          const ns = store.getSetting('newSessions');
          return {
            allowedUsers: au ? { value: au.value, source: 'web', updatedAt: au.updatedAt } : { value: null, source: 'file' },
            kakao: kk ? { value: kk.value, source: 'web', updatedAt: kk.updatedAt } : { value: null, source: 'file' },
            newSessions: { web: ns?.value ?? null, updatedAt: ns?.updatedAt ?? null, fileConfigured: Boolean(nsFileRaw),
              effective: nsCfg ? { enabled: nsCfg.enabled, limits: nsCfg.limits, permissions: { default: nsCfg.permissions.default, profiles: Object.keys(nsCfg.permissions.profiles).filter((p) => p !== 'full') },
                cleanup: nsCfg.cleanup, workspaceRoot: nsCfg.workspaceRoot } : null },
          };
        };
        if (req.method === 'GET' && path === '/v1/admin/settings') return json(res, 200, view());
        const s = path.match(/^\/v1\/admin\/settings\/(allowed-users|kakao|new-sessions)$/);
        if (!s) return json(res, 404, { error: 'not_found' });
        const key = { 'allowed-users': 'messenger.allowedUsers', kakao: 'messenger.kakao', 'new-sessions': 'newSessions' }[s[1]];
        if (req.method === 'DELETE') store.deleteSetting(key); // 파일 값으로 되돌리기
        else if (req.method === 'PUT') {
          const body = await readJson(req);
          const value = s[1] === 'allowed-users' ? validateAllowedUsers(body) : s[1] === 'kakao' ? validateKakao(body) : validateNewSessionsWeb(body, nsFileRaw ?? {});
          store.setSetting(key, value);
        } else return json(res, 404, { error: 'not_found' });
        if (key === 'newSessions') reloadNewSessions();
        return json(res, 200, view());
      }

      // --- 메신저 프로세스용: 봇 정의 받기·상태 보고(봇 헤더 없이 메신저 토큰으로만) ---
      if (path.startsWith('/v1/messenger/')) {
        if (user.appId !== 'app_messenger' || principal.bot) return json(res, 403, { error: 'messenger_only' });
        // P1: 웹에서 바꾼 메신저 설정. 값이 null이면 메신저는 자기 config.json 값을 쓴다.
        if (req.method === 'GET' && path === '/v1/messenger/config') {
          return json(res, 200, { allowedUsers: store.getSetting('messenger.allowedUsers')?.value ?? null,
            kakao: store.getSetting('messenger.kakao')?.value ?? null });
        }
        if (req.method === 'GET' && path === '/v1/messenger/bots') {
          const roles = Object.fromEntries(store.listRoles().map((r) => [r.roleId, r]));
          return json(res, 200, { bots: store.listBots().filter((b) => b.enabled).map((b) => ({ ...b, role: roles[b.roleId] ?? null })) });
        }
        // W2: 허용 목록에 없는 사람이 보낸 메시지(사람 ID·이름만, 내용 없음)
        if (req.method === 'POST' && path === '/v1/messenger/denied') {
          const b = await readJson(req);
          const platform = String(b.platform ?? ''); const botId = String(b.botId ?? ''); const userId = String(b.userId ?? '');
          if (!store.bot(platform, botId) || !/^[\w.:@-]{1,128}$/.test(userId)) return json(res, 400, { error: 'bad_denied' });
          const key = `${platform}:${botId}:${userId}`;
          const prev = denied.get(key);
          denied.set(key, { platform, botId, userId, name: b.name ? String(b.name).slice(0, 60) : (prev?.name ?? null),
            at: new Date().toISOString(), atMs: Date.now(), count: (prev?.count ?? 0) + 1 });
          if (denied.size > 50) denied.delete(denied.keys().next().value);
          return json(res, 204);
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
          conversationId: c.conversationId, label: labelOf(c), engine: c.engine,
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
          // 봇에서 만들면 그 봇의 역할(엔진·권한 제한, AI 역할 안내)을 적용한다.
          const bot = principal.bot && store.bot(principal.bot.platform, principal.bot.botId);
          const role = bot?.roleId ? store.listRoles().find((q) => q.roleId === bot.roleId) ?? null : null;
          const r = store.createSession(principal, { engine: body.engine, name: body.name, profile: body.profile,
            hostId: nsHost, via: principal.bot ? 'chat' : (VIA[principal.appId] ?? 'api'), role }, nsCfg);
          return r.http === 201 ? json(res, 201, { conversationId: r.conversationId, name: r.name, engine: r.engine, profile: r.profile })
            : json(res, r.http, { error: r.code, ...(r.limit ? { limit: r.limit } : {}), ...(r.allowed ? { allowed: r.allowed } : {}) });
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

  // P4: 허브 공개용 Unix 소켓. 같은 기계의 전달 컨테이너(ieun-relay)가 이 소켓으로 넘겨 준다(방화벽·호스트 포트 변경 없음).
  // 접속 제한 방식이 하나도 없으면 열지 않는다(실수로 무방비 공개가 되지 않게 기본은 닫힘).
  const listenSocket = (socketPath) => {
    if (!access?.modes.length) throw new Error('web_access_required');
    const win = process.platform === 'win32'; // Windows는 명명된 파이프(\\.\pipe\…), 시험용
    if (!win) rmSync(socketPath, { force: true });
    const s3 = createServer((req, res) => server.emit('request', req, res));
    extra.push(s3);
    return new Promise((r, j) => { s3.once('error', j); s3.listen(socketPath, () => { if (!win) chmodSync(socketPath, 0o660); r(socketPath); }); });
  };

  // W0: 허브 Docker 컨테이너의 공개 포트(NPM이 같은 Docker 망에서 부름). 접속 제한 방식이 있어야만 연다(기본 닫힘).
  // 이 포트로 온 요청은 127.0.0.1 직접 접속으로 보지 않으므로 항상 접속 제한을 거친다.
  const listenPublic = (port, host) => {
    if (!access?.modes.length) throw new Error('web_access_required');
    const s4 = createServer((req, res) => { req.ieonPublic = true; server.emit('request', req, res); });
    extra.push(s4);
    return new Promise((r, j) => { s4.once('error', j); s4.listen(port, host, () => r(s4.address().port)); });
  };

  return {
    server, store, listenExtra, listenSocket, listenPublic, newSessions: nsCfg, notices,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))),
    hubLink, localConnector,
    close: () => new Promise((r) => { clearInterval(cleanupTimer); relay?.close(); hubLink?.close(); localConnector?.stop(); extra.forEach((s2) => s2.close()); server.close(() => { store.close(); r(); }); }),
  };
}

export function isTailscaleAddress(host) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host ?? '');
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return false;
  return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  // P5: 내장 중계 비밀 파일(KEY=값 줄). PC 토큰은 IEON_RELAY_PC_TOKEN, 없으면 메신저와 같은 이름 KAKAO_RELAY_TOKEN.
  if (config.relay?.envFile) {
    const env = Object.fromEntries(readFileSync(config.relay.envFile, 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]));
    config.relayEnvFile = config.relay.envFile; // W2: 봇 토큰도 이 파일에 쓴다(secretsFile이 따로 없으면)
    config.relay = { pcToken: env.IEON_RELAY_PC_TOKEN ?? env.KAKAO_RELAY_TOKEN, kakaoSecret: env.IEON_RELAY_KAKAO_SECRET };
  }
  const app = createApp(config);
  const port = await app.listen(config.port ?? 28760);
  // W4: 로컬 연결부도 이 서버가 띄운다(설정 manageLocalConnector).
  if (app.localConnector) process.stderr.write(JSON.stringify({ ch: 'server', event: 'local_connector', started: app.localConnector.start() }) + '\n');
  // W6: 메신저도 이 서버가 띄운다(설정 manageMessenger). 봇 토큰은 웹에서 넣고, 메신저가 1분마다 다시 읽는다.
  if (config.manageMessenger && config.messengerConfigPath && existsSync(config.messengerConfigPath)) {
    supervise([{ name: 'messenger', args: ['src/pilot/messenger/main.mjs', config.messengerConfigPath], delayMs: 2000 }]);
  }
  // W3: 이미 짝맺은 허브가 있으면 연결부를 다시 띄운다(재부팅 뒤 사용자가 할 일 없음).
  if (app.hubLink) process.stderr.write(JSON.stringify({ ch: 'server', event: 'hub_link_resume', result: app.hubLink.resume() }) + '\n');
  process.stderr.write(`ieon pilot server: http://127.0.0.1:${port}\n`);
  const hosts = [...(config.extraHosts ?? []), ...(config.webAccess?.tailscale?.listenHost ? [config.webAccess.tailscale.listenHost] : [])];
  for (const host of new Set(hosts)) {
    process.stderr.write(`ieon pilot server: http://${await app.listenExtra(port, host, config.extraAllowedClients)}\n`);
  }
  if (config.listenSocket) process.stderr.write(`ieon pilot server: unix:${await app.listenSocket(config.listenSocket)}\n`);
  if (config.publicListen) {
    const p = await app.listenPublic(config.publicListen.port, config.publicListen.host ?? '0.0.0.0');
    process.stderr.write(`ieon pilot server: public ${config.publicListen.host ?? '0.0.0.0'}:${p}\n`);
  }
}
