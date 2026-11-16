// S2.1 이어온 실증 서버(loopback 한정). 웹/외부 앱 API와 PC 연결부 API를 한 프로세스에서 제공한다.
// 사용: node src/pilot/server.mjs <configPath>
// 토큰 원문은 설정에 두지 않고 sha256만 둔다. body·header의 user_id·thread·경로는 신뢰하지 않는다.
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash, timingSafeEqual, randomBytes, randomInt } from 'node:crypto';
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
import { containerBoundary } from './adapters/codex-thread.mjs';
import { readDevice, setLive, upsertCodexThread, removeCodexThread, createLocalConnector } from './device-settings.mjs';
import { cleanLabel } from './accounts.mjs';
import { createDeviceAdmin, OPS, HUB_SELF_OPS } from './device-admin.mjs';
import { createAdminQueue } from './admin-queue.mjs';
import { readMode, writeMode, modeEffects } from './mode.mjs';
import { EventEmitter } from 'node:events';
import { createCodexLogin } from './codex-login.mjs';
import { listCodexThreads } from './codex-threads.mjs';
import { EXCLUDED_THREAD } from './lock-probe.mjs';
import { supervise } from '../hub/run.mjs';
import { basename, dirname, join, resolve } from 'node:path';

const MAX_QUESTION = 8000;
// AP-1: 방에서 다시 보내기를 보여 줄 이유(보내지 않은 것이 확실한 것만 — U2 카드의 다시 보내기와 같은 기준 + 끊김·엔진 꺼짐)
const ROOM_RETRY = new Set(['desktop_holds_thread', 'thread_busy', 'conversation_busy', 'active_limit', 'usage_limit', 'device_unavailable', 'session_not_running', 'shared_server_down', 'account_not_logged_in']);
const DEVICE_FRESH_MS = 30000;
// 대화 중심 새 화면(설계 UI_CHAT_FIRST U1)이 `/`, 예전 화면은 U8까지 `/classic`(결정 UD4).
const WEB_PAGE = fileURLToPath(new URL('./web/app.html', import.meta.url));
const WEB_SETTINGS = fileURLToPath(new URL('./web/settings.html', import.meta.url));
const WEB_PRIVACY = fileURLToPath(new URL('./web/privacy.html', import.meta.url)); // AP-5a: 스토어용 개인정보 처리방침(누구나 열람)
const WEB_ICON = fileURLToPath(new URL('./web/ieon.ico', import.meta.url));
// U7: 휴대폰 "홈 화면에 추가"·PC 앱 창용(PWA). 화면 코드는 그대로, 설치 정보와 아이콘만 준다. 오프라인 캐시(서비스 워커)는 두지 않는다
// (대화는 늘 서버 상태가 기준이라 옛 화면을 보여 주면 오해가 생김).
const WEB_PNG = { '/icon-192.png': fileURLToPath(new URL('./web/icon-192.png', import.meta.url)), '/icon-512.png': fileURLToPath(new URL('./web/icon-512.png', import.meta.url)) };
const MANIFEST = JSON.stringify({ name: '이어온', short_name: '이어온', description: '내 Codex·Claude Code 작업 세션과 이어서 대화', lang: 'ko',
  start_url: '/', scope: '/', display: 'standalone', background_color: '#0f766e', theme_color: '#0f766e',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });

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
  // AP-3: 이어온 앱 출처. 설정 파일 appOrigins로 개발용 출처를 더할 수 있다(웹에서 바꾸지 않음).
  const appOrigins = new Set(['https://localhost', 'capacitor://localhost', 'app://ieon', ...(Array.isArray(config.appOrigins) ? config.appOrigins.filter((o) => typeof o === 'string') : [])]);
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
  // AP-1: AI 직원 — 대화마다 이름·역할·아이콘. 이름이 없으면 대화 이름(빈칸 없앤 것)으로 부른다.
  const staffView = (c) => { const s = store.staffOf(c.conversationId); return { name: s?.name ?? String(labelOf(c)).replace(/\s+/g, ''), roleName: s?.roleName ?? null, roleId: s?.roleId ?? null, icon: s?.icon ?? null, set: Boolean(s) }; };
  // 방에서 부른 사람 찾기: @이름(AI 직원 이름, 대소문자 무시). 아무도 부르지 않으면 대표.
  const mentionsOf = (text, members) => {
    const names = [...String(text).matchAll(/@([\p{L}\p{N}_-]{1,20})/gu)].map((m) => m[1].toLowerCase());
    return [...new Set(names.flatMap((n) => members.filter((c) => staffView(c).name.toLowerCase() === n).map((c) => c.conversationId)))];
  };
  // 방 → AI 직원 한 명에게 보내기. 사용 중·꺼짐이면 보내지 않고 알림만 남긴다(자동으로 기다렸다 보내지 않음).
  const sendToMember = (principal, room, c, question, key, extraPrefix = '') => {
    const prefix = (room.guide ? `[방 안내 — ${room.name}]\n${room.guide}\n\n` : '') + extraPrefix;
    let code = null; let r = null;
    if (!online(c.hostId)) code = 'device_unavailable';
    else if (engineReady(c) === false) code = c.engine === 'claude_channel' ? 'session_not_running' : 'shared_server_down';
    else { r = store.submit(principal, c.conversationId, key, { question }, { prefix: prefix || null, roomId: room.roomId }); if (r.http !== 202) code = r.code; }
    if (code) store.addRoomPost(room.roomId, { kind: 'busy', conversationId: c.conversationId, code, text: question });
    else { store.addRoomPost(room.roomId, { kind: 'ask', conversationId: c.conversationId, requestId: r.requestId }); notify(c.conversationId, { type: 'request', requestId: r.requestId, status: 'queued', roomId: room.roomId }); }
  };
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
  // U5(UD3): 메신저 주인 등록 숫자. 봇마다 하나, 6자리·10분·1회용, 틀린 시도 5번이면 잠김. 숫자는 로그에 남기지 않는다.
  const noteOwner = (platform, userId) => { const all = store.getSetting('messenger_owners')?.value ?? {}; const list = new Set((all[platform] ?? []).map(String)); list.add(String(userId)); store.setSetting('messenger_owners', { ...all, [platform]: [...list] }); };
  const claims = new Map(); // "<메신저>:<봇ID>" → { code, expMs, tries, state: waiting|claimed|locked, name }
  const CLAIM_MS = config.claimMs ?? 10 * 60_000; // 시험에서만 짧게
  const claimView = (c) => (!c ? 'none' : c.state === 'waiting' && Date.now() > c.expMs ? 'expired' : c.state);
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
  // M1: 이 PC의 사용 방식(.local/mode.json). 허브 서버에는 없음. null이면 예전 설치 — 지금처럼 두고 화면이 고르기를 권한다.
  const modePath = access ? null : (config.modePath ?? (basename(dirname(config.dbPath)) === 's2' ? join(dirname(config.dbPath), '..', 'mode.json') : join(dirname(config.dbPath), 'mode.json'))); // PC: .local/mode.json
  const mode = () => (modePath ? readMode(modePath) : null);
  // ② 내 허브: 이 PC는 질문을 받지 않고 봇을 켜지 않는다(허브 연결이 잠깐 끊겨 있어도 그대로)
  const hubModeOn = () => mode() === 'hub' || Boolean(hubLink?.hubMode());
  const ipOf = (req) => (access ? access.clientIp(req) : (req.socket.remoteAddress ?? '?'));
  // W4: 이 PC의 로컬 연결부를 서버가 띄운다(설정 manageLocalConnector). 기기 설정을 바꾸면 다시 띄운다.
  const localConnector = !access && config.manageLocalConnector && config.connectorConfigPath
    ? createLocalConnector({ connectorConfigPath: config.connectorConfigPath, log: (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n') }) : null;
  // W5: 허브 웹의 Codex 로그인(기기 코드). 허브에만 있다(PC는 그 PC의 Codex 앱 로그인을 그대로 쓴다).
  const codexLogin = access ? (config.codexLogin ?? createCodexLogin({ log: (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n') })) : null;
  // U4: 처음 설정의 "준비 확인" — 이 PC의 Codex 로그인 여부만(공식 `codex login status`, 계정 정보는 돌려주지 않음).
  const localCodexStatus = access ? null : (config.localCodexStatus ?? (() => createCodexLogin().status()));
  const localDirect = (req) => !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
  // 기기 설정이 바뀌면 그 설정을 읽는 연결부를 다시 띄운다. 이 서버가 띄운 것이 아니면 다시 켜야 한다고 알린다.
  const applyDevice = async () => {
    let restarted = false;
    if (localConnector?.running()) { await localConnector.restart(); restarted = true; }
    if (hubLink?.hubMode()) { hubLink.disconnect(); hubLink.reconnect(); restarted = true; }
    return { restarted, restartRequired: !restarted };
  };
  // A2-d: 기기 관리 명령(PC 화면·허브가 맡긴 명령 공통). 허브는 자기 연결부 설정으로 허브 자신의 계정을 다룬다.
  const adminLog = (e) => process.stderr.write(JSON.stringify({ ch: 'server', ...e }) + '\n');
  // AP-2: 새 소식(SSE)용 알림. 질문·답·승인 내용은 싣지 않고 대화·요청 번호와 상태만 — 앱은 그걸 보고 필요한 것을 다시 불러온다.
  const events = new EventEmitter(); events.setMaxListeners(200);
  const notify = (conversationId, e) => { if (conversationId) events.emit('e', { conversationId, at: new Date().toISOString(), ...e }); };
  // M1: 사용 방식 보기·바꾸기(PC 화면과 허브 화면이 같이 씀 — IM10). 처리 중·확인 필요 질문이 있으면 바꾸지 않는다.
  const modeAdmin = access || !modePath ? null : {
    view() {
      const st = hubLink?.status() ?? { state: 'none' };
      return { mode: mode(), suggested: mode() ?? (st.state === 'paired' ? 'hub' : 'pc'), paired: st.state === 'paired', hubUrl: st.hubUrl ?? null,
        effects: { pc: modeEffects(mode(), 'pc'), hub: modeEffects(mode(), 'hub') } };
    },
    set(next) {
      if (!['pc', 'hub'].includes(next)) return { status: 400, body: { error: 'bad_mode' } };
      if (store.conversations({ userId: config.users?.[0]?.userId ?? 'u_sinsan', appId: 'app_web' }).some((c) => c.busy || c.heldBy)) return { status: 409, body: { error: 'requests_pending' } };
      writeMode(modePath, next);
      // 허브 연결은 바로 맞추고(①이면 끊기 — 짝맺은 정보는 남김, ②면 짝맺어 있으면 다시 연결), 이 PC 봇은 메신저가 1분 안에 따라온다.
      // 허브가 맡긴 명령으로 ①이 되면 결과를 보낸 뒤부터 허브는 이 PC에 닿지 않는다(다시 ②로는 이 PC 화면에서).
      const hub = next === 'pc' ? (hubLink?.disconnect(), 'stopped') : (hubLink?.resume() ?? 'not_paired');
      adminLog({ event: 'mode_set', mode: next });
      return { status: 200, body: { ...this.view(), hub } };
    },
  };
  const claudeOpts = { ...(config.claudeAuthDir !== undefined ? { claudeDir: config.claudeAuthDir } : {}), ...(config.claudeLogin ? { claudeLogin: config.claudeLogin } : {}) }; // SV2
  const deviceAdmin = access ? null : createDeviceAdmin({ connectorConfigPath: config.connectorConfigPath, applyDevice, accountLogin: config.accountLogin, log: adminLog, modeAdmin, ...claudeOpts,
    connectorState: () => ({ managed: Boolean(localConnector), running: localConnector?.running() ?? null, mode: mode() }) }); // M1: 허브 화면에도 그 PC의 사용 방식
  const hubAdmin = access ? createDeviceAdmin({ connectorConfigPath: config.connectorConfigPath ?? join(dirname(config.dbPath), 'connector.json'), accountLogin: config.accountLogin, log: adminLog, ...claudeOpts,
    applyDevice: async () => ({ restarted: true, restartRequired: false }) }) : null; // 허브 연결부는 설정 파일이 바뀌면 스스로 다시 시작
  // A2-d: 허브 자신의 연결부(허브 새 세션 실행) 기기 ID. 허브 연결부 설정의 기기 토큰과 맞는 기기를 찾는다(토큰은 해시로만 비교, 출력 없음).
  // 이 기기는 PC가 아니므로 PC 목록에서 빼고, 그쪽으로 온 관리 명령은 허브 자신(계정 명령만)으로 처리한다.
  let selfHost;
  const selfHostId = () => {
    if (selfHost !== undefined) return selfHost;
    selfHost = null;
    try {
      const c = JSON.parse(readFileSync(config.connectorConfigPath ?? join(dirname(config.dbPath), 'connector.json'), 'utf8'));
      if (access && c.deviceTokenFile) {
        const tokenFile = resolve(c.deviceTokenFile); // 연결부와 같게(상대 경로는 실행 폴더 기준)
        const h = createHash('sha256').update(readFileSync(tokenFile, 'utf8').trim()).digest('hex');
        selfHost = deviceEntries().find((d) => d.tokenSha256 === h)?.hostId ?? null;
      }
    } catch { selfHost = null; }
    return selfHost;
  };
  const adminQueue = createAdminQueue({ timeoutMs: config.adminTimeoutMs ?? 25_000 });
  hubLink?.setAdmin?.((op, args) => deviceAdmin.run(op, args));
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

  // U2: 이 PC의 실제 실행(AI 응답) 설정. 허브·설정 없음은 null(카드로 알리지 않음).
  const localLive = () => {
    if (access || !config.connectorConfigPath || !existsSync(config.connectorConfigPath)) return null;
    try { return readDevice(config.connectorConfigPath).live; } catch { return null; }
  };
  // U6: 허브 Codex 로그인 여부(허브 새 Codex 세션 카드용). 확인에 몇 초 걸리므로 1분마다 한 번만 묻고 결과를 둔다. 모르면 카드 없음.
  let hubCodex = { loggedIn: null, at: 0, busy: false };
  const noteHubCodex = (s) => { hubCodex = { loggedIn: Boolean(s?.loggedIn), at: Date.now(), busy: false }; };
  const refreshHubCodex = () => {
    if (!codexLogin || hubCodex.busy || Date.now() - hubCodex.at < 60_000) return;
    hubCodex.busy = true;
    Promise.resolve(codexLogin.status()).then(noteHubCodex, () => { hubCodex = { ...hubCodex, at: Date.now(), busy: false }; });
  };
  // A1(ENGINE_ACCOUNTS EA10 최소 규칙): 이 대화의 질문이 어느 계정(접속)의 사용량으로 나가는지 늘 보이게 한다.
  // 계정 고르기(A2) 전에는 어떤 접속인지 사실대로 알린다 — PC 대화는 그 PC의 앱 로그인을 그대로 쓴다.
  const kindTag = (c) => { const k = accountKind(c); return k ? { kind: k } : {}; }; // SV3: 구독/API
  const accountOf = (c) => {
    // A2-d: 허브 새 세션도 허브에서 고른 이어온 계정이면 그 이름표(허브 연결부가 알려 줌)
    const hubMine = access && c.newSession && c.engine === 'codex_thread' ? health.get(c.hostId)?.codexDefault : null;
    if (hubMine) return { mode: 'ieon_login', label: '이어온 계정 ' + hubMine + ' (허브)' };
    if (c.engine === 'claude_cli' && health.get(c.hostId)?.claudeKind) return { mode: 'hub_login', label: '서버 Claude 로그인(허브·모든 칸이 같이 씀)', ...kindTag(c) }; // SV2
    if (access && c.newSession) return { mode: 'hub_login', label: c.engine === 'codex_thread' ? '허브의 Codex 로그인' : '허브의 Claude 로그인' };
    if (c.engine === 'claude_channel') return { mode: 'pc_default', label: '그 PC의 Claude Code 창에 로그인된 계정' };
    if (c.engine === 'claude_cli') return { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Claude Code 계정' };
    // E1·E2 토큰 쪽: 지금은 그 PC의 앱 로그인(이어온 전용 계정은 A3)
    if (c.engine === 'agy_cli') return { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Antigravity 로그인' };
    if (c.engine === 'grok_cli') return { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Grok 로그인' };
    if (c.connectMode === 'shared_server') return { mode: 'shared_server', label: '공유 서버의 로그인 — 그 PC에서 띄운 Codex 공유 서버' };
    // A2: 연결부가 알려 준 이어온 전용 계정(대화별 → 새 세션은 기본)
    const h = health.get(c.hostId);
    const mine = c.newSession ? h?.codexDefault : h?.codexAccounts?.[String(c.sessionRef ?? '').toLowerCase()];
    if (mine) return { mode: 'ieon_login', label: '이어온 계정 ' + mine, ...kindTag(c) };
    return { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Codex Desktop과 같은 계정', ...kindTag(c) };
  };
  // SV3: 이 대화의 질문이 나가는 계정의 종류(구독/API). Codex 기존 대화·새 세션만 안다(그 밖은 null).
  const accountKind = (c) => {
    if (c.engine === 'claude_cli') return health.get(c.hostId)?.claudeKind ?? null; // SV2: 서버 Claude 로그인 종류
    if (c.engine !== 'codex_thread' || c.connectMode === 'shared_server') return null;
    const h = health.get(c.hostId);
    if (!h) return null;
    return (c.newSession ? h.codexKind : (h.codexKinds?.[String(c.sessionRef ?? '').toLowerCase()] ?? h.codexKind)) ?? null;
  };
  // SV3-b: 이 대화가 쓰는 계정의 열쇠 "<PC>:<계정 ID>"(Codex만). 사용량을 계정마다 모으고 한도를 건다.
  const accountKeyOf = (c) => {
    if (c.engine === 'claude_cli') return health.get(c.hostId)?.claudeKind ? `${c.hostId}:claude` : null; // SV2: 서버 Claude 로그인 한 벌
    if (c.engine !== 'codex_thread' || c.connectMode === 'shared_server') return null;
    const h = health.get(c.hostId);
    const id = c.newSession ? (h?.codexDefaultId ?? 'pc_default') : (h?.codexAccountIds?.[String(c.sessionRef ?? '').toLowerCase()] ?? h?.codexDefaultId ?? 'pc_default');
    return `${c.hostId}:${id}`;
  };
  // 한도(설정 → 계정에서 신산님이 정함, 기본은 없음): { "<PC>:<계정>": { perDay: 질문 수, tokensPerMonth: 토큰 } }. API 계정에만 건다(구독은 공급자 한도).
  const accountLimits = () => store.getSetting('account_limits')?.value ?? {};
  const accountOver = (c) => {
    const key = accountKeyOf(c);
    if (!key || accountKind(c) !== 'api') return null;
    const lim = accountLimits()[key];
    if (!lim) return null;
    const u = store.accountUsage(key);
    if (lim.perDay && u.todayQuestions >= lim.perDay) return { key, reason: 'per_day', usage: u, limit: lim };
    if (lim.tokensPerMonth && u.monthTokens >= lim.tokensPerMonth) return { key, reason: 'tokens_per_month', usage: u, limit: lim };
    return null;
  };
  // SV3(SERVER_SESSIONS 2-4, 신산님 결정 "다른 사람이 쓰는 서비스는 API형"): 주인 밖의 사람도 받는 봇(봇에 더한 사람이 있음)으로 온 질문은 서비스용.
  // 주인이 웹·앱에서 같은 대화를 쓰는 것은 그대로 둔다(주인 편의). 지금은 계정 종류를 아는 Codex만 지킨다.
  // 주인이 누구인지: 메신저 설정의 공통 허용 사용자(PC형) + 숫자 주인 등록 때 기록한 사람. 둘 다 없으면(예전에 허브에서 숫자로 등록)
  // 봇에 더한 사람 중 처음 사람이 주인이다(허브는 숫자 주인 등록 때 주인을 그 칸에 넣었다 — 2026-11-17 허브 실데이터 확인).
  const messengerOwners = (platform) => {
    let cfg = [];
    try { if (config.messengerConfigPath && existsSync(config.messengerConfigPath)) cfg = (JSON.parse(readFileSync(config.messengerConfigPath, 'utf8')).allowedUsers?.[platform] ?? []).map(String); } catch { cfg = []; }
    return [...cfg, ...((store.getSetting('messenger_owners')?.value ?? {})[platform] ?? []).map(String)];
  };
  const hasOthers = (platform, bot) => {
    const extra = (bot.extraUsers ?? []).map(String);
    const owners = messengerOwners(platform);
    const known = owners.length ? owners : extra.slice(0, 1);
    return extra.some((u) => !known.includes(u));
  };
  const serviceBlocked = (principal, c) => {
    if (!principal.bot) return false;
    const bot = store.bot(principal.bot.platform, principal.bot.botId);
    if (!bot || !hasOthers(principal.bot.platform, bot)) return false; // 주인만 받는 봇은 개인용
    if (c.engine === 'claude_cli') { const k = accountKind(c); return k !== null && k !== 'api'; } // SV2: 서버 Claude가 구독 로그인이면 서비스용은 막음(종류를 모르는 PC Claude는 그대로)
    if (c.engine !== 'codex_thread' || c.connectMode === 'shared_server') return false;
    return accountKind(c) !== 'api';
  };
  // U2: 대화별로 사용자가 처리할 카드(중요한 것부터). 값은 상태 요약만 담고 질문·답 원문은 담지 않는다.
  const approvalTtlMs = config.approvalTtlMs ?? 15 * 60_000; // W1: 15분 안에 답이 없으면 거부
  let webUrlSeen = null; // RC3: 마지막으로 본 공개 웹 주소(메신저 작업 열기 링크)
  const approvalShowMs = config.approvalShowMs ?? 30 * 60_000; // RC1: 결정된 승인 카드를 대화에 남겨 두는 시간
  const cardsFor = (c, live, principal) => {
    const cards = [];
    // W1: 엔진이 승인을 기다리는 중(허용·거부 카드). 요약·작업 폴더만, 로그에는 남기지 않음
    // RC1: 결정된 뒤에도 같은 카드가 승인됨 → 실행 중 → 완료/실패/결과 불명으로 바뀐다(결정 뒤 30분, 최근 3장까지만).
    const recent = (a) => a.state !== 'pending' && a.decidedAt && Date.now() - Date.parse(a.decidedAt) < approvalShowMs;
    const all = principal ? store.approvals(principal, c.conversationId, { ttlMs: approvalTtlMs }) ?? [] : [];
    // RC5: 사람에게 넘긴 일(handoff)은 사람이 처리 기록을 남길 때까지 계속 보임
    for (const a of [...all.filter((x) => x.state === 'pending' || x.state === 'handoff'), ...all.filter((x) => x.state !== 'handoff' && recent(x)).slice(0, 3)]) {
      // 대기 중이면 기존 그대로 'approval'(허용·거부 버튼), 넘긴 일은 'handoff'(직접 처리함·하지 않음), 결정 뒤는 'approval_result'(버튼 없음 — 예전 화면·설치된 앱은 모르는 종류라 무시)
      cards.push({ kind: a.state === 'pending' ? 'approval' : a.state === 'handoff' ? 'handoff' : 'approval_result', approvalId: a.approvalId, requestId: a.requestId, approvalKind: a.kind, summary: a.summary, cwd: a.cwd,
        n: a.n, state: a.state, agent: a.agent, engine: a.engine, exitCode: a.exitCode,
        expiresAt: new Date(Date.parse(a.createdAt) + approvalTtlMs).toISOString() });
    }
    if (hubModeOn()) cards.push({ kind: 'hub_mode', hubUrl: hubLink?.status().hubUrl ?? null });
    else if (!online(c.hostId)) cards.push({ kind: 'device_offline' });
    else if (engineReady(c) === false) cards.push({ kind: 'engine_off', engine: c.engine });
    // RC4: 확인 필요 카드에 그때 세션과 지금 세션이 같은지(사람이 원래 앱에서 확인할 때 참고)
    if (c.heldBy) { const rc = store.resumeCheck(c.heldBy.requestId); cards.push({ kind: 'held', requestId: c.heldBy.requestId, status: c.heldBy.status, errorCode: c.heldBy.errorCode ?? null,
      ...(rc?.known ? { resume: { verdict: rc.verdict, sameSession: rc.sameSession, historyKept: rc.historyKept } } : {}) }); }
    if (access && c.newSession && c.engine === 'codex_thread' && hubCodex.loggedIn === false) cards.push({ kind: 'hub_codex_login' });
    if (c.newSession?.state === 'archived') cards.push({ kind: 'archived' });
    { const o = accountOver(c); if (o) cards.push({ kind: 'account_limit', reason: o.reason, usage: o.usage, limit: o.limit }); } // SV3-b: 주인에게도 보이게
    // SV0·SV1: 허브 자신이 돌리는 새 세션은 컨테이너 안이라 명령이 실패한다 → 글 답만(명령·파일 작업은 엔진 칸으로)
    if (access && c.newSession && c.hostId === nsHost && !containerBoundary()) cards.push({ kind: 'text_only' });
    if (live === false && !hubModeOn()) cards.push({ kind: 'live_off' });
    return cards;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;

      // AP-3: 이어온 앱(휴대폰 https://localhost·capacitor://localhost, PC 설치형 app://ieon)만 다른 출처 호출 허용.
      // 앱 기기 열쇠(Authorization)로만 쓰는 길이라 쿠키는 허용하지 않는다(allow-credentials 없음 → 웹 로그인 쿠키로는 못 씀).
      const origin = req.headers.origin;
      if (origin && path.startsWith('/v1/') && appOrigins.has(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, accept', 'access-control-max-age': '600' });
          return res.end();
        }
      }
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      // P4: 접속 제한. 예외 경로(기기 API·카카오·Teams·health)는 각자 토큰·서명으로 인증한다.
      // 앞단 없이 이 PC의 127.0.0.1로 직접 온 요청(SSH 터널 관리)은 통과시킨다.
      if (access && !isExemptPath(path)) {
        const peer = req.socket.remoteAddress ?? '';
        const direct = !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && !req.headers['x-forwarded-for'];
        if (!direct && !(await access.check(req))) return json(res, 403, { error: 'access_denied' });
      }
      // P5: 내장 중계. /kakao/*는 접속 제한 예외(비밀 경로·요청 횟수 제한), /pc/poll은 제한 대상이라 사실상 이 기계 안에서만.
      if (relay && (path.startsWith('/kakao/') || path.startsWith('/line/') || path === '/pc/poll')) return relay.handler(req, res); // L1: 라인 webhook도 같은 내장 중계
      // 이어온 아이콘(브라우저 탭·바로 가기)
      if (req.method === 'GET' && path === '/favicon.ico') {
        res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
        return res.end(readFileSync(WEB_ICON));
      }
      if (req.method === 'GET' && path === '/manifest.webmanifest') {
        res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'max-age=3600' });
        return res.end(MANIFEST);
      }
      if (req.method === 'GET' && WEB_PNG[path]) {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
        return res.end(readFileSync(WEB_PNG[path]));
      }
      // U8(UD4): 예전 화면(/classic)은 없앴다. 예전 주소로 오면 설정 화면으로 보낸다.
      if (req.method === 'GET' && path === '/privacy') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'max-age=3600' });
        return res.end(readFileSync(WEB_PRIVACY));
      }
      if (req.method === 'GET' && path === '/classic') { res.writeHead(302, { location: '/settings' }); return res.end(); }
      if (req.method === 'GET' && (path === '/' || path === '/settings')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(readFileSync(path === '/' ? WEB_PAGE : WEB_SETTINGS));
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
          if (h && typeof h === 'object') {
            // A2: 대화별 이어온 전용 계정 이름표(문자열만, 개수·길이 제한)
            const acc = h.codexAccounts && typeof h.codexAccounts === 'object' ? Object.entries(h.codexAccounts).slice(0, 100)
              .filter(([k, v]) => /^[0-9a-f-]{36}$/i.test(k) && typeof v === 'string').map(([k, v]) => [k.toLowerCase(), cleanLabel(v)]) : [];
            // SV3: 계정 종류(구독/API) — 정해진 값만
            const KIND = new Set(['api', 'subscription']);
            const kinds = h.codexKinds && typeof h.codexKinds === 'object' ? Object.entries(h.codexKinds).slice(0, 100).filter(([k, v]) => /^[0-9a-f-]{36}$/i.test(k) && KIND.has(v)).map(([k, v]) => [k.toLowerCase(), v]) : [];
            health.set(device.hostId, { codexShared: String(h.codexShared), claudeChannel: String(h.claudeChannel),
              codexAccounts: Object.fromEntries(acc), codexDefault: typeof h.codexDefault === 'string' ? cleanLabel(h.codexDefault) : null,
              codexKinds: Object.fromEntries(kinds), codexKind: KIND.has(h.codexKind) ? h.codexKind : null,
              // SV3-b: 대화별 계정 ID(정해진 모양만)
              codexAccountIds: Object.fromEntries(h.codexAccountIds && typeof h.codexAccountIds === 'object' ? Object.entries(h.codexAccountIds).slice(0, 100).filter(([k, v]) => /^[0-9a-f-]{36}$/i.test(k) && /^[a-z0-9_]{2,16}$/.test(String(v))).map(([k, v]) => [k.toLowerCase(), String(v)]) : []),
              codexDefaultId: /^[a-z0-9_]{2,16}$/.test(String(h.codexDefaultId ?? '')) ? String(h.codexDefaultId) : null,
              claudeKind: KIND.has(h.claudeKind) ? h.claudeKind : null }); // SV2
          }
        } catch { /* 형식이 틀린 상태 보고는 무시한다 */ }
        // A2-d: 허브가 맡긴 기기 관리 명령. PC(허브 연결 중인 이어온 서버)가 가져가 자기 화면과 같은 코드로 실행하고 결과를 보낸다.
        if (access && req.method === 'GET' && path === '/v1/device/admin') {
          const cmd = adminQueue.take(device.hostId);
          return cmd ? json(res, 200, cmd) : json(res, 204);
        }
        const ar = path.match(/^\/v1\/device\/admin\/([\w-]{8,64})\/result$/);
        if (access && req.method === 'POST' && ar) {
          const b = await readJson(req);
          return adminQueue.done(device.hostId, ar[1], { status: Number(b.status) || 500, body: b.body && typeof b.body === 'object' ? b.body : {} }) ? json(res, 204) : json(res, 404, { error: 'not_found' });
        }
        // W3: 이 PC가 허브에 연결돼 있으면 이 PC 서버는 작업을 내주지 않는다(한 PC가 두 서버의 질문을 함께 실행하지 않게).
        if (req.method === 'GET' && path === '/v1/device/jobs' && hubModeOn()) return json(res, 204);
        if (req.method === 'GET' && path === '/v1/device/jobs') {
          const job = store.claim(device.hostId);
          return job ? json(res, 200, job) : json(res, 204);
        }
        // W1: 엔진이 묻는 승인을 연결부가 올리고(그 PC가 처리 중인 질문만), 결정을 묻는다. 내용은 DB에만(로그에는 종류만).
        if (req.method === 'POST' && path === '/v1/device/approvals') {
          const r = store.addApproval(device.hostId, await readJson(req));
          if (r.http === 201) { process.stderr.write(JSON.stringify({ ch: 'server', event: r.handoff ? 'approval_handoff' : 'approval_requested', host: device.hostId }) + '\n'); notify(store.approvalConversation(r.approvalId), { type: 'approval', approvalId: r.approvalId, status: r.handoff ? 'handoff' : 'pending' }); }
          return r.http === 201 ? json(res, 201, { approvalId: r.approvalId, n: r.n, ttlMs: approvalTtlMs, ...(r.handoff ? { handoff: true } : {}) }) : json(res, r.http, { error: r.code });
        }
        const ap = path.match(/^\/v1\/device\/approvals\/(apv_[\w-]+)$/);
        if (req.method === 'GET' && ap) {
          if (store.approvalHost(ap[1]) !== device.hostId) return json(res, 404, { error: 'not_found' });
          const st = store.approvalStatus(ap[1], { ttlMs: approvalTtlMs }).status;
          // RC1: 연결부가 허용을 읽어 간 순간부터 실행 중
          if (st === 'allowed' && store.markApprovalPicked(ap[1])) notify(store.approvalConversation(ap[1]), { type: 'approval', approvalId: ap[1], status: 'running' });
          return json(res, 200, { status: st });
        }
        // RC1: 허용한 항목의 실제 실행 결과(완료·실패, 종료 코드까지만 — 출력 내용은 받지 않는다)
        const apr = path.match(/^\/v1\/device\/approvals\/(apv_[\w-]+)\/result$/);
        if (req.method === 'POST' && apr) {
          const b = await readJson(req);
          const r = store.reportApprovalResult(device.hostId, apr[1], { outcome: b.outcome, exitCode: b.exitCode, itemId: b.itemId });
          if (r.http === 200) { process.stderr.write(JSON.stringify({ ch: 'server', event: 'approval_result', status: r.execStatus }) + '\n'); notify(store.approvalConversation(apr[1]), { type: 'approval', approvalId: apr[1], status: r.execStatus }); }
          return r.http === 200 ? json(res, 200, { execStatus: r.execStatus }) : json(res, r.http, { error: r.code });
        }
        // RC2: 실행 중인 요청을 멈춰야 하는지(연결부가 실행하는 동안 몇 초마다 묻는다)
        const jc = path.match(/^\/v1\/device\/jobs\/([\w-]+)\/control$/);
        if (req.method === 'GET' && jc) {
          const stop = store.stopRequested(device.hostId, jc[1]);
          return stop === null ? json(res, 404, { error: 'not_found' }) : json(res, 200, { stop });
        }
        const m = path.match(/^\/v1\/device\/jobs\/([\w-]+)\/result$/);
        if (req.method === 'POST' && m) {
          const updated = store.report(device.hostId, m[1], await readJson(req));
          if (updated) notify(store.requestConversation(m[1]), { type: 'request', requestId: m[1], status: updated.status });
          return updated ? json(res, 200, { status: updated.status }) : json(res, 409, { error: 'not_reportable' });
        }
        return json(res, 404, { error: 'not_found' });
      }

      // --- W3: 짝맺기(허브). PC가 부른다. 토큰은 관리자 승인 뒤 그 PC에 한 번만 간다. ---
      if (pairing && req.method === 'POST' && (path === '/v1/pair/start' || path === '/v1/pair/poll')) {
        const retry = overLimit(`pair:${path}:${ipOf(req)}`, path === '/v1/pair/start' ? 10 : 60);
        if (retry) return tooMany(res, retry);
        const body = await readJson(req);
        const r = path === '/v1/pair/start' ? pairing.start({ name: body.name, from: ipOf(req), invite: body.invite }) : pairing.poll(body.pairId);
        if (r.error) return json(res, r.http, { error: r.error });
        if (path === '/v1/pair/start') process.stderr.write(JSON.stringify({ ch: 'server', event: 'pair_requested', from: ipOf(req), invited: Boolean(r.body?.approved) }) + '\n');
        return json(res, r.http, r.body);
      }

      // AP-2: 이어온 앱이 연결 코드로 기기 열쇠를 받는다(열쇠는 응답에 한 번만, 서버는 해시만)
      if (req.method === 'POST' && path === '/v1/app/pair') {
        const retry = overLimit(`apppair:${ipOf(req)}`, 10);
        if (retry) return tooMany(res, retry);
        const b = await readJson(req);
        const code = String(b.code ?? '').replace(/\D/g, '');
        const name = String(b.name ?? '').trim().slice(0, 40) || '이어온 앱';
        if (code.length !== 8) return json(res, 400, { error: 'bad_code' });
        const token = randomBytes(32).toString('hex'); const deviceId = 'ad_' + randomBytes(6).toString('hex');
        const r = store.useAppPairCode(createHash('sha256').update(code).digest('hex'), { deviceId, name, tokenHash: createHash('sha256').update(token).digest('hex') });
        if (r.http !== 201) return json(res, r.http, { error: r.code });
        process.stderr.write(JSON.stringify({ ch: 'server', event: 'app_paired' }) + '\n');
        return json(res, 201, { token, deviceId });
      }
      // --- 사용자(웹·외부 앱) API ---
      if (!path.startsWith('/v1/')) return json(res, 404, { error: 'not_found' });
      if (await auth.handle(req, res, path, { json, readJson })) return;
      let user = matchToken(req.headers.authorization, config.users);
      // W2b: 웹에서 발급한 외부 프로그램 API 키
      if (!user) {
        const a = matchToken(req.headers.authorization, store.activeApiAppHashes());
        if (a) user = { userId: (config.users ?? []).find((u) => u.appId === 'app_web')?.userId ?? 'u_sinsan', appId: a.appId };
      }
      // AP-2: 이어온 앱 기기 열쇠. 웹 사용자처럼 대화·방·카드·승인을 쓰되 설정(관리)은 웹에서만.
      let appDevice = null;
      if (!user) {
        const d = matchToken(req.headers.authorization, store.activeAppDeviceHashes());
        if (d) { user = { userId: d.userId, appId: 'app_web' }; appDevice = d.deviceId; store.touchAppDevice(d.deviceId); }
      }
      // 키(Authorization)를 보냈는데 맞지 않으면 쿠키로 대신 통과시키지 않는다(폐기한 키가 브라우저 로그인으로 살아나지 않게).
      if (!user && req.headers.authorization) return json(res, 401, { error: 'unauthorized' });
      if (!user) {
        const p = auth.principal(req);
        if (p?.error) return json(res, 403, { error: p.error });
        user = p;
      }
      if (!user) return json(res, 401, { error: 'unauthorized' });
      const principal = { userId: user.userId, appId: user.appId };
      // RC3: 웹 화면이 공개 https 주소로 열렸으면 그 주소를 기억한다(메신저 답의 "작업 열기" 링크용, 설정 없이). 로컬 주소는 쓰지 않는다.
      if (principal.appId === 'app_web') {
        const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
        const base = proto === 'https' && /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/^(localhost|127\.|\[?::1)/i.test(host) ? `https://${host}` : null;
        if (base && base !== webUrlSeen) { webUrlSeen = base; store.setSetting('web_url', base); }
      }
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

      if (appDevice && path.startsWith('/v1/admin/')) return json(res, 403, { error: 'app_not_allowed' }); // 설정은 웹 화면에서만
      // AP-5a: 앱이 스스로 이 기기 연결을 끊는다(스토어의 "데이터·계정 삭제" 요구). 자기 열쇠만 끊을 수 있고, 끊으면 바로 401.
      if (req.method === 'POST' && path === '/v1/app/forget') {
        if (!appDevice) return json(res, 403, { error: 'app_only' });
        store.revokeAppDevice(principal.userId, appDevice);
        process.stderr.write(JSON.stringify({ ch: 'server', event: 'app_forgot' }) + '\n');
        return json(res, 200, { revoked: true });
      }
      // AP-2: 새 소식 바로 받기(SSE). 내 대화의 요청·승인 상태가 바뀌면 번호·상태만 보낸다. 25초마다 살아 있음 표시.
      if (req.method === 'GET' && path === '/v1/events') {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        // x-accel-buffering: 허브 앞단(NPM·nginx)이 새 소식을 모아 두지 않고 바로 넘기게(AP-4a 알림)
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': ok\n\n');
        const mine = (id) => store.conversations(principal).some((c) => c.conversationId === id);
        const on = (e) => { if (mine(e.conversationId)) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); };
        events.on('e', on);
        const ka = setInterval(() => res.write(': keepalive\n\n'), config.sseKeepaliveMs ?? 25_000);
        req.on('close', () => { clearInterval(ka); events.off('e', on); });
        return;
      }
      // AP-2: 이어온 앱 연결 — 1회용 코드(웹 화면에서 만듦, 10분·한 번), 앱이 코드로 열쇠를 받음, 기기 목록·끊기
      if (path.startsWith('/v1/admin/app-devices')) {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        if (req.method === 'GET' && path === '/v1/admin/app-devices') return json(res, 200, { devices: store.appDevices(principal.userId) });
        if (req.method === 'POST' && path === '/v1/admin/app-devices/code') {
          const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
          const r = store.addAppPairCode(principal.userId, createHash('sha256').update(code).digest('hex'));
          return r.http === 201 ? json(res, 201, { code, expiresAt: r.expiresAt }) : json(res, r.http, { error: r.code });
        }
        const rv = path.match(/^\/v1\/admin\/app-devices\/(ad_[\w-]+)\/revoke$/);
        if (rv && req.method === 'POST') return store.revokeAppDevice(principal.userId, rv[1]) ? json(res, 200, { revoked: true }) : json(res, 404, { error: 'not_found' });
        return json(res, 404, { error: 'not_found' });
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
        // U6: PC 연결 링크(1회용 초대). 초대 값은 응답에만 담고 기록하지 않는다.
        if (req.method === 'POST' && path === '/v1/admin/pairings/invite') {
          if (!pairing) return json(res, 404, { error: 'not_found' });
          const b = await readJson(req);
          const r = pairing.invite(principal.userId, b.replaceHostId ? String(b.replaceHostId) : null);
          if (r.error) return json(res, r.http, { error: r.error });
          process.stderr.write(JSON.stringify({ ch: 'server', event: 'pair_invite_created' }) + '\n');
          return json(res, r.http, r.body);
        }
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
          if (req.method === 'GET' && path === '/v1/admin/codex') { const login = await codexLogin.status(); noteHubCodex(login); return json(res, 200, { login, job: codexLogin.view() }); }
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
        // A2-d: 기기 관리 명령 한 벌(device-admin.mjs) — PC 화면은 여기로, 허브 화면은 /v1/admin/hosts/<PC>/run으로 같은 명령을 쓴다.
        // 보기 명령은 앞단을 거친 화면(Tailscale 등)에서도 되고, 바꾸는 명령은 이 PC에서 연 화면만.
        if (path === '/v1/admin/local/run' && req.method === 'POST') {
          if (access) return json(res, 404, { error: 'not_found' });
          const b = await readJson(req);
          if (OPS[b.op] === 'write' && !localDirect(req)) return json(res, 403, { error: 'local_only' });
          const r = await deviceAdmin.run(String(b.op ?? ''), b.args);
          return json(res, r.status, r.body);
        }
        // A2: 설정 → 계정의 예전 주소(같은 명령으로 처리)
        if (path.startsWith('/v1/admin/local/accounts')) {
          if (access) return json(res, 404, { error: 'not_found' });
          if (!localDirect(req)) return json(res, 403, { error: 'local_only' });
          const am = path.match(/^\/v1\/admin\/local\/accounts(?:\/([a-z0-9]{2,16}))?(\/login|\/login\/cancel|\/logout|\/use)?$/);
          if (!am) return json(res, 404, { error: 'not_found' });
          const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
          let [, id, act] = am;
          if (id === 'use' && !act) { id = undefined; act = '/use'; } // "use"는 계정 ID가 아니라 고르기
          const op = !id && !act ? (req.method === 'GET' ? 'accounts.get' : req.method === 'POST' ? 'accounts.add' : null)
            : !id && act === '/use' && req.method === 'PUT' ? 'accounts.use'
            : id && !act && req.method === 'DELETE' ? 'accounts.delete'
            : id && req.method === 'POST' ? { '/login': 'accounts.login', '/login/cancel': 'accounts.login.cancel', '/logout': 'accounts.logout' }[act] : null;
          if (!op) return json(res, 404, { error: 'not_found' });
          const r = await deviceAdmin.run(op, { ...body, id });
          return json(res, r.status, r.body);
        }
        // A2-d: 허브 화면에서 PC 설정·계정 바꾸기. 'hub'는 허브 자신(허브 새 세션의 계정). PC는 그 PC가 가져가 실행한 결과를 기다려 돌려준다.
        const hr = path.match(/^\/v1\/admin\/hosts\/([\w-]{1,48})\/run$/);
        if (hr && req.method === 'POST') {
          if (!access) return json(res, 404, { error: 'not_found' });
          const b = await readJson(req);
          const op = String(b.op ?? '');
          if (!Object.hasOwn(OPS, op)) return json(res, 400, { error: 'bad_op' });
          if (hr[1] === 'hub' || hr[1] === selfHostId()) {
            if (!HUB_SELF_OPS.has(op)) return json(res, 400, { error: 'bad_op' });
            const r = await hubAdmin.run(op, b.args);
            return json(res, r.status, r.body);
          }
          if (!knownHosts().includes(hr[1])) return json(res, 404, { error: 'unknown_host' });
          if (!online(hr[1])) return json(res, 503, { error: 'device_offline' });
          const r = await adminQueue.send(hr[1], op, b.args && typeof b.args === 'object' ? b.args : {});
          process.stderr.write(JSON.stringify({ ch: 'server', event: 'host_admin', host: hr[1], op, status: r.status }) + '\n');
          return json(res, r.status, r.body);
        }
        if (path === '/v1/admin/local/engines' && req.method === 'GET') {
          if (access) return json(res, 404, { error: 'not_found' });
          if (!localDirect(req)) return json(res, 403, { error: 'local_only' });
          const s = await localCodexStatus().catch(() => ({ loggedIn: false, method: null }));
          return json(res, 200, { codex: { loggedIn: s.loggedIn === true, method: s.method ?? null } });
        }
        // U3: 대화 연결 — 이 PC의 최근 Codex 대화 목록(업무 대화 제외)과 한 번에 연결(허용 목록 + 세션 등록). 이 PC에서 연 화면만.
        if (path === '/v1/admin/local/threads' || path === '/v1/admin/connections') {
          if (access) return json(res, 404, { error: 'not_found' });
          if (!localDirect(req)) return json(res, 403, { error: 'local_only' });
          const cfgPath = config.connectorConfigPath;
          const allowed = () => new Set(cfgPath && existsSync(cfgPath) ? readDevice(cfgPath).codexThreads.map((x) => x.threadId.toLowerCase()) : []);
          if (req.method === 'GET' && path === '/v1/admin/local/threads') {
            let threads;
            try { threads = await (config.listCodexThreads ?? listCodexThreads)({ codex: config.codex }); } catch { return json(res, 502, { error: 'codex_unavailable' }); }
            const on = allowed();
            // 목록은 응답에만 담고 로그에는 남기지 않는다. 업무 대화는 한 번 더 뺀다.
            return json(res, 200, { threads: threads.filter((t) => t.threadId !== EXCLUDED_THREAD).map((t) => ({ ...t, connected: on.has(t.threadId) })) });
          }
          if (req.method === 'POST' && path === '/v1/admin/connections') {
            if (!cfgPath || !existsSync(cfgPath)) return json(res, 404, { error: 'no_connector_config' });
            const body = await readJson(req);
            const threadId = String(body.threadId ?? '').trim().toLowerCase();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(threadId)) return json(res, 400, { error: 'bad_session_ref' });
            if (threadId === EXCLUDED_THREAD) return json(res, 400, { error: 'excluded_session' });
            const hosts = knownHosts();
            const hostId = body.hostId ? String(body.hostId) : (hosts.length === 1 ? hosts[0] : null);
            if (!hostId || !hosts.includes(hostId)) return json(res, 400, { error: 'choose_host', hosts });
            const label = String(body.label ?? '').trim().slice(0, 60) || '이름 없는 대화';
            // 작업 폴더는 Codex가 알려 준 값을 쓰되, 지금 없는 폴더면 비워 둔다(연결은 막지 않음).
            const dir = typeof body.workingDirectory === 'string' && body.workingDirectory ? body.workingDirectory : null;
            try { upsertCodexThread(cfgPath, { threadId, mode: 'alternate', workingDirectory: dir }); } catch (e) {
              if (!['working_directory_missing', 'bad_working_directory'].includes(e.message)) return json(res, e.http ?? 400, { error: e.message });
              upsertCodexThread(cfgPath, { threadId, mode: 'alternate', workingDirectory: null });
            }
            const existing = store.listBindings().find((b) => b.engine === 'codex_thread' && String(b.sessionRef).toLowerCase() === threadId);
            let conversationId = existing?.conversationId;
            if (!conversationId) {
              const ids = new Set(store.listBindings().map((b) => b.conversationId));
              const base = 'c_' + threadId.replaceAll('-', '').slice(0, 12);
              conversationId = base; for (let n = 2; ids.has(conversationId); n += 1) conversationId = base + '_' + n;
              const appIds = (config.users ?? []).some((u) => u.appId === 'app_messenger') ? ['app_web', 'app_messenger'] : ['app_web'];
              let v; try { v = validateBinding(conversationId, { engine: 'codex_thread', label, hostId, sessionRef: threadId, appIds }, hosts); } catch (e) { return json(res, e.http ?? 400, { error: e.message }); }
              const r = store.saveBinding(principal.userId, v);
              if (r.http !== 200) return json(res, r.http, { error: r.code });
            }
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'connection_added', created: !existing }) + '\n');
            return json(res, 200, { conversationId, created: !existing, ...(await applyDevice()) });
          }
          return json(res, 404, { error: 'not_found' });
        }
        // M1: 사용 방식 보기·바꾸기(이 PC 화면). 바꾸기는 이 PC에서 연 화면만, 처리 중·확인 필요 질문이 있으면 바꾸지 않는다.
        if (path === '/v1/admin/local/mode') {
          if (access || !modePath) return json(res, 404, { error: 'not_found' });
          if (req.method === 'GET') return json(res, 200, modeAdmin.view());
          if (req.method !== 'PUT') return json(res, 404, { error: 'not_found' });
          if (!localDirect(req)) return json(res, 403, { error: 'local_only' });
          const r = modeAdmin.set(String((await readJson(req)).mode ?? ''));
          return json(res, r.status, r.body);
        }
        // W3: 이 PC를 허브에 연결(PC 로컬 웹만)
        if (path.startsWith('/v1/admin/local/hub')) {
          if (!hubLink) return json(res, 404, { error: 'not_found' });
          if (req.method === 'GET' && path === '/v1/admin/local/hub') return json(res, 200, hubLink.status());
          if (req.method === 'POST' && path === '/v1/admin/local/hub/connect') {
            // M1: ① 이 PC에서만이면 허브에 연결하지 않는다(사용 방식을 먼저 바꿔야 함 — 섞어 쓰기 금지)
            if (mode() === 'pc') return json(res, 409, { error: 'mode_pc' });
            const body = await readJson(req);
            // U6: 이름을 비우면 이 PC 이름(Windows 컴퓨터 이름), PC 연결 링크로 열었으면 초대를 함께 보낸다.
            const name = String(body.name ?? '').trim() || hostname().slice(0, 40);
            try { return json(res, 200, await hubLink.connect({ hubUrl: body.hubUrl, name, invite: body.invite })); } catch (e) { return json(res, e.http ?? 400, { error: e.message }); }
          }
          if (req.method === 'POST' && path === '/v1/admin/local/hub/disconnect') return json(res, 200, hubLink.disconnect({ forget: (await readJson(req)).forget === true }));
          if (req.method === 'POST' && path === '/v1/admin/local/hub/reconnect') {
            if (mode() === 'pc') return json(res, 409, { error: 'mode_pc' });
            return json(res, 200, { connector: hubLink.reconnect() });
          }
          return json(res, 404, { error: 'not_found' });
        }
        // W2b: 외부 프로그램 API 키 — 웹에서 발급(키는 이때 한 번만 보여 줌)·볼 수 있는 세션 고르기·폐기. server.json을 고치지 않는다.
        if (req.method === 'GET' && path === '/v1/admin/apps') return json(res, 200, { apps: store.listApiApps() });
        if (req.method === 'POST' && path === '/v1/admin/apps') {
          const name = String((await readJson(req)).name ?? '').trim();
          if (!name || name.length > 40 || /[\r\n]/.test(name)) return json(res, 400, { error: 'bad_name' });
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'app';
          let appId = `app_ext_${slug}`;
          for (let i = 2; store.listApiApps().some((a) => a.appId === appId); i++) appId = `app_ext_${slug}_${i}`;
          const t = newDeviceToken();
          const r = store.addApiApp(appId, name, t.hash);
          if (r.http !== 201) return json(res, r.http, { error: r.code });
          process.stderr.write(JSON.stringify({ ch: 'server', event: 'api_app_created', appId }) + '\n');
          return json(res, 201, { appId, name, key: t.token });
        }
        const ap = path.match(/^\/v1\/admin\/apps\/(app_ext_[a-z0-9_]{1,40})\/(sessions|revoke)$/);
        if (ap && req.method === 'PUT' && ap[2] === 'sessions') {
          const r = store.setAppSessions(ap[1], (await readJson(req)).sessions);
          return r.http === 200 ? json(res, 200, { sessions: store.listApiApps().find((a) => a.appId === ap[1]).sessions }) : json(res, r.http, { error: r.code });
        }
        if (ap && req.method === 'POST' && ap[2] === 'revoke') {
          const r = store.revokeApiApp(ap[1]);
          return r.http === 200 ? json(res, 200, { revoked: true }) : json(res, r.http, { error: r.code });
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
        // L1: 라인 webhook 주소(라인 Developers의 Webhook URL 칸에 붙임). 카카오와 같은 중계·같은 비밀 경로 값.
        if (req.method === 'GET' && path === '/v1/admin/line/webhook-url') {
          if (!relay) {
            const k = pcRelay();
            return k?.secret && k.url ? json(res, 200, { url: `${k.url}/line/webhook/${k.secret}`, relay: 'public' }) : json(res, 404, { error: 'no_kakao_relay' });
          }
          const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
          const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
          const base = config.publicUrl ?? `${proto}://${host}`;
          return json(res, 200, { url: `${base}/line/webhook/${config.relay.lineSecret ?? config.relay.kakaoSecret}` });
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
        // U5: 주인 등록 숫자 만들기·상태 보기(관리자 화면)
        if (path === '/v1/admin/messenger/claim') {
          if (req.method === 'POST') {
            const b = await readJson(req);
            const platform = String(b.platform ?? ''); const botId = String(b.botId ?? 'default');
            if (!store.bot(platform, botId)) return json(res, 404, { error: 'unknown_bot' });
            const code = String(randomInt(100000, 1000000));
            claims.set(`${platform}:${botId}`, { code, expMs: Date.now() + CLAIM_MS, tries: 0, state: 'waiting', name: null });
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'claim_started', platform, botId }) + '\n');
            return json(res, 200, { code, expiresAt: new Date(Date.now() + CLAIM_MS).toISOString() });
          }
          if (req.method === 'GET') {
            const c = claims.get(`${url.searchParams.get('platform')}:${url.searchParams.get('botId') ?? 'default'}`);
            return json(res, 200, { state: claimView(c), name: c?.state === 'claimed' ? c.name : null });
          }
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
            ...[...fileHosts].map((h) => ({ hostId: h, name: h, source: 'file', online: online(h), ...(h === selfHostId() ? { hubSelf: true } : {}) })),
            ...web.map((d) => ({ ...d, source: 'web', online: !d.revokedAt && online(d.hostId), ...(d.hostId === selfHostId() ? { hubSelf: true } : {}) })),
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
        // SV3-b: 계정별 사용량·한도(설정 → 계정). host를 주면 그 PC·칸의 계정만.
        if (req.method === 'GET' && path === '/v1/admin/account-usage') {
          const host = url.searchParams.get('host');
          const lim = accountLimits();
          const keys = [...new Set([...store.accountKeysSeen(), ...Object.keys(lim)])].filter((k) => !host || k.startsWith(host + ':'));
          return json(res, 200, { accounts: keys.map((k) => ({ key: k, accountId: k.split(':').slice(1).join(':'), ...store.accountUsage(k), limit: lim[k] ?? null })) });
        }
        const al = path.match(/^\/v1\/admin\/account-limits\/([\w-]{1,48}:[a-z0-9_]{2,16})$/);
        if (al && req.method === 'PUT') {
          if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
          const b = await readJson(req);
          const n = (v) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 1e10 ? Number(v) : NaN);
          const perDay = n(b.perDay); const tokensPerMonth = n(b.tokensPerMonth);
          if (Number.isNaN(perDay) || Number.isNaN(tokensPerMonth)) return json(res, 400, { error: 'bad_limit' });
          const all = { ...accountLimits() };
          if (!perDay && !tokensPerMonth) delete all[al[1]]; else all[al[1]] = { ...(perDay ? { perDay } : {}), ...(tokensPerMonth ? { tokensPerMonth } : {}) };
          store.setSetting('account_limits', all);
          return json(res, 200, { key: al[1], limit: all[al[1]] ?? null });
        }
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
          // M1: ② 내 허브면 이 PC의 봇(카카오 중계 포함)은 켜지 않는다 — 메신저가 1분 안에 모두 끈다(봇 설정은 지우지 않음)
          if (mode() === 'hub') return json(res, 200, { bots: [], mode: 'hub' });
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
        // U5: 허용 목록에 없는 사람이 6자리 숫자를 보냄 → 맞으면 그 봇의 허용 사용자로(주인 등록)
        if (req.method === 'POST' && path === '/v1/messenger/claim') {
          const b = await readJson(req);
          const platform = String(b.platform ?? ''); const botId = String(b.botId ?? ''); const userId = String(b.userId ?? '');
          if (!/^[\w.:@-]{1,128}$/.test(userId)) return json(res, 400, { error: 'bad_claim' });
          const c = claims.get(`${platform}:${botId}`);
          if (!c || claimView(c) !== 'waiting') return json(res, 404, { error: 'no_claim' });
          const given = Buffer.from(String(b.code ?? '').trim()); const want = Buffer.from(c.code);
          // 이미 허용된 사람(메신저가 allowed로 알림)이 틀린 경우는 숫자를 알아내려는 시도가 아니므로 잠금 횟수에 넣지 않는다.
          const owner = b.allowed === true;
          if (given.length !== want.length || !timingSafeEqual(given, want)) {
            if (!owner) { c.tries += 1; if (c.tries >= 5) c.state = 'locked'; }
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'claim_wrong', platform, botId, locked: c.state === 'locked' }) + '\n');
            return json(res, 403, { error: c.state === 'locked' ? 'claim_locked' : 'wrong_code' });
          }
          const bot = store.bot(platform, botId);
          if (!bot) return json(res, 404, { error: 'unknown_bot' });
          noteOwner(platform, userId); // SV3: 서비스용 판정에 쓰는 주인 기록
          if (owner) { // 이미 허용됨: 허용 목록은 그대로 두고 화면에 완료만 알린다
            c.state = 'claimed'; c.name = b.name ? String(b.name).slice(0, 60) : null;
            process.stderr.write(JSON.stringify({ ch: 'server', event: 'claim_done', platform, botId, already: true }) + '\n');
            return json(res, 200, { claimed: true, already: true });
          }
          const r = store.saveBot({ platform: bot.platform, botId: bot.botId, name: bot.name, roleId: bot.roleId, callNames: bot.callNames,
            extraUsers: [...new Set([...(bot.extraUsers ?? []), userId])], enabled: bot.enabled });
          if (r.http !== 200) return json(res, r.http, { error: r.code });
          c.state = 'claimed'; c.name = b.name ? String(b.name).slice(0, 60) : null;
          denied.delete(`${platform}:${botId}:${userId}`);
          process.stderr.write(JSON.stringify({ ch: 'server', event: 'claim_done', platform, botId }) + '\n');
          return json(res, 200, { claimed: true });
        }
        if (req.method === 'POST' && path === '/v1/messenger/bots/status') {
          const body = await readJson(req);
          for (const s of Array.isArray(body.bots) ? body.bots.slice(0, 200) : []) {
            if (!store.bot(s.platform, s.botId)) continue;
            botStatus.set(`${s.platform}:${s.botId}`, { state: String(s.state ?? '').slice(0, 40),
              missing: Array.isArray(s.missing) ? s.missing.map(String).slice(0, 4) : [],
              username: s.username ? String(s.username).slice(0, 80) : null,
              canReadAll: typeof s.canReadAll === 'boolean' ? s.canReadAll : null,
              // A1: 연결이 안 된 이유(예: bad_access_token). 짧은 코드만, 토큰 값·메시지 원문은 받지 않는다.
              detail: /^[\w.:-]{1,40}$/.test(String(s.detail ?? '')) ? String(s.detail) : null, at: new Date().toISOString() });
          }
          return json(res, 204);
        }
        return json(res, 404, { error: 'not_found' });
      }

      if (req.method === 'GET' && path === '/v1/conversations') {
        const live = localLive();
        // U6: 허브 화면은 목록을 PC별로 묶는다(기기 이름). 허브 Codex 로그인 상태도 이때 필요하면 새로 묻는다.
        const hostNames = access ? new Map(store.listDevices().map((d) => [d.hostId, d.name])) : null;
        if (access) refreshHubCodex();
        // hubMode: 이 PC가 허브에 연결돼 있어 여기서는 질문을 받지 않음(목록·상단 상태가 카드와 같은 말을 하도록).
        return json(res, 200, { ...(hubModeOn() ? { hubMode: true } : {}), ...(modePath ? { mode: mode() } : {}), conversations: store.conversations(principal).map((c) => ({
          conversationId: c.conversationId, label: labelOf(c), engine: c.engine,
          deviceOnline: online(c.hostId), busy: c.busy, ...(c.connectMode ? { connectMode: c.connectMode } : {}),
          ...(c.heldBy ? { heldBy: c.heldBy } : {}),
          ...(c.newSession ? { newSession: c.newSession } : {}),
          ...(engineReady(c) === undefined ? {} : { engineReady: engineReady(c) }),
          attention: cardsFor(c, live, principal).length,
          account: accountOf(c),
          staff: staffView(c), // AP-1: AI 직원 이름·역할·아이콘(이름이 없으면 대화 이름)
          ...(store.workMode(c.conversationId) ? { workMode: true } : {}), // W2
          ...(hostNames ? { host: { id: c.hostId, name: hostNames.get(c.hostId) ?? c.hostId } } : {}),
        })) });
      }
      // U2: 대화 안의 카드. 보낼 수 없는 이유·확인 필요 등 사용자가 처리할 일을 대화별로 모아 준다(동작은 기존 API).
      const cardsPath = path.match(/^\/v1\/conversations\/([\w-]+)\/cards$/);
      if (req.method === 'GET' && cardsPath) {
        const conv = store.conversations(principal).find((c) => c.conversationId === cardsPath[1]);
        return conv ? json(res, 200, { cards: cardsFor(conv, localLive(), principal) }) : json(res, 404, { error: 'not_found' });
      }
      // --- 새 세션 만들기(설계 NEW_SESSIONS) ---
      if (path === '/v1/sessions' || path.startsWith('/v1/sessions/')) {
        if (!nsCfg?.enabled) return json(res, 403, { error: 'new_sessions_disabled' });
        if (req.method === 'POST' && path === '/v1/sessions') {
          const body = await readJson(req);
          // 봇에서 만들면 그 봇의 역할(엔진·권한 제한, AI 역할 안내)을 적용한다.
          const bot = principal.bot && store.bot(principal.bot.platform, principal.bot.botId);
          const role = bot?.roleId ? store.listRoles().find((q) => q.roleId === bot.roleId) ?? null : null;
          // SV2: 만들 곳을 고를 수 있다(허브 목록의 PC·엔진 칸). 없으면 지금처럼 기본(허브 자신 또는 첫 PC).
          const target = body.hostId === undefined || body.hostId === null || body.hostId === '' ? nsHost : String(body.hostId);
          if (target !== nsHost && !knownHosts().includes(target)) return json(res, 404, { error: 'unknown_host' });
          const r = store.createSession(principal, { engine: body.engine, name: body.name, profile: body.profile,
            hostId: target, via: principal.bot ? 'chat' : (VIA[principal.appId] ?? 'api'), role }, nsCfg);
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
      // --- W1 승인 카드: 허용·거부는 그 대화 주인의 웹 화면만(메신저 버튼은 W2) ---
      const apd = path.match(/^\/v1\/approvals\/(apv_[\w-]+)$/);
      if (apd && req.method === 'POST') {
        // 웹 화면 또는 메신저 봇(브리지가 주인인지 확인한 뒤)만. 외부 프로그램 키는 불가
        if (principal.appId !== 'app_web' && principal.appId !== 'app_messenger' && !principal.bot) return json(res, 403, { error: 'admin_only' });
        const r = store.decideApproval(principal, apd[1], String((await readJson(req)).decision ?? ''), { ttlMs: approvalTtlMs });
        if (r.http === 200) { process.stderr.write(JSON.stringify({ ch: 'server', event: 'approval_decided', status: r.status }) + '\n'); notify(store.approvalConversation(apd[1]), { type: 'approval', approvalId: apd[1], status: r.status }); }
        return r.http === 200 ? json(res, 200, { status: r.status }) : json(res, r.http, { error: r.code, ...(r.status ? { status: r.status } : {}) });
      }
      // RC5: "사람이 직접 할 일" 규칙 — 읽기는 볼 수 있는 사람, 바꾸기는 그 대화 주인의 웹 화면만
      const hp = path.match(/^\/v1\/conversations\/([\w-]+)\/handoff$/);
      if (hp && req.method === 'GET') { const p = store.handoffPolicy(principal, hp[1]); return p ? json(res, 200, p) : json(res, 404, { error: 'not_found' }); }
      if (hp && req.method === 'PUT') {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        const b = await readJson(req);
        const r = store.setHandoffPolicy(principal, hp[1], { kinds: b.kinds, patterns: b.patterns });
        return r.http === 200 ? json(res, 200, r.policy) : json(res, r.http, { error: r.code });
      }
      const apl = path.match(/^\/v1\/conversations\/([\w-]+)\/approvals$/);
      if (apl && req.method === 'GET') {
        const list = store.approvals(principal, apl[1], { ttlMs: approvalTtlMs });
        return list ? json(res, 200, { approvals: list }) : json(res, 404, { error: 'not_found' });
      }
      // --- AP-1 AI 직원·방(웹 화면만 — 메신저·외부 프로그램 키로는 못 바꿈) ---
      const sf = path.match(/^\/v1\/conversations\/([\w-]+)\/staff$/);
      if (sf && req.method === 'PUT') {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        const b = await readJson(req);
        const r = store.setStaff(principal, sf[1], { name: b.name, roleId: b.roleId ?? null, icon: b.icon ?? null });
        return r.http === 200 ? json(res, 200, r.staff) : json(res, r.http, { error: r.code });
      }
      if (path === '/v1/rooms' || path.startsWith('/v1/rooms/')) {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        if (req.method === 'GET' && path === '/v1/rooms') return json(res, 200, { rooms: store.rooms(principal) });
        if (req.method === 'POST' && path === '/v1/rooms') {
          const r = store.saveRoom(principal, null, await readJson(req));
          return r.http === 201 ? json(res, 201, r.room) : json(res, r.http, { error: r.code });
        }
        const rm = path.match(/^\/v1\/rooms\/(room_[\w-]+)(\/posts|\/handoff|\/retry)?$/);
        if (!rm) return json(res, 404, { error: 'not_found' });
        const room = store.room(principal, rm[1]);
        if (!room) return json(res, 404, { error: 'not_found' });
        // 방 기록(다시 보내기용 원문 resend는 서버 안에서만)
        const postsView = () => store.roomPosts(principal, room.roomId).map(({ resend, ...p }) => ({ ...p, canRetry: !p.retried && Boolean(resend) && (p.kind === 'busy' ? ROOM_RETRY.has(p.code) : p.status === 'failed' && ROOM_RETRY.has(p.errorCode)) }));
        if (!rm[2] && req.method === 'GET') return json(res, 200, { ...room, posts: postsView() });
        if (!rm[2] && req.method === 'PUT') {
          const r = store.saveRoom(principal, room.roomId, await readJson(req));
          return r.http === 200 ? json(res, 200, r.room) : json(res, r.http, { error: r.code });
        }
        if (!rm[2] && req.method === 'DELETE') { const r = store.deleteRoom(principal, room.roomId); return json(res, r.http, r.http === 204 ? undefined : { error: r.code }); }
        if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
        const key = req.headers['idempotency-key'];
        if (!key || !/^[\w-]{8,64}$/.test(key)) return json(res, 400, { error: 'bad_request' });
        // 같은 키로 다시 오면 다시 보내지 않고 지금 기록만 돌려준다
        if (store.roomPostByKey(room.roomId, key)) return json(res, 200, { posts: postsView() });
        if (hubModeOn()) return json(res, 409, { error: 'hub_mode' });
        const members = store.conversations(principal).filter((c) => room.members.includes(c.conversationId));
        const b = await readJson(req);
        if (rm[2] === '/posts') {
          const text = typeof b.text === 'string' ? b.text.trim() : '';
          if (!text || text.length > MAX_QUESTION) return json(res, 400, { error: 'bad_request' });
          const targets = mentionsOf(text, members);
          const to = targets.length ? targets : [room.lead];
          store.addRoomPost(room.roomId, { kind: 'user', text, idemKey: key });
          to.forEach((id, i) => { const c = members.find((m) => m.conversationId === id); if (c) sendToMember(principal, room, c, text, `${key}-${i}`); });
          return json(res, 202, { posts: postsView() });
        }
        // 다시 보내기: 사용자가 누를 때만, 보내지 않은 것이 확실한 글만(사용 중·Desktop이 열어 둠·끊김·한도). 결과 불명은 대상이 아님. 한 번만.
        if (rm[2] === '/retry') {
          const post = store.roomPosts(principal, room.roomId).find((x) => x.postId === String(b.postId ?? ''));
          const ok = post && !post.retried && post.resend && (post.kind === 'busy' ? ROOM_RETRY.has(post.code) : post.status === 'failed' && ROOM_RETRY.has(post.errorCode));
          const c = ok && members.find((m) => m.conversationId === post.conversationId);
          if (!c) return json(res, 400, { error: 'bad_retry' });
          if (!store.markRoomRetried(room.roomId, post.postId)) return json(res, 400, { error: 'bad_retry' });
          store.addRoomPost(room.roomId, { kind: 'user', text: `↻ @${staffView(c).name}에게 다시 보냄`, idemKey: key });
          sendToMember(principal, room, c, post.resend, `${key}-r`);
          return json(res, 202, { posts: postsView() });
        }
        // 넘기기: 사용자가 누를 때만. 다른 AI 직원의 답을 인용해 한 명에게 보낸다(AI끼리 스스로 부르지 않음).
        const from = store.roomPosts(principal, room.roomId).find((x) => x.kind === 'ask' && x.requestId === String(b.requestId ?? '') && x.status === 'completed' && x.answer);
        const target = members.find((m) => m.conversationId === String(b.to ?? ''));
        if (!from || !target) return json(res, 400, { error: 'bad_handoff' });
        const fromConv = members.find((m) => m.conversationId === from.conversationId) ?? { conversationId: from.conversationId, label: from.conversationId };
        const note = String(b.note ?? '').trim().slice(0, 1000) || '이 답을 보고 이어서 해 주세요.';
        const head = `[${staffView(fromConv).name}의 답]\n`;
        const room0 = MAX_QUESTION - head.length - note.length - 10;
        const question = head + (from.answer.length > room0 ? from.answer.slice(0, room0) + '…' : from.answer) + '\n\n' + note;
        store.addRoomPost(room.roomId, { kind: 'user', text: `→ ${staffView(target).name}에게 넘김: ${note}`, conversationId: from.conversationId, idemKey: key });
        sendToMember(principal, room, target, question, `${key}-h`);
        return json(res, 202, { posts: postsView() });
      }
      // W2: 대화별 작업 모드 켜기·끄기 — 그 대화 주인의 웹 화면만(메신저·외부 프로그램 키 불가)
      const wm = path.match(/^\/v1\/conversations\/([\w-]+)\/work-mode$/);
      if (wm && req.method === 'PUT') {
        if (principal.appId !== 'app_web') return json(res, 403, { error: 'admin_only' });
        const r = store.setWorkMode(principal, wm[1], (await readJson(req)).on);
        if (r.http === 200) process.stderr.write(JSON.stringify({ ch: 'server', event: 'work_mode', on: r.workMode }) + '\n');
        return r.http === 200 ? json(res, 200, { workMode: r.workMode }) : json(res, r.http, { error: r.code });
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
        // 이 PC가 허브에 연결돼 있으면 이 PC 서버는 작업을 내주지 않으므로, 받아 두면 처리되지 않은 채 남는다 → 처음부터 받지 않는다(U2).
        if (hubModeOn()) return json(res, 409, { error: 'hub_mode' });
        if (!online(conv.hostId)) return json(res, 503, { error: 'device_unavailable' });
        if (engineReady(conv) === false) {
          return json(res, 503, { error: conv.engine === 'claude_channel' ? 'session_not_running' : 'shared_server_down' });
        }
        // SV3: 서비스용 봇(다른 사람도 받음)은 API 키 계정만 — 엔진에 보내지 않고 고치는 길을 알려 준다
        if (serviceBlocked(principal, conv)) return json(res, 409, { error: 'service_needs_api_key' });
        // SV3-b: API 계정 한도(정해 둔 경우만) — 넘으면 보내지 않고 알림(대화 카드로 주인도 봄)
        const over = accountOver(conv);
        if (over) { process.stderr.write(JSON.stringify({ ch: 'server', event: 'account_limit', reason: over.reason }) + '\n'); return json(res, 429, { error: 'account_limit_reached', reason: over.reason, usage: over.usage, limit: over.limit }); }
        const r = store.submit(principal, m[1], key, { question }, { accountKey: accountKeyOf(conv) });
        if (r.http === 202) notify(m[1], { type: 'request', requestId: r.requestId, status: 'queued' });
        const web = config.publicUrl ?? store.getSetting('web_url')?.value ?? null; // RC3: 작업 열기 링크(공개 주소를 알 때만)
        return r.http === 202 ? json(res, 202, { requestId: r.requestId, ...(web ? { taskUrl: `${web}/#task=${r.requestId}` } : {}) }) : json(res, r.http, { error: r.code });
      }
      // RC3: 작업 화면 — 작업 목록·작업 하나·승인 대기함(내가 볼 수 있는 대화만)
      if (req.method === 'GET' && path === '/v1/tasks') {
        const q = new URL(req.url, 'http://x').searchParams;
        return json(res, 200, { tasks: store.tasks(principal, { filter: q.get('filter') === 'active' ? 'active' : 'all', limit: q.get('limit'), ttlMs: approvalTtlMs }) });
      }
      m = path.match(/^\/v1\/tasks\/([\w-]+)$/);
      if (req.method === 'GET' && m) {
        const t = store.taskDetail(principal, m[1], { ttlMs: approvalTtlMs });
        if (t?.resume?.known) t.resume.deviceOnline = online(t.resume.now.hostId); // RC4: 지금 그 PC가 붙어 있는지
        return t ? json(res, 200, t) : json(res, 404, { error: 'not_found' });
      }
      if (req.method === 'GET' && path === '/v1/approvals') return json(res, 200, { approvals: store.pendingApprovals(principal, { ttlMs: approvalTtlMs }) });
      // RC2: 그 요청만 멈추기(웹·앱·메신저 공통). 대기 중 → 바로 취소(200), 실행 중 → 멈추는 중(202, 연결부가 멈춘 뒤 중지됨)
      m = path.match(/^\/v1\/requests\/([\w-]+)\/stop$/);
      if (req.method === 'POST' && m) {
        const r = store.stopRequest(principal, m[1]);
        if (r.http === 200 || r.http === 202) {
          process.stderr.write(JSON.stringify({ ch: 'server', event: 'request_stop', status: r.status }) + '\n');
          notify(store.requestConversation(m[1]), { type: 'request', requestId: m[1], status: r.status });
          return json(res, r.http, { requestId: m[1], status: r.status });
        }
        return json(res, r.http, { error: r.code, ...(r.status ? { status: r.status } : {}) });
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
        return r ? json(res, 200, { requestId: r.requestId, status: r.status, errorCode: r.errorCode, answer: r.answer, usage: r.usage, stopRequested: r.stopRequested })
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
    // 그 주소가 지금 이 PC에 없으면(Tailscale 꺼짐 등) 실패만 돌려주고 서버는 계속(2026-11-13: 이 때문에 서버 전체가 안 켜졌음)
    return new Promise((r, j) => { s2.once('error', (e) => { s2.close(); j(e); }); s2.listen(port, host, () => { extra.push(s2); r(`${host}:${port}`); }); });
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
    hubLink, localConnector, mode,
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
  // M1: ① 이 PC에서만이면 짝맺은 허브가 있어도 다시 연결하지 않는다
  if (app.hubLink && app.mode() !== 'pc') process.stderr.write(JSON.stringify({ ch: 'server', event: 'hub_link_resume', result: app.hubLink.resume() }) + '\n');
  process.stderr.write(`ieon pilot server: http://127.0.0.1:${port}\n`);
  const hosts = [...(config.extraHosts ?? []), ...(config.webAccess?.tailscale?.listenHost ? [config.webAccess.tailscale.listenHost] : [])];
  // 덤 주소(Tailscale)는 열지 못해도 서버는 계속 켜 두고 1분마다 다시 연다(이 PC 화면·메신저·허브 연결은 그대로)
  const openExtra = async (host) => {
    try { process.stderr.write(`ieon pilot server: http://${await app.listenExtra(port, host, config.extraAllowedClients)}\n`); }
    catch (e) {
      process.stderr.write(JSON.stringify({ ch: 'server', event: 'extra_listen_failed', host, error: String(e.code ?? e.message).slice(0, 40) }) + '\n');
      if (!String(e.message).startsWith('listen_host_not_allowed')) setTimeout(() => openExtra(host), 60_000).unref?.();
    }
  };
  for (const host of new Set(hosts)) await openExtra(host);
  if (config.listenSocket) process.stderr.write(`ieon pilot server: unix:${await app.listenSocket(config.listenSocket)}\n`);
  if (config.publicListen) {
    const p = await app.listenPublic(config.publicListen.port, config.publicListen.host ?? '0.0.0.0');
    process.stderr.write(`ieon pilot server: public ${config.publicListen.host ?? '0.0.0.0'}:${p}\n`);
  }
}