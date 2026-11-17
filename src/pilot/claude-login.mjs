// SV2(신산님 2026-11-17 "SV2 칸 안 Claude", 제1원칙): 서버의 Claude 로그인은 이어온에서 한 번만 하고 허브·모든 엔진 칸이 같이 쓴다.
// 저장: 같이 쓰는 폴더(허브 hub/data/shared-auth/claude, 칸에는 읽기 전용으로 /shared/claude) 안에 파일 하나 —
//   oauth-token: 구독 로그인(공식 `claude setup-token`이 주는 1년짜리 토큰) / api-key: API 키(사용량 과금)
// Claude Code는 이 값을 환경 변수(CLAUDE_CODE_OAUTH_TOKEN·ANTHROPIC_API_KEY)로 받는다(2.1.326 실측). 실행할 때마다 파일을 읽어 넣으므로
// 다시 로그인하면 다음 질문부터 모든 칸이 새 값을 쓴다. 값은 화면·응답·로그에 내지 않는다(파일 권한 600).
// 폴더가 정해지지 않은 곳(PC)은 지금처럼 그 PC의 Claude 로그인을 그대로 쓴다.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLAUDE_API_KEY = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;
const OAUTH_TOKEN = /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,400}/;
const FILES = { subscription: 'oauth-token', api: 'api-key' };

export const claudeAuthDir = (env = process.env) => env.IEON_SHARED_CLAUDE_DIR || null;

const readValue = (dir, kind) => { try { return readFileSync(join(dir, FILES[kind]), 'utf8').trim() || null; } catch { return null; } };

// 지금 같이 쓰는 로그인의 종류: 'api' | 'subscription' | null(없음). API 키가 있으면 그것이 먼저(저장할 때 다른 쪽은 지움).
export function claudeKind(dir = claudeAuthDir()) {
  if (!dir) return null;
  if (readValue(dir, 'api')) return 'api';
  if (readValue(dir, 'subscription')) return 'subscription';
  return null;
}

// Claude 실행 환경: 같이 쓰는 로그인이 있으면 그 값만 넣고 다른 쪽 변수는 지운다(둘이 섞이면 어느 계정으로 나가는지 흐려짐).
export function claudeAuthEnv(base = process.env, dir = claudeAuthDir(base)) {
  const env = { ...base };
  if (!dir) return env;
  const key = readValue(dir, 'api');
  const token = key ? null : readValue(dir, 'subscription');
  if (!key && !token) return env;
  delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CODE_OAUTH_TOKEN; delete env.ANTHROPIC_AUTH_TOKEN;
  if (key) env.ANTHROPIC_API_KEY = key; else env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

export function saveClaudeLogin(dir, kind, value) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, FILES[kind]), String(value).trim() + '\n', { mode: 0o600 });
  rmSync(join(dir, FILES[kind === 'api' ? 'subscription' : 'api']), { force: true });
}
export function removeClaudeLogin(dir) { for (const f of Object.values(FILES)) rmSync(join(dir, f), { force: true }); }
export function canWrite(dir) {
  if (!dir) return false;
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 }); accessSync(dir, constants.W_OK); return true; } catch { return false; }
}

// setup-token 화면 출력에서 로그인 주소를 찾는다. 터미널 링크(OSC 8)에 든 전체 주소를 먼저 보고, 없으면 글자 그대로의 주소.
// 화면 글자만: 터미널 링크 제거, 커서를 n칸 옮기는 신호(ink가 띄어쓰기 대신 씀)는 빈칸으로, 나머지 제어 신호는 지움
const strip = (s) => String(s).replace(/\x1b\]8;[^\x07]*\x07/g, '').replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(+n || 1, 50)))
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '');
// 코드를 넣은 뒤 Claude가 낸 오류 문장(실측: "OAuth error: That code wasn't accepted…" + "Press Enter to retry"). 비밀값은 없지만 혹시 몰라 sk-ant…는 가린다.
export function parseSetupError(text) {
  const t = strip(text);
  const m = t.match(/(?:OAuth )?error:?[ \t]*[^\r\n]{0,240}/i);
  if (!m && !/Press\s*Enter\s*to\s*retry/i.test(t)) return null;
  return (m?.[0] ?? 'error').replace(/sk-ant-[A-Za-z0-9_-]+/g, '…').replace(/\s+/g, ' ').trim().slice(0, 240);
}
export function parseSetupToken(text) {
  const raw = String(text);
  const osc = raw.match(/\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)/);
  const plain = strip(raw).match(/https:\/\/[^\s"'<>]+/);
  const url = (osc?.[1] ?? plain?.[0] ?? null)?.replace(/[).,;]+$/, '') ?? null;
  const token = (strip(raw).replace(/\s+/g, ' ').match(OAUTH_TOKEN) ?? [])[0] ?? null;
  return { url, token };
}

// 웹의 [Claude 로그인]: 서버가 공식 `claude setup-token`을 가상 터미널(script)로 띄워 주소를 화면에 보여 주고, 신산님이 그 주소에서 승인한 뒤
// 받은 코드를 이어온 화면 칸에 붙여 넣으면 이어온이 터미널에 넣어 준다. 나온 토큰은 화면에 보이지 않고 바로 같이 쓰는 폴더에 저장된다.
export function createClaudeLogin({ dir = claudeAuthDir(), spawnImpl = spawn, timeoutMs = 15 * 60_000, noTokenMs = 120_000, log = () => {} } = {}) {
  let job = null; // { child, state: waiting|done|failed|cancelled, url, codeSent, startedAt, error, home }
  const finish = (cur, state, error = null, detail = null) => {
    if (cur.state !== 'waiting') return;
    cur.state = state; cur.error = error; cur.detail = detail;
    clearTimeout(cur.noToken);
    try { cur.child.kill?.(); } catch { /* 이미 끝남 */ }
    try { rmSync(cur.home, { recursive: true, force: true }); } catch { /* 임시 폴더 */ }
    log({ event: 'claude_login', state });
  };
  return {
    start() {
      if (job?.state === 'waiting') return this.view();
      if (!canWrite(dir)) { job = { state: 'failed', error: 'not_writable', url: null, codeSent: false, startedAt: new Date().toISOString() }; return this.view(); }
      // 임시 HOME: setup-token이 이 서버의 다른 Claude 설정을 건드리지 않게. 넓은 터미널(줄바꿈으로 주소·토큰이 끊기지 않게).
      const home = mkdtempSync(join(tmpdir(), 'ieon-claude-'));
      let child;
      try {
        child = spawnImpl('script', ['-qfc', 'stty cols 2000 rows 50; claude setup-token', '/dev/null'],
          { env: { ...process.env, HOME: home, BROWSER: 'false', TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch { rmSync(home, { recursive: true, force: true }); job = { state: 'failed', error: 'spawn_failed', url: null, codeSent: false, startedAt: new Date().toISOString() }; return this.view(); }
      let out = '';
      job = { child, state: 'waiting', url: null, codeSent: false, startedAt: new Date().toISOString(), error: null, home };
      const cur = job;
      const onData = (d) => {
        out += d; if (out.length > 200_000) out = out.slice(-100_000);
        const p = parseSetupToken(out);
        cur.url ??= p.url;
        if (p.token && cur.state === 'waiting') {
          try { saveClaudeLogin(dir, 'subscription', p.token); finish(cur, 'done'); } catch { finish(cur, 'failed', 'save_failed'); }
          return;
        }
        // 코드를 넣은 뒤 Claude가 오류를 내고 "Enter로 다시"를 기다리면 계속 "확인 중"으로 남지 않게 실패로 끝내고 그 문장을 화면에 보인다
        if (cur.codeSent && cur.state === 'waiting') {
          const err = parseSetupError(out.slice(cur.mark));
          if (err) finish(cur, 'failed', 'oauth_error', err);
        }
      };
      cur.peek = () => out.length;
      // 코드를 넣고 2분이 지나도 토큰도 오류도 없으면 실패로 알린다(로그에는 어떤 낱말이 보였는지만 — 화면 원문·값은 남기지 않음)
      cur.watch = () => {
        clearTimeout(cur.noToken);
        cur.noToken = setTimeout(() => {
          const t = strip(out.slice(cur.mark));
          log({ event: 'claude_login_no_token', seen: ['token', 'success', 'error', 'retry', 'paste'].filter((w) => new RegExp(w, 'i').test(t)), chars: t.length });
          finish(cur, 'failed', 'no_token');
        }, noTokenMs);
        cur.noToken.unref?.();
      };
      child.stdout?.on('data', onData); child.stderr?.on('data', onData);
      child.on('error', () => finish(cur, 'failed', 'claude_not_installed'));
      child.on('exit', () => finish(cur, 'failed', cur.codeSent ? 'login_failed' : 'exited'));
      const t = setTimeout(() => finish(cur, 'failed', 'timeout'), timeoutMs); t.unref?.();
      log({ event: 'claude_login', state: 'started' });
      return this.view();
    },
    // 승인 뒤 받은 코드를 터미널에 넣는다(코드는 로그·응답에 남기지 않음)
    code(value) {
      const v = String(value ?? '').trim();
      if (job?.state !== 'waiting') return { error: 'not_waiting' };
      if (!/^[A-Za-z0-9#_\-.~]{8,2000}$/.test(v)) return { error: 'bad_code' };
      // 코드와 Enter를 따로 보낸다(한 덩어리면 붙여 넣기로 보고 Enter를 글자로 먹는 터미널 화면이 있음). 이전 시도의 오류 문장과 섞이지 않게 지금부터의 출력만 본다.
      const cur = job;
      cur.mark = cur.peek(); cur.codeSent = true;
      cur.child.stdin?.write(v);
      setTimeout(() => { if (cur.state === 'waiting') { cur.child.stdin?.write('\r'); cur.watch(); } }, 300).unref?.();
      return this.view();
    },
    cancel() { if (job?.state === 'waiting') finish(job, 'cancelled'); return this.view(); },
    view() { return job ? { state: job.state, url: job.url, codeSent: job.codeSent, startedAt: job.startedAt, error: job.error, detail: job.detail ?? null } : { state: 'idle' }; },
  };
}
