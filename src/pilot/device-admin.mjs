// A2-d(신산님 2026-11-12 "AI 응답·허용 목록까지"): 기기 관리 명령 한 벌. PC형 화면(이 PC 로컬 웹)과 허브형 화면(허브가 그 PC에
// 명령을 맡기면 PC가 가져가 실행)이 **같은 코드**로 같은 기능을 쓴다 — 실제 실행(AI 응답)·Codex 허용 목록·이어온 전용 계정.
// 허브 자신(허브 새 세션)의 계정도 같은 명령으로 다룬다. 업무 대화 제외·로그인 파일 미열람 같은 안전 규칙은 아래 함수들이 그대로 지킨다.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setCodexModel, addGrokAccount, removeGrokAccount, useGrokAccount, addAgyAccount, removeAgyAccount, useAgyAccount, addClaudeAccount, removeClaudeAccount, useClaudeAccount, readDevice, setLive, upsertCodexThread, removeCodexThread, upsertCliSession, removeCliSession, addCodexAccount, removeCodexAccount, useCodexAccount,
  addWorkspaceFolder, removeWorkspaceFolder, attachWorkspaceTo } from './device-settings.mjs';
import { workspacesView } from './workspaces.mjs';
import { accountsDirFor, codexHomeOf, createCodexHome, removeCodexHome, hasLogin, desktopCodexHome, readCodexCompat, saveCodexCompat, removeCodexCompat, compatHostOf } from './accounts.mjs';
import { createCodexLogin } from './codex-login.mjs';
import { claudeBusy, claudeProjectsDir, findClaudeSession, listClaudeSessions } from './claude-sessions.mjs';
import { EXCLUDED_THREAD } from './lock-probe.mjs';
import { AGY_KEY, agyAccountKind, agyCompatHost, agyHomeOf, agyLogoutFiles, createAgyLogin, readAgyCompat, saveAgyApiKey, saveAgyCompat } from './agy-accounts.mjs';
import { CLI_ENGINES } from './adapters/cli-once.mjs';
import { GROK_KEY, grokAccountKind, grokHomeOf, grokLogoutFiles, saveGrokApiKey } from './grok-accounts.mjs';
import { claudeAccountKind, claudeHomeOf, claudeLogout, compatConfirmed, compatHost, createClaudeAccountLogin, createClaudeHome, readCompat, removeClaudeHome, saveClaudeApiKey, saveCompat } from './claude-accounts.mjs';
import { CLAUDE_API_KEY, claudeAuthDir, claudeKind, canWrite, createClaudeLogin, saveClaudeLogin, removeClaudeLogin } from './claude-login.mjs';

// 명령 목록(이 밖의 것은 거절). read: 보기만(앞단을 거친 PC 화면 요청도 허용), 나머지는 바꾸기.
export const OPS = {
  'device.get': 'read', 'device.live': 'write', 'device.codex.model': 'write', 'device.codex.put': 'write', 'device.codex.delete': 'write',
  'accounts.get': 'read', 'accounts.add': 'write', 'accounts.use': 'write', 'accounts.login': 'write', 'accounts.compat': 'write', // A2-c: Codex 호환 주소
  'accounts.login.cancel': 'write', 'accounts.logout': 'write', 'accounts.delete': 'write', 'accounts.apikey': 'write', // 신산님 2026-11-16: 구독 로그인·API 키 모두 이어온 화면에서
  'mode.get': 'read', 'mode.set': 'write',
  // SV2: 서버 Claude 로그인(허브·모든 칸이 같이 씀) — 구독(공식 setup-token, 주소+코드)·API 키 모두 이어온 화면에서
  'claude.get': 'read', 'claude.login': 'write', 'claude.code': 'write', 'claude.login.cancel': 'write', 'claude.apikey': 'write', 'claude.logout': 'write',
  // SV2 기존 대화: 서버 칸에서 사람이 연 Claude 대화 목록·연결(연결 = 그 칸의 허용 목록에 넣기, 허브가 대화로 등록)
  'claude.sessions': 'read', 'claude.connect': 'write',
  // 가입자 대화 붙이기(2026-11-19): 그 PC의 최근 Codex 대화 목록·연결(연결 = 그 PC의 허용 목록에 넣기, 허브가 대화로 등록) — 허브 화면에서 PC를 골라 씀
  'codex.threads': 'read', 'codex.connect': 'write',
  // A2-b(신산님 2026-11-19 "PC마다 여러 개"): PC의 이어온 전용 Claude 계정(공식 claude auth login 또는 API 키), 엔진 기본 고르기. 서버는 SV2의 같이 쓰는 로그인.
  'claude.accounts.add': 'write', 'claude.accounts.login': 'write', 'claude.accounts.code': 'write', 'claude.accounts.cancel': 'write',
  'claude.accounts.apikey': 'write', 'claude.accounts.logout': 'write', 'claude.accounts.delete': 'write', 'claude.accounts.use': 'write',
  'claude.accounts.compat': 'write', // A2-c: 호환 주소(주소·키·모델)
  // A3(신산님 2026-11-19 "새 세션 범위로 만들기"): Antigravity 이어온 전용 계정 — 새 세션용(계정 폴더에 대화도 저장되므로 기존 대화는 PC 기본 로그인)
  // 구독 로그인(login·cancel)은 뺌 — 2026-11-19 실측: ACP authenticate(oauth-personal)는 방식만 정하고 실제 로그인을 하지 않는다. API 키만.
  'agy.accounts.get': 'read', 'agy.accounts.add': 'write',
  'agy.accounts.apikey': 'write', 'agy.accounts.logout': 'write', 'agy.accounts.delete': 'write', 'agy.accounts.use': 'write',
  'agy.accounts.compat': 'write', // 호환 주소(기업용 모델 게이트웨이 — 주소·키·모델·형식)
  // G1(신산님 2026-11-20): Grok 이어온 전용 계정 — 새 세션용, API 키(XAI_API_KEY)
  'grok.accounts.get': 'read', 'grok.accounts.add': 'write', 'grok.accounts.apikey': 'write', 'grok.accounts.logout': 'write', 'grok.accounts.delete': 'write', 'grok.accounts.use': 'write',
  // WS1-a 작업공간: 그 기기의 폴더 등록·빼기, AI 직원(허용 목록 세션)에 붙이기 — PC형·허브형 같은 명령
  'workspace.get': 'read', 'workspace.folder.add': 'write', 'workspace.folder.delete': 'write', 'workspace.attach': 'write',
  'device.cli.put': 'write', 'device.cli.delete': 'write', // E1·E2: Antigravity·Grok 세션 허용 목록 // M1: 사용 방식(PC형 화면·허브형 화면 같은 기능)
};
// 허브 자신에게 허용하는 명령: 계정만(허브 실제 실행은 관리 → 허브 보안 탭, 허브는 기존 대화 허용 목록이 없음).
// WS1-b: 허브 자체 새 세션에 붙일 폴더(허브 컨테이너 안 폴더) — 폴더 등록·보기만, 붙이기는 서버 전용 주소가 hubAdmin으로
export const HUB_SELF_OPS = new Set(['workspace.get', 'workspace.folder.add', 'workspace.folder.delete', 'accounts.get', 'accounts.add', 'accounts.use', 'accounts.login', 'accounts.login.cancel', 'accounts.logout', 'accounts.delete', 'accounts.apikey',
  'claude.get', 'claude.login', 'claude.code', 'claude.login.cancel', 'claude.apikey', 'claude.logout',
  // 2026-11-20 신산님 "기능이 있는 것은 있는 거고, 서버에 설치돼 있어야 사용할 수 있는 거": Antigravity 계정 칸은 허브에서도 같은 기능, 설치 여부는 installed로 알림
  'agy.accounts.get', 'agy.accounts.add', 'agy.accounts.use', 'agy.accounts.logout', 'agy.accounts.delete', 'agy.accounts.apikey', 'agy.accounts.compat',
  'grok.accounts.get', 'grok.accounts.add', 'grok.accounts.use', 'grok.accounts.logout', 'grok.accounts.delete', 'grok.accounts.apikey']);
// API 키 형식(OpenAI 키). 값은 검사만 하고 저장·기록하지 않는다 — Codex가 그 계정의 CODEX_HOME에 직접 저장한다.
export const API_KEY = /^sk-[A-Za-z0-9_-]{20,300}$/;
const DEFAULT_ID = 'pc_default';

export function createDeviceAdmin({ modeAdmin = null, connectorConfigPath, applyDevice = async () => ({ restarted: false, restartRequired: true }), accountLogin, connectorState = () => ({}), log = () => {},
  claudeDir = claudeAuthDir(), claudeLogin = null, claudeProjects = claudeProjectsDir(), busyOf = claudeBusy, listThreads = null,
  claudeAccountLogin = null, claudeLogoutImpl = claudeLogout, claudeDesktop = undefined, agyLogin = null }) {
  const logins = new Map(); // 계정별 공식 로그인 진행 상태
  let cLogin = null;
  const claudeLoginJob = () => (cLogin ??= claudeLogin ?? createClaudeLogin({ dir: claudeDir, log }));
  // SV2: 이 기기의 Claude 로그인 상태. shared=같이 쓰는 폴더가 있음(서버), canLogin=여기서 바꿀 수 있음(허브. 칸은 읽기만 — 허브 화면에서 한 번)
  const claudeView = () => (claudeDir
    ? { shared: true, canLogin: canWrite(claudeDir), kind: claudeKind(claudeDir), login: cLogin?.view() ?? { state: 'idle' } }
    : { shared: false, canLogin: false, kind: null, login: { state: 'idle' } });
  const claudeWritable = () => { if (!claudeDir || !canWrite(claudeDir)) throw Object.assign(new Error('claude_login_on_hub'), { http: 409 }); };
  const cfg = () => {
    if (!connectorConfigPath || !existsSync(connectorConfigPath)) throw Object.assign(new Error('no_connector_config'), { http: 404 });
    return connectorConfigPath;
  };
  const dirOf = (p) => accountsDirFor(p, JSON.parse(readFileSync(p, 'utf8')));
  // 기본 로그인(pc_default)은 그 PC·칸이 원래 쓰는 CODEX_HOME 그대로(엔진 칸은 /data/codex)
  const envOf = (p, id) => (id === DEFAULT_ID ? { ...process.env } : { ...process.env, CODEX_HOME: codexHomeOf(dirOf(p), id), CODEX_SQLITE_HOME: desktopCodexHome() });
  // 어떤 방식으로 로그인했는지(구독/API) — 로그인 파일을 읽지 않고, 이어온 화면에서 한 방식을 따로 적어 둔다(SV3 서비스용 판단에 씀)
  const kindsPath = (p) => join(dirOf(p), 'login-kinds.json');
  const kinds = (p) => { try { return JSON.parse(readFileSync(kindsPath(p), 'utf8')); } catch { return {}; } };
  const setKind = (p, id, kind) => { const k = kinds(p); if (kind) k[id] = kind; else delete k[id]; mkdirSync(dirOf(p), { recursive: true }); writeFileSync(kindsPath(p), JSON.stringify(k, null, 2) + '\n', { mode: 0o600 }); };
  const loginOf = (p, id) => {
    if (!logins.has(id)) logins.set(id, (accountLogin ?? ((env) => createCodexLogin({ env })))(envOf(p, id)));
    return logins.get(id);
  };
  const device = (p) => ({ ...readDevice(p), ...connectorState() });
  // WS1-a: 엔진 칸(IEON_CONTAINER_BOUNDARY=1)은 컨테이너가 경계라 차단 수준 표시가 다르다
  const wsView = (p) => workspacesView(JSON.parse(readFileSync(p, 'utf8')), { boundary: process.env.IEON_CONTAINER_BOUNDARY === '1' });
  // 이어온이 만든 Claude 새 세션 ID(이미 대화 목록에 있으므로 고르기 목록에서 뺀다)
  const createdIds = (p) => {
    try {
      const f = JSON.parse(readFileSync(p, 'utf8')).newSessions?.createdPath;
      return new Set(f && existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean) : []);
    } catch { return new Set(); }
  };
  const accounts = (p) => {
    const d = readDevice(p); const dir = dirOf(p);
    const k = kinds(p);
    for (const [id, l] of logins) if (l.view().state === 'done' && !k[id]) { setKind(p, id, 'subscription'); k[id] = 'subscription'; } // 기기 코드 로그인이 끝나면 구독으로 적음
    return { defaultLogin: { loggedIn: hasLogin(desktopCodexHome()), login: logins.get(DEFAULT_ID)?.view() ?? { state: 'idle' }, kind: k[DEFAULT_ID] ?? null },
      accounts: d.codexAccounts.map((a) => { const home = codexHomeOf(dir, a.id); const cp = readCodexCompat(home); // A2-c: 호환 주소는 호스트·모델만(키 없음)
        return { ...a, engine: 'codex', loggedIn: Boolean(cp) || hasLogin(home), login: logins.get(a.id)?.view() ?? { state: 'idle' }, kind: cp ? 'compat' : k[a.id] ?? null, ...(cp ? { compat: { host: compatHostOf(cp.baseUrl), model: cp.model } } : {}) }; }),
      defaultAccount: d.codexDefaultAccount, accountFor: d.codexAccountFor, threads: d.codexThreads.map((t) => ({ threadId: t.threadId, mode: t.mode })) };
  };
  const known = (p, id) => {
    if (!/^[a-z0-9]{2,16}$/.test(String(id)) || !readDevice(p).codexAccounts.some((a) => a.id === id)) throw Object.assign(new Error('not_found'), { http: 404 });
    return id;
  };

  // 기본 로그인 파일이 같이 쓰는 로그인을 가리키는 연결이면 { link, target }(Codex 로그아웃은 연결만 지우므로 원본도 지우고 연결을 되살린다)
  const sharedTarget = () => {
    const link = join(desktopCodexHome(), 'auth.json');
    try { if (!lstatSync(link).isSymbolicLink()) return null; return { link, target: resolve(dirname(link), readlinkSync(link)) }; } catch { return null; }
  };
  const knownOrDefault = (p, id) => (id === DEFAULT_ID ? DEFAULT_ID : known(p, id));
  // A2-b: PC Claude 계정. 서버(같이 쓰는 로그인이 있는 곳)에서는 쓰지 않는다.
  const cLogins = new Map();
  const cLoginOf = (p, id) => { if (!cLogins.has(id)) cLogins.set(id, (claudeAccountLogin ?? ((home) => createClaudeAccountLogin({ home, log })))(claudeHomeOf(dirOf(p), id))); return cLogins.get(id); };
  const cKnown = (p, id) => {
    if (claudeDir) throw Object.assign(new Error('claude_shared_login'), { http: 409 });
    if (!/^[a-z0-9]{2,16}$/.test(String(id)) || !readDevice(p).claudeAccounts.some((x) => x.id === id)) throw Object.assign(new Error('not_found'), { http: 404 });
    return id;
  };
  // 계정을 따로 고를 수 있는 Claude 대화: 이 PC의 이어온 새 세션(기록에 있고 실제 Claude 세션 파일이 있는 것) + 허용 목록의 Claude 대화
  const claudeSessions = (p) => {
    const out = new Map();
    try {
      const f = JSON.parse(readFileSync(p, 'utf8')).newSessions?.createdPath;
      if (f && existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
        try { const r = JSON.parse(l); if (/^[0-9a-f-]{36}$/i.test(String(r.id)) && findClaudeSession(r.id, claudeProjects)) out.set(r.id.toLowerCase(), { sessionId: r.id.toLowerCase(), name: String(r.name ?? '') }); } catch { /* 깨진 줄 */ }
      }
    } catch { /* 설정 없음 */ }
    for (const x of readDevice(p).cliSessions.filter((s) => s.engine === 'claude_cli')) if (!out.has(x.sessionId.toLowerCase())) out.set(x.sessionId.toLowerCase(), { sessionId: x.sessionId.toLowerCase(), name: '' });
    return [...out.values()].filter((s) => s.sessionId !== EXCLUDED_THREAD).slice(-50);
  };
  // A3: Antigravity 계정(새 세션용)
  const aLogins = new Map();
  const aLoginOf = (p, id) => { if (!aLogins.has(id)) aLogins.set(id, (agyLogin ?? ((home) => createAgyLogin({ bin: CLI_ENGINES.agy_cli.bin(), home, log })))(agyHomeOf(dirOf(p), id))); return aLogins.get(id); };
  const gKnown = (p, id) => { if (!/^[a-z0-9]{2,16}$/.test(String(id)) || !readDevice(p).grokAccounts.some((x) => x.id === id)) throw Object.assign(new Error('not_found'), { http: 404 }); return id; };
  const grokView = (p) => { const d = readDevice(p); const dir = dirOf(p);
    return { accounts: d.grokAccounts.map((x) => ({ ...x, engine: 'grok', kind: grokAccountKind(grokHomeOf(dir, x.id)) })), defaultAccount: d.grokDefaultAccount, installed: existsSync(CLI_ENGINES.grok_cli.bin()) }; };
  const aKnown = (p, id) => { if (!/^[a-z0-9]{2,16}$/.test(String(id)) || !readDevice(p).agyAccounts.some((x) => x.id === id)) throw Object.assign(new Error('not_found'), { http: 404 }); return id; };
  const agyView = (p) => { const d = readDevice(p); const dir = dirOf(p);
    return { accounts: d.agyAccounts.map((x) => { const home = agyHomeOf(dir, x.id); const kind = agyAccountKind(home); const cp = kind === 'compat' ? readAgyCompat(home) : null;
      return { ...x, engine: 'antigravity', kind, ...(cp ? { compat: { host: agyCompatHost(cp.baseUrl), models: cp.models, wire: cp.wire } } : {}), login: aLogins.get(x.id)?.view() ?? { state: 'idle' } }; }), defaultAccount: d.agyDefaultAccount, installed: existsSync(CLI_ENGINES.agy_cli.bin()) }; };
  const claudePc = (p) => {
    const d = readDevice(p); const dir = dirOf(p);
    // 호환 주소는 주소의 호스트·모델·확인된 조합 여부만(키는 내지 않음)
    const compatOf = (home) => { const cp = readCompat(home); return cp ? { host: compatHost(cp.baseUrl), model: cp.model, confirmed: compatConfirmed(cp.baseUrl) } : null; };
    return { accounts: d.claudeAccounts.map((x) => { const home = claudeHomeOf(dir, x.id); const kind = claudeAccountKind(home);
      return { ...x, engine: 'claude', kind, ...(kind === 'compat' ? { compat: compatOf(home) } : {}), login: cLogins.get(x.id)?.view() ?? { state: 'idle' } }; }), defaultAccount: d.claudeDefaultAccount,
      sessions: claudeSessions(p), accountFor: d.claudeAccountFor };
  };
  async function perform(op, a) {
    // Claude 로그인은 연결부 설정과 상관없이(허브 자신에도 있음)
    switch (op) {
      case 'claude.get': {
        const pc = !claudeDir && connectorConfigPath && existsSync(connectorConfigPath) ? claudePc(connectorConfigPath) : null; // A2-b: PC면 이어온 전용 계정 목록도
        return { status: 200, body: { ...claudeView(), ...(pc ? { pc } : {}) } };
      }
      case 'claude.login': claudeWritable(); claudeLoginJob().start(); return { status: 200, body: claudeView() };
      case 'claude.code': {
        claudeWritable();
        const r = claudeLoginJob().code(a.code);
        return r.error ? { status: 400, body: { error: r.error } } : { status: 200, body: claudeView() };
      }
      case 'claude.login.cancel': claudeLoginJob().cancel(); return { status: 200, body: claudeView() };
      case 'claude.apikey':
        claudeWritable();
        if (!CLAUDE_API_KEY.test(String(a.key ?? ''))) return { status: 400, body: { error: 'bad_api_key' } };
        saveClaudeLogin(claudeDir, 'api', String(a.key)); log({ event: 'claude_api_key', ok: true });
        return { status: 200, body: claudeView() };
      case 'claude.logout': claudeWritable(); removeClaudeLogin(claudeDir); log({ event: 'claude_logout' }); return { status: 200, body: claudeView() };
      default: break;
    }
    const p = cfg();
    switch (op) {
      case 'device.get': return { status: 200, body: { ...device(p), claudeServer: Boolean(claudeDir) } };
      // SV2: 서버(같이 쓰는 Claude 로그인이 있는 곳)에서만 — PC의 Claude는 채널 그대로(설계 2-2)
      case 'claude.sessions': {
        if (!claudeDir) return { status: 404, body: { error: 'claude_not_server' } };
        const on = new Set(readDevice(p).cliSessions.filter((x) => x.engine === 'claude_cli').map((x) => x.sessionId));
        const sessions = listClaudeSessions({ dir: claudeProjects, skip: createdIds(p) })
          .map((x) => ({ ...x, connected: on.has(x.sessionId), busy: busyOf(x.cwd) === 'busy' }));
        return { status: 200, body: { sessions } };
      }
      case 'claude.connect': {
        if (!claudeDir) return { status: 404, body: { error: 'claude_not_server' } };
        const s = findClaudeSession(String(a.sessionId ?? '').trim(), claudeProjects);
        if (!s) return { status: 404, body: { error: 'session_not_found' } };
        if (!s.cwd) return { status: 409, body: { error: 'no_working_directory' } };
        upsertCliSession(p, { engine: 'claude_cli', sessionId: s.sessionId, workingDirectory: s.cwd });
        return { status: 200, body: { sessionId: s.sessionId, title: s.title, cwd: s.cwd, ...(await applyDevice()) } };
      }
      case 'codex.threads': {
        if (!listThreads) return { status: 404, body: { error: 'codex_unavailable' } };
        let threads; try { threads = await listThreads(); } catch { return { status: 502, body: { error: 'codex_unavailable' } }; }
        const on = new Set(readDevice(p).codexThreads.map((x) => x.threadId.toLowerCase()));
        // 목록은 응답에만 담고 로그에는 남기지 않는다. 업무 대화는 한 번 더 뺀다.
        return { status: 200, body: { threads: threads.filter((t) => t.threadId !== EXCLUDED_THREAD).map((t) => ({ ...t, connected: on.has(t.threadId) })) } };
      }
      case 'codex.connect': {
        const threadId = String(a.threadId ?? '').trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(threadId)) return { status: 400, body: { error: 'bad_session_ref' } };
        if (threadId === EXCLUDED_THREAD) return { status: 400, body: { error: 'excluded_session' } };
        // 작업 폴더는 Codex가 알려 준 값을 쓰되, 그 PC에 없는 폴더면 비워 둔다(연결은 막지 않음 — 이 PC 화면의 연결과 같음)
        const dir = typeof a.workingDirectory === 'string' && a.workingDirectory ? a.workingDirectory : null;
        try { upsertCodexThread(p, { threadId, mode: 'alternate', workingDirectory: dir }); } catch (e) {
          if (!['working_directory_missing', 'bad_working_directory'].includes(e.message)) throw e;
          upsertCodexThread(p, { threadId, mode: 'alternate', workingDirectory: null });
        }
        return { status: 200, body: { threadId, ...(await applyDevice()) } };
      }
      case 'claude.accounts.add': {
        if (claudeDir) return { status: 409, body: { error: 'claude_shared_login' } };
        const id = 'c' + randomBytes(4).toString('hex');
        addClaudeAccount(p, { id, label: a.label });
        try { createClaudeHome(dirOf(p), id, claudeDesktop ? { desktop: claudeDesktop } : {}); } catch (e) { removeClaudeAccount(p, id); throw e; }
        log({ event: 'account_added', engine: 'claude' });
        return { status: 201, body: { id, ...claudePc(p) } };
      }
      case 'claude.accounts.login': cLoginOf(p, cKnown(p, a.id)).start(); return { status: 200, body: claudePc(p) };
      case 'claude.accounts.code': {
        const r = cLoginOf(p, cKnown(p, a.id)).code(a.code);
        return r.error ? { status: 400, body: { error: r.error } } : { status: 200, body: claudePc(p) };
      }
      case 'claude.accounts.cancel': cLoginOf(p, cKnown(p, a.id)).cancel(); return { status: 200, body: claudePc(p) };
      case 'claude.accounts.apikey': {
        const id = cKnown(p, a.id);
        if (!CLAUDE_API_KEY.test(String(a.key ?? ''))) return { status: 400, body: { error: 'bad_api_key' } };
        saveClaudeApiKey(claudeHomeOf(dirOf(p), id), String(a.key)); log({ event: 'account_api_key', engine: 'claude', ok: true });
        return { status: 200, body: claudePc(p) };
      }
      // G1: Grok 계정(새 세션용) — 키는 그 계정 폴더 api-key(600)에만, 화면·로그에 내지 않음
      case 'grok.accounts.get': return { status: 200, body: grokView(p) };
      case 'grok.accounts.add': {
        const id = 'k' + randomBytes(4).toString('hex');
        addGrokAccount(p, { id, label: a.label }); mkdirSync(grokHomeOf(dirOf(p), id), { recursive: true });
        log({ event: 'account_added', engine: 'grok' });
        return { status: 201, body: { id, ...grokView(p) } };
      }
      case 'grok.accounts.apikey': {
        const id = gKnown(p, a.id);
        if (!GROK_KEY.test(String(a.key ?? ''))) return { status: 400, body: { error: 'bad_api_key' } };
        saveGrokApiKey(grokHomeOf(dirOf(p), id), String(a.key)); log({ event: 'account_api_key', engine: 'grok', ok: true });
        return { status: 200, body: grokView(p) };
      }
      case 'grok.accounts.logout': { const id = gKnown(p, a.id); grokLogoutFiles(grokHomeOf(dirOf(p), id)); return { status: 200, body: grokView(p) }; }
      case 'grok.accounts.delete': {
        const id = gKnown(p, a.id); rmSync(grokHomeOf(dirOf(p), id), { recursive: true, force: true });
        removeGrokAccount(p, id); log({ event: 'account_removed', engine: 'grok' });
        return { status: 200, body: { ...grokView(p), ...(await applyDevice()) } };
      }
      case 'grok.accounts.use': useGrokAccount(p, { accountId: String(a.accountId ?? '') }); return { status: 200, body: { ...grokView(p), ...(await applyDevice()) } };
      case 'agy.accounts.get': return { status: 200, body: agyView(p) };
      case 'agy.accounts.add': {
        const id = 'g' + randomBytes(4).toString('hex');
        addAgyAccount(p, { id, label: a.label });
        mkdirSync(agyHomeOf(dirOf(p), id), { recursive: true });
        log({ event: 'account_added', engine: 'antigravity' });
        return { status: 201, body: { id, ...agyView(p) } };
      }
      // 2026-11-19 실측: ACP authenticate(oauth-personal)는 로그인 방식만 정하고 실제 Google 로그인은 하지 않는다("Auth succeeded" 뒤 "You are not logged into Antigravity").
      // 계정 폴더마다 구독 로그인하는 공식 길을 찾기 전에는 막는다(잘못 "로그인됨"으로 보이지 않게). API 키만.
      case 'agy.accounts.apikey': {
        const id = aKnown(p, a.id);
        if (!AGY_KEY.test(String(a.key ?? ''))) return { status: 400, body: { error: 'bad_api_key' } };
        saveAgyApiKey(agyHomeOf(dirOf(p), id), String(a.key)); log({ event: 'account_api_key', engine: 'antigravity', ok: true });
        return { status: 200, body: agyView(p) };
      }
      case 'agy.accounts.compat': {
        const id = aKnown(p, a.id);
        saveAgyCompat(agyHomeOf(dirOf(p), id), { baseUrl: a.baseUrl, key: a.key, models: a.models ?? '', wire: a.wire ?? 'gemini' });
        log({ event: 'account_compat', engine: 'antigravity', ok: true });
        return { status: 200, body: { ...agyView(p), ...(await applyDevice()) } };
      }
      case 'agy.accounts.logout': { const id = aKnown(p, a.id); aLoginOf(p, id).cancel(); agyLogoutFiles(agyHomeOf(dirOf(p), id)); return { status: 200, body: agyView(p) }; }
      case 'agy.accounts.delete': {
        const id = aKnown(p, a.id); aLoginOf(p, id).cancel(); aLogins.delete(id);
        // 계정 폴더에는 그 계정으로 만든 새 세션의 대화도 있다 — 지우면 그 새 세션은 이어 쓸 수 없다(화면에서 확인 받음)
        rmSync(agyHomeOf(dirOf(p), id), { recursive: true, force: true });
        removeAgyAccount(p, id); log({ event: 'account_removed', engine: 'antigravity' });
        return { status: 200, body: { ...agyView(p), ...(await applyDevice()) } };
      }
      case 'agy.accounts.use': useAgyAccount(p, { accountId: String(a.accountId ?? '') }); return { status: 200, body: { ...agyView(p), ...(await applyDevice()) } };
      case 'claude.accounts.compat': {
        const id = cKnown(p, a.id);
        saveCompat(claudeHomeOf(dirOf(p), id), { baseUrl: a.baseUrl, key: a.key, model: a.model, auth: a.auth ?? 'bearer' });
        log({ event: 'account_compat', engine: 'claude', ok: true });
        return { status: 200, body: { ...claudePc(p), ...(await applyDevice()) } };
      }
      case 'claude.accounts.logout': {
        const id = cKnown(p, a.id);
        cLoginOf(p, id).cancel();
        const ok = await claudeLogoutImpl(claudeHomeOf(dirOf(p), id));
        return ok ? { status: 200, body: claudePc(p) } : { status: 502, body: { error: 'logout_failed' } };
      }
      case 'claude.accounts.delete': {
        const id = cKnown(p, a.id);
        cLoginOf(p, id).cancel(); cLogins.delete(id);
        if (!(await claudeLogoutImpl(claudeHomeOf(dirOf(p), id)))) return { status: 502, body: { error: 'logout_failed' } };
        // 폴더를 먼저 지우고 성공하면 설정에서 뺀다(실패하면 목록에 남아 다시 지울 수 있게)
        removeClaudeHome(dirOf(p), id);
        removeClaudeAccount(p, id);
        log({ event: 'account_removed', engine: 'claude' });
        return { status: 200, body: { ...claudePc(p), ...(await applyDevice()) } };
      }
      case 'claude.accounts.use':
        if (claudeDir) return { status: 409, body: { error: 'claude_shared_login' } };
        useClaudeAccount(p, { sessionId: a.sessionId ?? null, accountId: String(a.accountId ?? ''), knownSession: (id) => claudeSessions(p).some((s) => s.sessionId === id) });
        return { status: 200, body: { ...claudePc(p), ...(await applyDevice()) } };
      case 'device.live':
        setLive(p, a.live);
        log({ event: 'device_live', live: a.live });
        return { status: 200, body: { live: a.live, ...(await applyDevice()) } };
      case 'device.codex.model':
        setCodexModel(p, a.model);
        log({ event: 'device_codex_model', set: Boolean(String(a.model ?? '').trim()) });
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'device.codex.put':
        upsertCodexThread(p, { threadId: a.threadId, mode: a.mode, workingDirectory: a.workingDirectory ?? null });
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'device.codex.delete':
        if (!removeCodexThread(p, a.threadId)) return { status: 404, body: { error: 'not_found' } };
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'device.cli.put':
        upsertCliSession(p, { engine: a.engine, sessionId: a.sessionId, workingDirectory: a.workingDirectory ?? null });
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'device.cli.delete':
        if (!removeCliSession(p, { engine: a.engine, sessionId: a.sessionId })) return { status: 404, body: { error: 'not_found' } };
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'workspace.get': return { status: 200, body: wsView(p) };
      case 'workspace.folder.add': {
        const id = addWorkspaceFolder(p, { name: a.name, path: a.path });
        log({ event: 'workspace_folder_added' });
        return { status: 201, body: { id, ...wsView(p) } };
      }
      case 'workspace.folder.delete':
        removeWorkspaceFolder(p, a.id); log({ event: 'workspace_folder_removed' });
        return { status: 200, body: wsView(p) };
      case 'workspace.attach':
        attachWorkspaceTo(p, { engine: String(a.engine ?? ''), sessionRef: a.sessionRef, personal: a.personal ?? null, shared: a.shared ?? [] });
        log({ event: 'workspace_attached', engine: String(a.engine ?? '') });
        return { status: 200, body: { ...wsView(p), ...(await applyDevice()) } };
      case 'mode.get': return modeAdmin ? { status: 200, body: modeAdmin.view() } : { status: 404, body: { error: 'not_found' } };
      case 'mode.set': return modeAdmin ? modeAdmin.set(String(a.mode ?? '')) : { status: 404, body: { error: 'not_found' } };
      case 'accounts.get': return { status: 200, body: accounts(p) };
      case 'accounts.add': {
        const id = 'a' + randomBytes(4).toString('hex');
        addCodexAccount(p, { id, label: a.label });
        try { createCodexHome(dirOf(p), id); } catch (e) { removeCodexAccount(p, id); throw e; }
        log({ event: 'account_added', engine: 'codex' });
        return { status: 201, body: { id, ...accounts(p) } };
      }
      case 'accounts.use':
        useCodexAccount(p, { threadId: a.threadId ?? null, accountId: String(a.accountId ?? '') });
        return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } };
      case 'accounts.compat': {
        const id = known(p, a.id);
        saveCodexCompat(codexHomeOf(dirOf(p), id), { baseUrl: a.baseUrl, key: a.key, model: a.model });
        log({ event: 'account_compat', engine: 'codex', ok: true });
        return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } };
      }
      case 'accounts.login': loginOf(p, knownOrDefault(p, a.id)).start(); return { status: 200, body: accounts(p) };
      case 'accounts.login.cancel': loginOf(p, knownOrDefault(p, a.id)).cancel(); return { status: 200, body: accounts(p) };
      case 'accounts.logout': {
        const id = knownOrDefault(p, a.id);
        if (id !== DEFAULT_ID && removeCodexCompat(codexHomeOf(dirOf(p), id)) && !hasLogin(codexHomeOf(dirOf(p), id))) return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } }; // A2-c: 호환 주소 지우기
        const shared = id === DEFAULT_ID ? sharedTarget() : null; // 허브·칸이 같이 쓰는 로그인이면 원본 경로
        await loginOf(p, id).logout();
        if (shared) { rmSync(shared.target, { force: true }); try { rmSync(shared.link, { force: true }); symlinkSync(shared.target, shared.link); } catch { /* 다시 로그인하면 ieun.sh share-login이 맞춤 */ } }
        setKind(p, id, null); return { status: 200, body: accounts(p) };
      }
      case 'accounts.apikey': {
        const id = knownOrDefault(p, a.id);
        if (!API_KEY.test(String(a.key ?? ''))) return { status: 400, body: { error: 'bad_api_key' } };
        const ok = await loginOf(p, id).apiKeyLogin(String(a.key));
        if (!ok) return { status: 502, body: { error: 'api_key_login_failed' } };
        setKind(p, id, 'api'); log({ event: 'account_api_key', ok: true });
        return { status: 200, body: accounts(p) };
      }
      case 'accounts.delete': {
        const id = known(p, a.id);
        if (hasLogin(codexHomeOf(dirOf(p), id))) await loginOf(p, id).logout();
        loginOf(p, id).cancel(); logins.delete(id);
        // 폴더를 먼저 지우고 성공하면 설정에서 뺀다(실패하면 목록에 남아 다시 지울 수 있게).
        removeCodexHome(dirOf(p), id);
        removeCodexAccount(p, id);
        log({ event: 'account_removed', engine: 'codex' });
        return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } };
      }
      default: return { status: 400, body: { error: 'bad_op' } };
    }
  }

  return {
    // { status, body }. 오류는 그 코드로(설정 검사 오류는 400, 없는 것은 404).
    async run(op, args = {}) {
      if (!Object.hasOwn(OPS, op)) return { status: 400, body: { error: 'bad_op' } };
      const a = args && typeof args === 'object' ? args : {};
      try { return await perform(op, a); } catch (e) { return { status: e.http ?? 500, body: { error: e.http ? e.message : 'internal' } }; }
    },
  };
}
