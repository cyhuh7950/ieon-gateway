// Codex thread writer 잠금 읽기 전용 검사(X0). 파일 생성·삭제·쓰기·잠금 시도를 하지 않는다.
// - Windows: lock-probe.ps1(LockFileEx 비차단 공유 잠금 1회).
// - Linux: 잠금 파일의 inode가 /proc/locks에 쓰기(WRITE) 잠금으로 올라 있는지 읽기만 한다(flock·POSIX 잠금 모두 보임).
//   Codex가 Linux에서 실제로 어떤 방식으로 잠그는지는 WSL 실측 전까지 미검증이다. 확인 못 하면 LOCK_CHECK_ERROR로 보고해 실행하지 않는다.
// 결과 outcome: NO_LOCK_FILE · NO_WRITER_LOCK · WRITER_LOCK_CONFLICT · OPEN_FAILED · LOCK_CHECK_ERROR
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCLUDED_THREAD = '01a0dadd-739f-74d2-93c5-9c405cc1019b'; // 업무 대화. 검증 대상에서 제외됨
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PS1 = fileURLToPath(new URL('./lock-probe.ps1', import.meta.url));

function validate(threadId) {
  if (!ID_RE.test(String(threadId))) throw new Error('INVALID_THREAD_ID');
  if (threadId === EXCLUDED_THREAD) throw new Error('EXCLUDED_THREAD');
}

// /proc/locks 한 줄: "1: POSIX  ADVISORY  WRITE 1234 08:01:131075 0 EOF" → { type, mode, inode }
export function parseProcLocks(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (line.includes('->')) continue; // 잠금을 기다리는 쪽이지 쥔 쪽이 아니다
    const f = line.trim().split(/\s+/);
    const i = f.findIndex((x) => /^[0-9a-f]+:[0-9a-f]+:\d+$/i.test(x));
    if (i < 0) continue;
    const mode = f.find((x) => x === 'READ' || x === 'WRITE');
    out.push({ type: f[1], mode: mode ?? null, inode: Number(f[i].split(':')[2]) });
  }
  return out;
}

// deps: { exists, stat, readLocks, lockRoot } — 시험에서 바꿔 끼운다.
export function probeLinux(threadId, deps = {}) {
  validate(threadId);
  const root = deps.lockRoot ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'thread-writer-locks');
  const path = join(root, `${threadId}.lock`);
  const exists = deps.exists ?? existsSync;
  const stat = deps.stat ?? ((p) => statSync(p));
  const readLocks = deps.readLocks ?? (() => readFileSync('/proc/locks', 'utf8'));
  const base = { threadId, outcome: null, attempts: 0, sourceFileCreated: false, sourceBytesWritten: 0, modelTurnStarts: 0, threadResumeRequests: 0 };
  if (!exists(path)) return { ...base, outcome: 'NO_LOCK_FILE' }; // 한 번도 재개되지 않았거나 정리된 상태. 잠금 없음과 같다고 단정하지 않는다
  let ino;
  try { ino = stat(path).ino; } catch { return { ...base, outcome: 'OPEN_FAILED' }; }
  let locks;
  try { locks = parseProcLocks(readLocks()); } catch { return { ...base, outcome: 'LOCK_CHECK_ERROR' }; }
  // 같은 inode에 쓰기 잠금이 하나라도 있으면 충돌로 본다(다른 파일시스템의 같은 inode 번호와 겹칠 수 있으나 안전한 쪽으로 판단).
  const conflict = locks.some((l) => l.inode === ino && l.mode === 'WRITE');
  return { ...base, outcome: conflict ? 'WRITER_LOCK_CONFLICT' : 'NO_WRITER_LOCK' };
}

export function probeWindows(threadId) {
  validate(threadId);
  return JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', PS1, '-ThreadId', threadId], { encoding: 'utf8' }));
}

export const probeLock = (threadId, deps) => (process.platform === 'win32' ? probeWindows(threadId) : probeLinux(threadId, deps));
export const lockOutcome = (threadId) => probeLock(threadId).outcome;

// CLI: node src/pilot/lock-probe.mjs <threadId>  → JSON 한 줄
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(JSON.stringify(probeLock(process.argv[2]))); } catch (e) { console.error(String(e.message)); process.exit(2); }
}
