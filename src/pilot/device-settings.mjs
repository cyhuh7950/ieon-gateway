// W4: PC 로컬 웹의 기기 설정(설계 WEB_FIRST 원칙 6). 연결부 설정 파일(connector.json)의 안전 설정 —
// 실제 실행(live)·Codex 허용 목록·연결 방식·작업 폴더 — 을 이 PC 화면에서 바꾼다. 허브 웹에서는 바꿀 수 없다.
// 다른 항목(서버 주소·토큰 파일 경로·채널·새 세션)은 그대로 둔다. 임시 파일에 쓴 뒤 바꿔치기한다.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './parent-watch.mjs';

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
  };
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
  delete c.codex.modes?.[id]; delete c.codex.workingDirectories?.[id];
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
