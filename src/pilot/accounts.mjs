// A2(ENGINE_ACCOUNTS EA0·EA1·EA9): 엔진마다 이어온 전용 계정. 지금은 Codex만(A0 실측 PASS, 2026-11-12).
// 계정 하나 = 이어온 전용 폴더 하나(CODEX_HOME). 로그인은 그 폴더에만(신산님이 공식 기기 코드로), 세션 기록·잠금은
// Desktop 폴더와 같은 것을 쓴다(디렉터리 연결 junction 3개 + 상태 DB는 공식 CODEX_SQLITE_HOME).
// 이어온은 로그인 파일을 읽거나 옮기지 않는다(있는지만 본다). 프로세스 전체 환경(process.env)은 바꾸지 않고 질문마다 SDK에만 넘긴다.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const PC_DEFAULT = 'pc_default';
export const MAX_ACCOUNTS = 5;
export const LINKED = ['sessions', 'archived_sessions', 'thread-writer-locks'];
const ID = /^[a-z0-9]{2,16}$/;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };

// Desktop(PC 기본 로그인)의 Codex 폴더. 이어온 전용 계정은 process.env.CODEX_HOME을 바꾸지 않으므로 이 값은 늘 Desktop 쪽이다.
export const desktopCodexHome = (env = process.env) => env.CODEX_HOME || join(homedir(), '.codex');
// 계정 폴더 뿌리: PC는 설정 파일(.local/s2/connector.json) 옆의 .local/accounts, 허브는 데이터 폴더(/data/connector.json) 안의
// /data/accounts(보존되는 볼륨 안). 설정에 accountsDir가 있으면 그것.
export const accountsDirFor = (cfgPath, c = {}) => {
  const d = dirname(resolve(cfgPath));
  return resolve(c.accountsDir ?? (basename(d) === 's2' ? join(d, '..', 'accounts') : join(d, 'accounts')));
};
export const codexHomeOf = (dir, id) => { if (!ID.test(String(id))) fail('bad_account'); return join(dir, 'codex', id); };
// 로그인 여부(파일이 있는지만 — 내용은 읽지 않는다). 계정 폴더 config.toml이 파일 보관(file)으로 고정한다.
export const hasLogin = (home) => existsSync(join(home, 'auth.json'));
export const cleanLabel = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);

export function codexAccounts(c) {
  const list = Array.isArray(c.codex?.accounts) ? c.codex.accounts.filter((a) => ID.test(String(a?.id))) : [];
  return list.map((a) => ({ id: a.id, label: cleanLabel(a.label) || a.id }));
}

// 대화(또는 새 세션)의 계정: 대화별로 고른 것 → 엔진 기본 → PC 기본 로그인. 없는 계정이 남아 있으면 PC 기본으로 보지 않고 그대로 돌려줘
// 보내기 전에 막는다(어느 계정인지 모르는 채로 다른 계정 사용량을 쓰지 않게).
export function codexAccountId(c, threadId) {
  const per = threadId ? c.codex?.accountFor?.[String(threadId).toLowerCase()] : undefined;
  return per ?? c.codex?.defaultAccount ?? PC_DEFAULT;
}

// SDK에 넘길 환경. PC 기본이면 null(지금처럼 new Codex()). 계정이 없거나 로그인 전이면 보내기 전에 거절.
export function codexEnvFor(c, dir, threadId, { env = process.env } = {}) {
  const id = codexAccountId(c, threadId);
  if (id === PC_DEFAULT) return null;
  if (!codexAccounts(c).some((a) => a.id === id)) fail('account_missing', 409);
  const home = codexHomeOf(dir, id);
  if (!hasLogin(home)) fail('account_not_logged_in', 409);
  return { ...env, CODEX_HOME: home, CODEX_SQLITE_HOME: desktopCodexHome(env) };
}

export function accountLabel(c, id) {
  if (id === PC_DEFAULT) return null;
  return codexAccounts(c).find((a) => a.id === id)?.label ?? null;
}

// 계정 폴더 만들기: junction 3개(대상이 없으면 Desktop 쪽에 빈 폴더를 만든다 — Codex도 처음 쓸 때 만든다) + 파일 보관 고정 설정.
export function createCodexHome(dir, id, { desktop = desktopCodexHome() } = {}) {
  const home = codexHomeOf(dir, id);
  if (existsSync(home)) fail('account_exists', 409);
  mkdirSync(home, { recursive: true });
  for (const n of LINKED) {
    const target = join(desktop, n);
    mkdirSync(target, { recursive: true });
    symlinkSync(target, join(home, n), 'junction');
  }
  writeFileSync(join(home, 'config.toml'), '# 이어온 전용 계정 폴더(A2). 로그인은 이 폴더의 파일에만 둔다.\ncli_auth_credentials_store = "file"\n');
  return home;
}

// 계정 폴더 지우기: 연결(junction)을 먼저 연결만 지우고, 남은 연결이 하나도 없을 때만 폴더를 지운다.
// (연결이 남은 채 폴더째 지우면 연결 너머 Desktop 세션 기록까지 지워질 수 있다.) 로그아웃은 부르는 쪽이 먼저 공식 명령으로.
export function removeCodexHome(dir, id) {
  const home = codexHomeOf(dir, id);
  if (!existsSync(home)) return false;
  for (const n of readdirSync(home)) {
    const p = join(home, n);
    if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
  }
  const left = readdirSync(home, { recursive: true }).filter((n) => { try { return lstatSync(join(home, n)).isSymbolicLink(); } catch { return false; } });
  if (left.length) fail('links_left', 500);
  rmSync(home, { recursive: true, force: true });
  return true;
}
