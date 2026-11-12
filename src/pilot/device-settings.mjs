// W4: PC 로컬 웹의 기기 설정(설계 WEB_FIRST 원칙 6). 연결부 설정 파일(connector.json)의 안전 설정 —
// 실제 실행(live)·Codex 허용 목록·연결 방식·작업 폴더 — 을 이 PC 화면에서 바꾼다. 허브 웹에서는 바꿀 수 없다.
// 다른 항목(서버 주소·토큰 파일 경로·채널·새 세션)은 그대로 둔다. 임시 파일에 쓴 뒤 바꿔치기한다.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './parent-watch.mjs';
import { codexAccounts, cleanLabel, MAX_ACCOUNTS, PC_DEFAULT } from './accounts.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXCLUDED_THREAD = '01a0dadd-739f-74d2-93c5-9c405cc1019b'; // 업무 대화(AGENTS 안전 규칙)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code) => { throw Object.assign(new Error(code), { http: 400 }); };

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
function write(path, c) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n');
  renameSync(tmp, path);
}

export function readDevice(path) {
  const c = read(path);
  const allow = c.codex?.allowlist ?? [];
  return {
    live: c.live === true,
    codexThreads: allow.map((threadId) => ({ threadId, mode: c.codex?.modes?.[threadId] ?? 'alternate', workingDirectory: c.codex?.workingDirectories?.[threadId] ?? null })),
    sharedServer: Boolean(c.codex?.shared?.endpoint),
    claudeChannel: Boolean(c.claude?.baseUrl),
    // A2: 이어온 전용 Codex 계정(로그인 여부는 서버가 따로 붙인다), 엔진 기본, 대화별 선택
    codexAccounts: codexAccounts(c),
    codexDefaultAccount: c.codex?.defaultAccount ?? PC_DEFAULT,
    // 대화별로 직접 고른 것만(없으면 엔진 기본을 따름)
    codexAccountFor: Object.fromEntries(allow.filter((t) => c.codex?.accountFor?.[t]).map((t) => [t, c.codex.accountFor[t]])),
  };
}

// A2: 계정 등록(이름표만 설정에, 폴더는 accounts.mjs가 만든다). id는 서버가 정한다.
export function addCodexAccount(path, { id, label }) {
  const c = read(path);
  const list = codexAccounts(c);
  if (list.length >= MAX_ACCOUNTS) fail('too_many_accounts');
  const name = cleanLabel(label);
  if (!name) fail('bad_label');
  c.codex ??= {}; c.codex.accounts = [...list, { id, label: name }];
  write(path, c);
}

// A2: 계정 지우기 — 그 계정을 쓰던 대화·기본값은 PC 기본 로그인으로 돌린다(지운 계정을 가리킨 채 남지 않게).
export function removeCodexAccount(path, id) {
  const c = read(path);
  if (!codexAccounts(c).some((a) => a.id === id)) return false;
  c.codex.accounts = codexAccounts(c).filter((a) => a.id !== id);
  if (c.codex.defaultAccount === id) delete c.codex.defaultAccount;
  for (const [t, a] of Object.entries(c.codex.accountFor ?? {})) if (a === id) delete c.codex.accountFor[t];
  write(path, c);
  return true;
}

// A2: 계정 고르기. threadId가 없으면 엔진 기본(새 세션·따로 고르지 않은 대화). 'inherit'는 대화별 선택을 지워 기본을 따르게 한다.
export function useCodexAccount(path, { threadId = null, accountId }) {
  const c = read(path);
  const ok = accountId === PC_DEFAULT || codexAccounts(c).some((a) => a.id === accountId);
  c.codex ??= {};
  if (!threadId) {
    if (!ok) fail('bad_account');
    if (accountId === PC_DEFAULT) delete c.codex.defaultAccount; else c.codex.defaultAccount = accountId;
  } else {
    const id = String(threadId).trim().toLowerCase();
    if (!UUID.test(id) || id === EXCLUDED_THREAD) fail('bad_thread_id');
    if (!c.codex.allowlist?.includes(id)) fail('thread_not_allowed');
    c.codex.accountFor ??= {};
    if (accountId === 'inherit') delete c.codex.accountFor[id];
    else { if (!ok) fail('bad_account'); c.codex.accountFor[id] = accountId; }
  }
  write(path, c);
}

export function setLive(path, live) {
  if (typeof live !== 'boolean') fail('bad_live');
  const c = read(path); c.live = live; write(path, c);
}

export function upsertCodexThread(path, { threadId, mode = 'alternate', workingDirectory = null }) {
  const id = String(threadId ?? '').trim().toLowerCase();
  if (!UUID.test(id)) fail('bad_thread_id');
  if (id === EXCLUDED_THREAD) fail('excluded_session');
  if (!['alternate', 'shared_server'].includes(mode)) fail('bad_mode');
  const c = read(path);
  if (mode === 'shared_server' && !c.codex?.shared?.endpoint) fail('shared_server_not_configured');
  let dir = workingDirectory ? String(workingDirectory).trim() : null;
  if (dir) {
    if (dir.length > 300 || !isAbsolute(dir)) fail('bad_working_directory');
    try { if (!statSync(dir).isDirectory()) fail('bad_working_directory'); } catch (e) { if (e.http) throw e; fail('working_directory_missing'); }
  }
  c.codex ??= {}; c.codex.allowlist ??= []; c.codex.modes ??= {}; c.codex.workingDirectories ??= {};
  if (!c.codex.allowlist.includes(id)) c.codex.allowlist.push(id);
  c.codex.modes[id] = mode;
  if (dir) c.codex.workingDirectories[id] = dir.replaceAll('\\', '/'); else delete c.codex.workingDirectories[id];
  write(path, c);
}

export function removeCodexThread(path, threadId) {
  const id = String(threadId ?? '').trim().toLowerCase();
  const c = read(path);
  if (!c.codex?.allowlist?.includes(id)) return false;
  c.codex.allowlist = c.codex.allowlist.filter((x) => x !== id);
  delete c.codex.modes?.[id]; delete c.codex.workingDirectories?.[id]; delete c.codex.accountFor?.[id];
  write(path, c);
  return true;
}

// 이 PC 서버가 띄우는 로컬 연결부(설정 manageLocalConnector). 설정이 바뀌면 다시 띄워 새 설정을 읽게 한다.
export function createLocalConnector({ connectorConfigPath, spawnImpl = spawn, log = () => {} }) {
  let child = null; let want = false;
  const start = () => {
    if (child || !connectorConfigPath || !existsSync(connectorConfigPath)) return Boolean(child);
    want = true;
    const c = spawnImpl(process.execPath, ['src/pilot/connector.mjs', connectorConfigPath], { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'ignore', 'inherit'] });
    child = c;
    log({ event: 'local_connector_start' });
    // 지금 연결부의 종료일 때만 처리(늦게 온 이전 연결부의 종료 알림이 새 연결부를 놓치지 않게)
    c.on('exit', (code) => { if (child !== c) return; child = null; log({ event: 'local_connector_exit', code }); if (want) setTimeout(() => { if (want && !child) start(); }, 5000).unref?.(); });
    return true;
  };
  const stop = () => new Promise((ok) => {
    want = false;
    if (!child) return ok();
    const c = child; child = null;
    c.once?.('exit', () => ok()); c.kill('SIGTERM'); setTimeout(ok, 3000).unref?.();
  });
  return { start, stop, async restart() { await stop(); return start(); }, running: () => Boolean(child) };
}
