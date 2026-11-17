// SV2 남은 것(신산님 2026-11-17 "서버 Claude 기존 대화 고르기 진행"): 서버 엔진 칸에서 사람이 연 Claude 대화를 이어온 대화로 고른다.
// - 목록: 그 칸의 Claude 대화 기록 폴더(~/.claude/projects/<폴더>/<세션 ID>.jsonl)에서 최근 것만 — 세션 ID·제목(요약 또는 첫 질문 앞부분)·작업 폴더·최근 시간.
//   Codex 대화 목록(thread/list의 제목)과 같은 정도만 보이고 본문 전체는 읽지 않는다(파일 앞부분만). 업무 대화 ID는 뺀다(AGENTS).
// - 사용 중: 사람이 그 대화의 작업 폴더에서 Claude를 실행 중이면(리눅스 /proc) 보내지 않는다(자동 대기·재전송 없음, 설계 SERVER_SESSIONS 2-2).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 256 * 1024;

export const claudeProjectsDir = (env = process.env) => join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude'), 'projects');

function head(path) {
  const fd = openSync(path, 'r');
  try { const b = Buffer.alloc(HEAD_BYTES); const n = readSync(fd, b, 0, HEAD_BYTES, 0); return b.subarray(0, n).toString('utf8'); } finally { closeSync(fd); }
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ') : '');
const clean = (s) => String(s ?? '').replace(/<[^>]{1,40}>[\s\S]*?<\/[^>]{1,40}>/g, ' ').replace(/\s+/g, ' ').trim();

// 파일 앞부분에서 작업 폴더와 제목만 뽑는다(요약이 있으면 요약, 없으면 첫 사용자 질문 앞 60자).
export function sessionInfo(path) {
  let cwd = null; let summary = null; let first = null;
  for (const line of head(path).split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof r.cwd === 'string') cwd = r.cwd;
    if (!summary && r.type === 'summary' && r.summary) summary = clean(r.summary);
    if (!first && r.type === 'user' && !r.isMeta && r.message?.role === 'user') { const t = clean(textOf(r.message.content)); if (t) first = t; }
    if (cwd && (summary || first)) break;
  }
  const title = (summary || first || '').slice(0, 60);
  return { cwd, title: title || null };
}

// 최근 대화 목록. skip: 이미 이어온이 만든 새 세션 ID 등 뺄 것(Set).
export function listClaudeSessions({ dir = claudeProjectsDir(), limit = 30, skip = new Set() } = {}) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const p of readdirSync(dir, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    for (const f of readdirSync(join(dir, p.name), { withFileTypes: true })) {
      const id = basename(f.name, '.jsonl');
      if (!f.isFile() || !f.name.endsWith('.jsonl') || !UUID.test(id) || id.toLowerCase() === EXCLUDED || skip.has(id)) continue;
      const path = join(dir, p.name, f.name);
      try { files.push({ id, path, mtime: statSync(path).mtimeMs }); } catch { /* 지워짐 */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit).map(({ id, path, mtime }) => {
    let info = { cwd: null, title: null }; try { info = sessionInfo(path); } catch { /* 읽기 실패 — 목록엔 남김 */ }
    return { sessionId: id, title: info.title, cwd: info.cwd, updatedAt: new Date(mtime).toISOString() };
  });
}

export function findClaudeSession(id, dir = claudeProjectsDir()) {
  if (!UUID.test(String(id)) || String(id).toLowerCase() === EXCLUDED || !existsSync(dir)) return null;
  for (const p of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, p.name, `${id}.jsonl`);
    if (p.isDirectory() && existsSync(path)) return { sessionId: id, ...sessionInfo(path) };
  }
  return null;
}

// 그 작업 폴더에서 Claude가 실행 중인가(리눅스만 판별): 'busy' | 'free' | 'unknown'.
// 사람이 칸에서 `claude`(--continue·--resume)로 연 화면을 찾는다. 같은 폴더의 다른 대화를 열어 둔 경우도 사용 중으로 본다(조심하는 쪽).
export function claudeBusy(cwd, { proc = '/proc', platform = process.platform } = {}) {
  if (platform !== 'linux' || !cwd || !existsSync(proc)) return 'unknown';
  for (const pid of readdirSync(proc)) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    let argv;
    try { argv = readFileSync(join(proc, pid, 'cmdline'), 'utf8').split('\0').filter(Boolean); } catch { continue; }
    const isClaude = argv.length && (basename(argv[0]) === 'claude' || argv.slice(0, 3).some((a) => /@anthropic-ai\/claude-code\/cli\.js$/.test(a)));
    if (!isClaude) continue;
    let where; try { where = readlinkSync(join(proc, pid, 'cwd')); } catch { continue; }
    if (where === cwd) return 'busy';
  }
  return 'free';
}
