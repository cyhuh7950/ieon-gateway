// A2(ENGINE_ACCOUNTS EA0·EA1·EA9): 엔진마다 이어온 전용 계정. 지금은 Codex만(A0 실측 PASS, 2026-11-12).
// 계정 하나 = 이어온 전용 폴더 하나(CODEX_HOME). 로그인은 그 폴더에만(신산님이 공식 기기 코드로), 세션 기록·잠금은
// Desktop 폴더와 같은 것을 쓴다(디렉터리 연결 junction 3개 + 상태 DB는 공식 CODEX_SQLITE_HOME).
// 이어온은 로그인 파일을 읽거나 옮기지 않는다(있는지만 본다). 프로세스 전체 환경(process.env)은 바꾸지 않고 질문마다 SDK에만 넘긴다.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
// 2026-11-24 인수 시험(Upstage 호환 주소를 기본 계정으로 고르자 연결부가 꺼졌다 켜지기를 반복): 호환 주소 계정은 새 세션 전용이므로,
// 기존 대화가 "기본 계정 따름"이고 기본이 호환 주소면 그 대화는 PC 기본 로그인을 쓴다(대화별로 직접 고른 경우만 combo_unverified로 거절).
export function codexAccountId(c, threadId, dir = null) {
  const per = threadId ? c.codex?.accountFor?.[String(threadId).toLowerCase()] : undefined;
  const def = c.codex?.defaultAccount ?? PC_DEFAULT;
  if (per === undefined && threadId && def !== PC_DEFAULT && dir && readCodexCompat(codexHomeOf(dir, def))) return PC_DEFAULT;
  return per ?? def;
}

// A2-c(신산님 2026-11-19 "2번 진행하자", 설계 EA8): Codex 호환 주소 — Codex는 그대로, 모델만 다른 곳(OpenAI Responses API 호환 라우터·게이트웨이·로컬 모델).
// 그 계정 폴더(CODEX_HOME)의 config.toml에 공식 모델 제공처(model_provider)를 적고, 키는 compat-key(600)에 두었다가 실행할 때만 환경 변수로 넘긴다.
// Codex 0.165는 wire_api = "responses"만 받는다(실행 파일 문구 "`wire_api = \"chat\"` is no longer supported", 2026-11-19 확인).
// 세션 경계는 CLI — 사람이 만든 기존 Codex 대화를 다른 모델로 이어 쓰는 확인된 조합은 아직 없다 → 이어온 새 세션에서만(그 밖은 combo_unverified).
export const COMPAT_ENV_KEY = 'IEON_COMPAT_API_KEY';
const COMPAT_URL = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/[\w.\-\/~%]*)?$/i;
const COMPAT_MODEL = /^[\w.\-:/@]{1,100}$/;
const BASE_TOML = '# 이어온 전용 계정 폴더(A2). 로그인은 이 폴더의 파일에만 둔다.\ncli_auth_credentials_store = "file"\n';
// 2026-11-24 인수 시험(Upstage): 이어온 호환 주소 계정에서는 Codex 플러그인 받기를 끈다 — 켜 두면 첫 실행이 88초 걸리고(끄면 6초, 실제 Codex로 잼),
// 도중에 끊기면 남은 잠금 파일(.tmp/plugins.sync.lock) 때문에 다음 실행이 끝없이 기다렸다(질문이 결과 불명). 이미 만든 계정은 실행할 때 덧붙인다.
const NO_PLUGINS = '\n[features]\nplugins = false\n';
function ensureNoPlugins(home) {
  const p = join(home, 'config.toml');
  try { const t = readFileSync(p, 'utf8'); if (!/^\s*plugins\s*=/m.test(t)) writeFileSync(p, t.replace(/\n*$/, '\n') + NO_PLUGINS); } catch { /* 설정이 없으면 그대로 */ }
  try { rmSync(join(home, '.tmp', 'plugins.sync.lock'), { force: true }); } catch { /* 없음 */ }
}
export function readCodexCompat(home) { try { const c = JSON.parse(readFileSync(join(home, 'compat.json'), 'utf8')); return c && COMPAT_URL.test(c.baseUrl) && existsSync(join(home, 'compat-key')) ? c : null; } catch { return null; } }
export function saveCodexCompat(home, { baseUrl, key, model }) {
  const url = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!COMPAT_URL.test(url)) fail('bad_base_url');
  const k = String(key ?? '').trim();
  if (!/^\S{8,500}$/.test(k)) fail('bad_api_key');
  const m = String(model ?? '').trim();
  if (!COMPAT_MODEL.test(m)) fail('bad_model');
  if (!existsSync(home)) fail('not_found', 404);
  writeFileSync(join(home, 'compat-key'), k + '\n', { mode: 0o600 });
  writeFileSync(join(home, 'compat.json'), JSON.stringify({ baseUrl: url, model: m }, null, 2) + '\n');
  // 주소·모델은 위 모양 검사를 통과한 값만이라 TOML 따옴표를 깨지 않는다
  writeFileSync(join(home, 'config.toml'), BASE_TOML + `model = "${m}"\nmodel_provider = "ieon_compat"\n\n[model_providers.ieon_compat]\nname = "이어온 호환 주소"\nbase_url = "${url}"\nenv_key = "${COMPAT_ENV_KEY}"\nwire_api = "responses"\n` + NO_PLUGINS);
}
export function removeCodexCompat(home) {
  if (!existsSync(join(home, 'compat.json'))) return false;
  rmSync(join(home, 'compat.json'), { force: true }); rmSync(join(home, 'compat-key'), { force: true });
  writeFileSync(join(home, 'config.toml'), BASE_TOML);
  return true;
}
export const compatHostOf = (baseUrl) => { try { return new URL(baseUrl).host.toLowerCase(); } catch { return null; } };

// SDK에 넘길 환경. PC 기본이면 null(지금처럼 new Codex()). 계정이 없거나 로그인 전이면 보내기 전에 거절.
export function codexEnvFor(c, dir, threadId, { env = process.env } = {}) {
  const id = codexAccountId(c, threadId, dir);
  if (id === PC_DEFAULT) return null;
  if (!codexAccounts(c).some((a) => a.id === id)) fail('account_missing', 409);
  const home = codexHomeOf(dir, id);
  const cp = readCodexCompat(home);
  if (cp) {
    if (threadId) fail('combo_unverified', 409); // 기존 대화(사람이 만든 것)는 확인된 조합이 없어 새 세션에서만
    ensureNoPlugins(home);
    const e = { ...env }; delete e.OPENAI_API_KEY; delete e.CODEX_API_KEY;
    return { ...e, CODEX_HOME: home, CODEX_SQLITE_HOME: desktopCodexHome(env), [COMPAT_ENV_KEY]: readFileSync(join(home, 'compat-key'), 'utf8').trim() };
  }
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
  // 폴더 안 어디에 있든 연결(junction·심볼릭 링크)은 따라가지 않고 연결만 지운다 — Desktop 세션 연결뿐 아니라
  // Codex가 로그인 때 tmp/arg0-linux 아래에 만드는 실행 파일 바로 가기도 있다(2026-11-12 허브에서 발견: 이것 때문에 지우기가 멈춤).
  const unlinkAll = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) unlinkSync(p);
      else if (st.isDirectory()) unlinkAll(p);
    }
  };
  unlinkAll(home);
  const left = readdirSync(home, { recursive: true }).filter((n) => { try { return lstatSync(join(home, n)).isSymbolicLink(); } catch { return false; } });
  if (left.length) fail('links_left', 500);
  rmSync(home, { recursive: true, force: true });
  return true;
}
