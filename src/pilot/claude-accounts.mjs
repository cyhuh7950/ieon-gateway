// A2-b(신산님 2026-11-19 "PC마다 여러 개"): PC의 이어온 전용 Claude 계정. Codex 계정(accounts.mjs)과 같은 모양 —
// 계정 하나 = 이어온 전용 폴더 하나(CLAUDE_CONFIG_DIR). 로그인은 그 폴더에만(신산님이 공식 `claude auth login` 승인 창에서),
// 세션 기록(projects)은 그 PC의 원래 Claude 폴더와 같은 것을 쓴다(디렉터리 연결 junction) — 계정을 바꿔도 같은 세션을 이어 쓴다(원칙 1).
// API 키 계정은 키 파일 하나(실행할 때만 ANTHROPIC_API_KEY로 넘김, 원래 Claude 폴더 그대로 — 세션 연결이 필요 없음).
// 이어온은 로그인 파일을 읽거나 옮기지 않는다(있는지만 본다). 서버(허브·칸)는 SV2의 같이 쓰는 로그인(claude-login.mjs)을 그대로 쓴다.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanLabel, MAX_ACCOUNTS, PC_DEFAULT } from './accounts.mjs';

export { MAX_ACCOUNTS, PC_DEFAULT };
export const CLAUDE_LINKED = ['projects'];
const ID = /^[a-z0-9]{2,16}$/;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };
const AUTH_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'];
const without = (env) => { const e = { ...env }; for (const k of AUTH_VARS) delete e[k]; return e; };

// 그 PC의 원래 Claude 폴더(세션 기록이 있는 곳). 이어온은 process.env.CLAUDE_CONFIG_DIR을 바꾸지 않는다.
export const desktopClaudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
export const claudeHomeOf = (dir, id) => { if (!ID.test(String(id))) fail('bad_account'); return join(dir, 'claude', id); };

export function claudeAccounts(c) {
  const list = Array.isArray(c.claudeAccounts?.accounts) ? c.claudeAccounts.accounts.filter((a) => ID.test(String(a?.id))) : [];
  return list.map((a) => ({ id: a.id, label: cleanLabel(a.label) || a.id }));
}

// A2-c(신산님 2026-11-19 "1번 진행하자", 설계 EA8): 호환 주소 — Claude Code는 그대로, AI 모델만 다른 곳(예: Upstage Solar·라우터·회사 게이트웨이·로컬 모델).
// 그 계정 폴더에 compat.json(주소·모델·키 보내는 방식)과 compat-key(600). 실행할 때 Claude Code 공식 변수(ANTHROPIC_BASE_URL·ANTHROPIC_AUTH_TOKEN 또는 ANTHROPIC_API_KEY·ANTHROPIC_MODEL)로만 넘긴다.
// 세션의 경계는 CLI — 같은 Claude Code 세션을 다른 모델로 이어 쓰는 것은 "확인된 조합"만(첫 조합: Upstage Solar, 신산님 실사용 2026-11-12). 확인 안 된 주소는 이어온 새 세션에서만.
export const CONFIRMED_COMPAT_HOSTS = ['api.upstage.ai'];
const COMPAT_URL = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/[\w.\-\/~%]*)?$/i;
export const COMPAT_MODEL = /^[\w.\-:/@]{1,100}$/;
export function readCompat(home) { try { const c = JSON.parse(readFileSync(join(home, 'compat.json'), 'utf8')); return c && COMPAT_URL.test(c.baseUrl) ? c : null; } catch { return null; } }
export const compatHost = (baseUrl) => { try { return new URL(baseUrl).host.toLowerCase(); } catch { return null; } };
export const compatConfirmed = (baseUrl) => CONFIRMED_COMPAT_HOSTS.includes(compatHost(baseUrl));
export function saveCompat(home, { baseUrl, key, model, auth = 'bearer' }) {
  const url = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!COMPAT_URL.test(url)) fail('bad_base_url');
  const k = String(key ?? '').trim();
  if (!/^\S{8,500}$/.test(k)) fail('bad_api_key');
  const m = String(model ?? '').trim();
  if (!COMPAT_MODEL.test(m)) fail('bad_model');
  if (!['bearer', 'x-api-key'].includes(auth)) fail('bad_auth');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'compat-key'), k + '\n', { mode: 0o600 });
  writeFileSync(join(home, 'compat.json'), JSON.stringify({ baseUrl: url, model: m, auth }, null, 2) + '\n');
  rmSync(join(home, 'api-key'), { force: true }); // 한 계정은 한 방식
}
export const removeCompat = (home) => { rmSync(join(home, 'compat.json'), { force: true }); rmSync(join(home, 'compat-key'), { force: true }); };

// 로그인 종류(파일이 있는지만 — 공식 로그인 파일 내용은 읽지 않는다): 호환 주소 → API 키 → 공식 로그인.
export function claudeAccountKind(home) {
  if (readCompat(home) && existsSync(join(home, 'compat-key'))) return 'compat';
  if (existsSync(join(home, 'api-key'))) return 'api';
  if (existsSync(join(home, '.credentials.json'))) return 'subscription';
  return null;
}

// 대화(세션)별로 고른 것 → 엔진 기본 → PC 기본. 처음 질문 전의 새 세션(ID 없음)과 채널 창은 엔진 기본.
// 없는 계정이 남아 있으면 PC 기본으로 보지 않고 그대로 돌려줘 보내기 전에 막는다.
export const claudeAccountId = (c, ref = null) => (ref ? c.claudeAccounts?.accountFor?.[String(ref).toLowerCase()] : undefined) ?? c.claudeAccounts?.defaultAccount ?? PC_DEFAULT;
export const claudeAccountLabel = (c, id) => (id === PC_DEFAULT ? null : claudeAccounts(c).find((a) => a.id === id)?.label ?? null);

// Claude 실행 환경. PC 기본이면 null(지금처럼). 계정이 없거나 로그인 전이면 보내기 전에 거절.
// 구독: 그 계정 폴더를 CLAUDE_CONFIG_DIR로(API 키 변수는 지워 종량제로 새지 않게). API 키: 키만 넘기고 폴더는 원래 것.
// existing: 사람이 만든 기존 Claude 세션(허용 목록·채널) — 확인 안 된 호환 주소로는 이어 쓰지 않는다.
export function claudeEnvFor(c, dir, { env = process.env, ref = null, existing = false } = {}) {
  const id = claudeAccountId(c, ref);
  if (id === PC_DEFAULT) return null;
  if (!claudeAccounts(c).some((a) => a.id === id)) fail('account_missing', 409);
  const home = claudeHomeOf(dir, id);
  const kind = claudeAccountKind(home);
  if (kind === 'compat') {
    const cp = readCompat(home);
    if (existing && !compatConfirmed(cp.baseUrl)) fail('combo_unverified', 409);
    const key = readFileSync(join(home, 'compat-key'), 'utf8').trim();
    // 2026-11-24: 원래 Claude 설정 폴더로 실행하면 Claude Code가 저장된 Claude 로그인(Bearer sk-ant-…)을 호환 주소로 보내고 이 키는 쓰지 않았다
    // (Upstage가 401, 가짜 주소로 헤더를 보고 확인) — 로그인 정보가 없는 그 계정 폴더(세션 기록은 연결돼 있음)로 실행해 이 키만 보낸다.
    return { ...without(env), CLAUDE_CONFIG_DIR: home, ANTHROPIC_BASE_URL: cp.baseUrl, ...(cp.auth === 'x-api-key' ? { ANTHROPIC_API_KEY: key } : { ANTHROPIC_AUTH_TOKEN: key }),
      ANTHROPIC_MODEL: cp.model, ANTHROPIC_DEFAULT_HAIKU_MODEL: cp.model, ANTHROPIC_SMALL_FAST_MODEL: cp.model };
  }
  if (kind === 'api') return { ...without(env), ANTHROPIC_API_KEY: readFileSync(join(home, 'api-key'), 'utf8').trim() };
  if (kind === 'subscription') return { ...without(env), CLAUDE_CONFIG_DIR: home };
  fail('account_not_logged_in', 409);
}

// 연결부 상태 보고(EA10 — 어느 계정으로 나가는지 화면·메신저에 보이게): 이름표·종류만, PC 기본은 뺀다.
export function claudeAccountHealth(c, dir) {
  const kindOf = (id) => (id === PC_DEFAULT || !dir ? null : claudeAccountKind(claudeHomeOf(dir, id)));
  const per = {}; const kinds = {};
  for (const [ref, id] of Object.entries(c.claudeAccounts?.accountFor ?? {}).slice(0, 100)) {
    const label = claudeAccountLabel(c, id);
    if (label) { per[ref] = label; const k = kindOf(id); if (k) kinds[ref] = k; }
  }
  const def = claudeAccountId(c);
  return { claudeAccounts: per, claudeAccountKinds: kinds, claudeDefault: claudeAccountLabel(c, def), claudeDefaultKind: kindOf(def) };
}

// 계정 폴더 만들기: 세션 기록 연결(대상이 없으면 원래 Claude 폴더 쪽에 빈 폴더를 만든다 — Claude도 처음 쓸 때 만든다).
export function createClaudeHome(dir, id, { desktop = desktopClaudeDir() } = {}) {
  const home = claudeHomeOf(dir, id);
  if (existsSync(home)) fail('account_exists', 409);
  mkdirSync(home, { recursive: true });
  for (const n of CLAUDE_LINKED) {
    const target = join(desktop, n);
    mkdirSync(target, { recursive: true });
    symlinkSync(target, join(home, n), 'junction');
  }
  return home;
}

// 계정 폴더 지우기: 연결은 따라가지 않고 연결만 지운 뒤 폴더를 지운다(연결 너머 원래 세션 기록이 지워지지 않게).
export function removeClaudeHome(dir, id) {
  const home = claudeHomeOf(dir, id);
  if (!existsSync(home)) return false;
  const unlinkAll = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) unlinkSync(p);
      else if (st.isDirectory()) unlinkAll(p);
    }
  };
  unlinkAll(home);
  rmSync(home, { recursive: true, force: true });
  return true;
}

export function saveClaudeApiKey(home, key) {
  mkdirSync(home, { recursive: true }); removeCompat(home);
  writeFileSync(join(home, 'api-key'), String(key).trim() + '\n', { mode: 0o600 });
}

// 로그아웃: 공식 `claude auth logout`(그 계정 폴더로)을 부르고, 이어온이 둔 API 키 파일을 지운다.
export function claudeLogout(home, { spawnImpl = spawn, timeoutMs = 20_000 } = {}) {
  rmSync(join(home, 'api-key'), { force: true }); removeCompat(home);
  if (!existsSync(join(home, '.credentials.json'))) return Promise.resolve(true);
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl('claude', ['auth', 'logout'], { env: { ...without(process.env), CLAUDE_CONFIG_DIR: home }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true }); } catch { resolve(false); return; }
    const t = setTimeout(() => { try { child.kill(); } catch { /* 끝남 */ } resolve(false); }, timeoutMs); t.unref?.();
    child.on('error', () => { clearTimeout(t); resolve(false); });
    child.on('close', () => { clearTimeout(t); resolve(!existsSync(join(home, '.credentials.json'))); });
  });
}

const strip = (s) => String(s).replace(/\x1b\]8;[^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// 웹의 [로그인]: 공식 `claude auth login`을 그 계정 폴더로 띄운다(터미널 없이도 주소를 보여 주고 "Paste code"로 코드를 받음 — 2.1.314 실측, Windows 포함).
// 신산님이 주소에서 승인하면 그대로 끝나거나(같은 PC 브라우저), 받은 코드를 이어온 칸에 붙여 넣으면 이어온이 넣어 준다. 로그인 정보는 Claude가 그 폴더에 저장.
export function createClaudeAccountLogin({ home, spawnImpl = spawn, timeoutMs = 15 * 60_000, log = () => {} }) {
  let job = null;
  const finish = (cur, state, error = null) => {
    if (cur.state !== 'waiting') return;
    cur.state = state; cur.error = error;
    try { cur.child.kill?.(); } catch { /* 이미 끝남 */ }
    log({ event: 'claude_account_login', state });
  };
  return {
    start() {
      if (job?.state === 'waiting') return this.view();
      let child;
      try {
        child = spawnImpl('claude', ['auth', 'login', '--claudeai'], { env: { ...without(process.env), CLAUDE_CONFIG_DIR: home, BROWSER: 'none' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch { job = { state: 'failed', error: 'claude_not_installed', url: null, codeSent: false, startedAt: new Date().toISOString() }; return this.view(); }
      let out = '';
      job = { child, state: 'waiting', url: null, codeSent: false, startedAt: new Date().toISOString(), error: null };
      const cur = job;
      const onData = (d) => {
        out += d; if (out.length > 100_000) out = out.slice(-50_000);
        cur.url ??= (strip(out).match(/https:\/\/[^\s"'<>]+/) ?? [])[0]?.replace(/[).,;]+$/, '') ?? null;
      };
      child.stdout?.on('data', onData); child.stderr?.on('data', onData);
      child.on('error', () => finish(cur, 'failed', 'claude_not_installed'));
      child.on('close', (code) => {
        if (cur.state !== 'waiting') return;
        if (code === 0 && claudeAccountKind(home) === 'subscription') finish(cur, 'done');
        else finish(cur, 'failed', cur.codeSent ? 'login_failed' : 'exited');
      });
      const t = setTimeout(() => finish(cur, 'failed', 'timeout'), timeoutMs); t.unref?.();
      log({ event: 'claude_account_login', state: 'started' });
      return this.view();
    },
    // 승인 뒤 받은 코드(로그·응답에 남기지 않음)
    code(value) {
      const v = String(value ?? '').trim();
      if (job?.state !== 'waiting') return { error: 'not_waiting' };
      if (!/^[A-Za-z0-9#_\-.~]{8,2000}$/.test(v)) return { error: 'bad_code' };
      job.codeSent = true;
      job.child.stdin?.write(v + '\n');
      return this.view();
    },
    cancel() { if (job?.state === 'waiting') finish(job, 'cancelled'); return this.view(); },
    view() { return job ? { state: job.state, url: job.url, codeSent: job.codeSent, startedAt: job.startedAt, error: job.error } : { state: 'idle' }; },
  };
}
