// WS1-a 작업공간(설계 WORKSPACES 2절, 신산님 2026-11-18 "WS1-a 진행"): 그 PC(또는 엔진 칸)의 폴더를 사람이 등록하고,
// AI 직원(허용 목록의 세션)마다 개인 폴더 하나 + 공유 폴더 여러 개(읽기만/읽기·쓰기)를 붙인다. 설정은 그 기기의 연결부 설정(connector.json)
// `workspaces`에 둔다 — 실제로 막는 것은 그 기기의 연결부라서, 허브 DB가 아니라 기기 설정이 기준이다.
//   folders: [{ id, name, path }]
//   attach:  { "<engine>:<sessionRef>": { personal: id|null, shared: [{ id, write }] } }
// 붙이지 않은 세션은 지금과 똑같이 동작한다(보존). 업무 대화에는 붙일 수 없다.
import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b'; // 업무 대화(AGENTS 안전 규칙)
export const WS_ENGINES = ['codex_thread', 'claude_cli', 'agy_cli', 'grok_cli'];
export const MAX_FOLDERS = 30;
export const MAX_SHARED = 10;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };
const norm = (p) => String(p).replaceAll('\\', '/').replace(/\/+$/, '');
const low = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const within = (child, parent) => { const c = low(norm(child)); const p = low(norm(parent)); return c === p || c.startsWith(p + '/'); };
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// WS0 실측: Codex는 임시 폴더(%TEMP%·/tmp)를 늘 쓰기 허용 → 그 아래 폴더는 직원끼리 막히지 않으므로 등록하지 않는다.
export function tempRoots(env = process.env) {
  return [...new Set([tmpdir(), env.TEMP, env.TMP, env.TMPDIR, process.platform === 'win32' ? null : '/tmp'].filter(Boolean).map((p) => norm(real(p))))];
}

export function readWorkspaces(c) {
  const w = c.workspaces ?? {};
  return { folders: Array.isArray(w.folders) ? w.folders : [], attach: w.attach && typeof w.attach === 'object' ? w.attach : {} };
}
const allowed = (c, engine) => (engine === 'codex_thread' ? c.codex?.allowlist ?? [] : c.cliEngines?.[engine]?.allowlist ?? []);

// 폴더 등록: 이 기기에 실제로 있는 폴더(절대 경로)만, 이름은 사람이 붙인다. 임시 폴더 아래·이미 등록한 폴더는 거절.
export function addFolder(c, { name, path }, { env = process.env } = {}) {
  const w = readWorkspaces(c);
  if (w.folders.length >= MAX_FOLDERS) fail('too_many_folders');
  const label = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (!label) fail('bad_folder_name');
  if (w.folders.some((f) => f.name.toLowerCase() === label.toLowerCase())) fail('folder_name_taken', 409);
  const raw = String(path ?? '').trim();
  if (!raw || raw.length > 300 || !isAbsolute(raw)) fail('bad_folder_path');
  try { if (!statSync(raw).isDirectory()) fail('bad_folder_path'); } catch (e) { if (e.http) throw e; fail('folder_missing'); }
  const p = norm(real(raw));
  if (tempRoots(env).some((t) => within(p, t))) fail('folder_in_temp');
  if (w.folders.some((f) => low(norm(f.path)) === low(p))) fail('folder_already_added', 409);
  const id = 'f' + randomBytes(4).toString('hex');
  c.workspaces = { ...w, folders: [...w.folders, { id, name: label, path: p }] };
  return id;
}

// 폴더 빼기: 직원에 붙어 있으면 거절(어느 직원이 쓰는지 모른 채 사라지지 않게 — 먼저 떼기).
export function removeFolder(c, id) {
  const w = readWorkspaces(c);
  if (!w.folders.some((f) => f.id === id)) fail('not_found', 404);
  const used = Object.values(w.attach).some((a) => a.personal === id || (a.shared ?? []).some((s) => s.id === id));
  if (used) fail('folder_in_use', 409);
  c.workspaces = { ...w, folders: w.folders.filter((f) => f.id !== id) };
}

// 직원에 붙이기(personal·shared 모두 비면 떼기). 그 기기 허용 목록에 있는 세션만.
export function attachWorkspace(c, { engine, sessionRef, personal = null, shared = [] }) {
  if (!WS_ENGINES.includes(engine)) fail('bad_engine');
  const ref = String(sessionRef ?? '').trim();
  if (!ref || ref.toLowerCase() === EXCLUDED) fail('excluded_session');
  if (!allowed(c, engine).includes(engine === 'codex_thread' ? ref.toLowerCase() : ref)) fail('session_not_allowed', 403);
  const w = readWorkspaces(c);
  const ids = new Set(w.folders.map((f) => f.id));
  const pid = personal ? String(personal) : null;
  if (pid && !ids.has(pid)) fail('bad_folder');
  if (!Array.isArray(shared) || shared.length > MAX_SHARED) fail('bad_shared');
  const seen = new Set(pid ? [pid] : []);
  const list = shared.map((s) => {
    const id = String(s?.id ?? '');
    if (!ids.has(id) || seen.has(id)) fail('bad_folder');
    seen.add(id);
    return { id, write: s.write === true };
  });
  const key = `${engine}:${engine === 'codex_thread' ? ref.toLowerCase() : ref}`;
  const attach = { ...w.attach };
  if (!pid && !list.length) delete attach[key]; else attach[key] = { personal: pid, shared: list };
  c.workspaces = { ...w, attach };
}

// 실행 때 쓰는 모양: { personal: 경로|null, write: [경로], read: [경로] }. 지워진 폴더는 건너뛴다.
export function workspaceFor(c, engine, sessionRef) {
  const w = readWorkspaces(c);
  const a = w.attach[`${engine}:${engine === 'codex_thread' ? String(sessionRef).toLowerCase() : sessionRef}`];
  if (!a) return null;
  const byId = new Map(w.folders.map((f) => [f.id, f]));
  const personal = byId.get(a.personal)?.path ?? null;
  const pick = (write) => (a.shared ?? []).filter((s) => s.write === write).map((s) => byId.get(s.id)?.path).filter(Boolean);
  return { personal, write: pick(true), read: pick(false) };
}

// 질문 앞에 한 줄(엔진이 어디를 써야 하는지 알게 — 안내일 뿐 차단 아님)
export function workspaceLine(ws) {
  if (!ws) return '';
  const parts = [ws.personal && `개인: ${ws.personal}`, ws.write.length && `공유(쓰기): ${ws.write.join(', ')}`, ws.read.length && `공유(읽기만): ${ws.read.join(', ')}`].filter(Boolean);
  return parts.length ? `[작업 공간] ${parts.join(' · ')}\n\n` : '';
}

// 차단 수준(설계 3절 표 + WS0 실측 + 2026-11-18 작업 모드 실측). 사람이 알아볼 말로: 허용 필요 = 사람이 카드에서 허용해야만 써짐, 정리만 = 안내만.
// 작업 모드(approvalPolicy untrusted)는 파일을 고칠 때마다 카드로 묻고, 사람이 허용하면 작업 폴더 밖도 써진다(실측: outside 파일 생김) — 그래서 "차단"이라 하지 않는다.
export function blockLevel(engine, { boundary = false } = {}) {
  if (engine === 'codex_thread') {
    return boundary
      ? { write: 'limited', writeText: '엔진 칸 컨테이너가 경계 — 칸 밖은 못 쓰고, 칸 안 폴더끼리는 정리만(파일 수정은 승인 카드로 물음)', read: 'organize', readText: '정리만 — 칸 안 다른 폴더도 읽을 수 있어요' }
      : { write: 'approval', writeText: '허용할 때만 — 작업 모드에서 파일을 고칠 때마다 카드로 물어요. 작업 폴더 밖이면 카드에 "작업 폴더 밖"이 붙고, 허용하면 써져요', read: 'organize', readText: '정리만 — 이 직원은 다른 폴더도 읽을 수 있어요' };
  }
  if (engine === 'agy_cli') return { write: 'none', writeText: '쓰지 않음(Antigravity 읽기 전용 실행)', read: 'organize', readText: '정리만 — 이어온은 안내만 해요' };
  return { write: 'organize', writeText: '정리만 — 그 세션 설정 그대로, 이어온은 폴더를 안내만 해요', read: 'organize', readText: '정리만 — 이어온은 안내만 해요' };
}

// 화면용: 폴더 목록 + 붙인 것(이름·권한·차단 수준). 폴더 경로는 그 기기 웹 화면에서만 보인다(설정 화면).
export function workspacesView(c, { boundary = false } = {}) {
  const w = readWorkspaces(c);
  const byId = new Map(w.folders.map((f) => [f.id, f]));
  const attached = Object.entries(w.attach).map(([key, a]) => {
    const i = key.indexOf(':'); const engine = key.slice(0, i);
    return { engine, sessionRef: key.slice(i + 1), personal: a.personal ?? null, shared: a.shared ?? [], level: blockLevel(engine, { boundary }),
      summary: summaryOf(a, byId) };
  });
  const used = new Set(Object.values(w.attach).flatMap((a) => [a.personal, ...(a.shared ?? []).map((s) => s.id)]).filter(Boolean));
  return { folders: w.folders.map((f) => ({ ...f, inUse: used.has(f.id) })), attached, tempRoots: tempRoots(),
    levels: Object.fromEntries(WS_ENGINES.map((e) => [e, blockLevel(e, { boundary })])) }; // 붙이기 전 확인 화면용
}

// 이름만(메신저 /status·대화 목록 — 경로 없이)
export function summaryOf(a, byId) {
  if (!a) return null;
  return { personal: byId.get(a.personal)?.name ?? null, shared: (a.shared ?? []).map((s) => ({ name: byId.get(s.id)?.name ?? '?', write: s.write === true })) };
}
