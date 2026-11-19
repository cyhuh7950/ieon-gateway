// A3(신산님 2026-11-19 "새 세션 범위로 만들기", 실측 ENGINE_ACCOUNTS 12절): Antigravity 이어온 전용 계정 — 이어온 새 세션에서만.
// 계정 하나 = 로그인 폴더 하나(`agy acp --gemini-dir <폴더>`). 그 폴더에 대화도 저장되므로, 그 계정으로 만든 새 세션은 계속 그 계정으로 이어 쓴다.
// PC에서 원래 쓰던 Antigravity 대화는 지금처럼 PC 기본 로그인(기본 폴더 ~/.gemini). 기본 폴더에서는 인증 요청을 보내지 않는다(PC 로그인 방식이 바뀜).
// 로그인: API 키(그 폴더 api-key 파일, 실행 때 GEMINI_API_KEY + ACP authenticate gemini-api-key). 구독은 막음 — ACP authenticate(oauth-personal)는
// 방식만 정하고 실제 로그인을 하지 않는다(2026-11-19 실측: "Auth succeeded" 뒤 "You are not logged into Antigravity"). 계정 폴더별 구독 로그인 길은 미확인.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLabel, MAX_ACCOUNTS, PC_DEFAULT } from './accounts.mjs';

const ID = /^[a-z0-9]{2,16}$/;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };
export const AGY_KEY = /^\S{20,200}$/;

export const agyHomeOf = (dir, id) => { if (!ID.test(String(id))) fail('bad_account'); return join(dir, 'agy', id); };
export function agyAccounts(c) {
  const list = Array.isArray(c.agyAccounts?.accounts) ? c.agyAccounts.accounts.filter((a) => ID.test(String(a?.id))) : [];
  return list.map((a) => ({ id: a.id, label: cleanLabel(a.label) || a.id }));
}
export const agyDefaultAccount = (c) => c.agyAccounts?.defaultAccount ?? PC_DEFAULT;
// 호환 주소(신산님 2026-11-19 "넣어 보기"): Antigravity의 기업용 모델 게이트웨이(실행 파일 변경 기록: https만 — 같은 PC는 http, 끝의 /v1beta는 무시, Gemini 형식 요청)를
// 환경 변수 AGY_LLM_GATEWAY_URL·_API_KEY·_MODELS·_WIRE_PROTOCOL로 넘긴다. 그 계정 폴더에 compat.json(주소·모델 목록·형식)과 compat-key(600). 새 세션에서만(계정 폴더에 대화).
const COMPAT_URL = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/[\w.\-\/~%]*)?$/i;
export const AGY_WIRES = ['gemini', 'responses'];
export function readAgyCompat(home) { try { const c = JSON.parse(readFileSync(join(home, 'compat.json'), 'utf8')); return c && COMPAT_URL.test(c.baseUrl) && existsSync(join(home, 'compat-key')) ? c : null; } catch { return null; } }
export function saveAgyCompat(home, { baseUrl, key, models = '', wire = 'gemini' }) {
  const url = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!COMPAT_URL.test(url)) fail('bad_base_url');
  const k = String(key ?? '').trim(); if (!/^\S{8,500}$/.test(k)) fail('bad_api_key');
  const list = String(models ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (list.length > 20 || list.some((m) => !/^[\w.\-:/@]{1,100}$/.test(m))) fail('bad_model');
  if (!AGY_WIRES.includes(wire)) fail('bad_wire');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'compat-key'), k + '\n', { mode: 0o600 });
  writeFileSync(join(home, 'compat.json'), JSON.stringify({ baseUrl: url, models: list, wire }, null, 2) + '\n');
  rmSync(join(home, 'api-key'), { force: true }); rmSync(join(home, 'kind'), { force: true }); // 한 계정은 한 방식
}
export const agyCompatHost = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return null; } };

// 로그인 종류: 호환 주소 → api-key 파일(API) → kind 파일(구독, 지금은 쓰지 않음). 로그인 정보 파일 내용은 읽지 않는다.
export function agyAccountKind(home) {
  if (readAgyCompat(home)) return 'compat';
  if (existsSync(join(home, 'api-key'))) return 'api';
  try { if (readFileSync(join(home, 'kind'), 'utf8').trim() === 'subscription') return 'subscription'; } catch { /* 없음 */ }
  return null;
}
// 호환 주소는 게이트웨이 환경 변수로 접속 — ACP 인증 요청은 보내지 않는다(미실측)
export const agyAuthMethod = (kind) => (kind === 'api' ? 'gemini-api-key' : kind === 'subscription' ? 'oauth-personal' : null);

// 새 세션을 그 계정으로 실행할 준비: { geminiDir, authMethod, env } 또는 PC 기본이면 null. 없는 계정·로그인 전이면 보내기 전에 거절.
export function agyRunFor(c, dir, accountId, { env = process.env } = {}) {
  const id = accountId ?? agyDefaultAccount(c);
  if (id === PC_DEFAULT) return null;
  if (!agyAccounts(c).some((a) => a.id === id)) fail('account_missing', 409);
  const home = agyHomeOf(dir, id);
  const kind = agyAccountKind(home);
  if (!kind) fail('account_not_logged_in', 409);
  const e = { ...env }; for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH', 'AGY_LLM_GATEWAY_URL', 'AGY_LLM_GATEWAY_API_KEY', 'AGY_LLM_GATEWAY_MODELS', 'AGY_LLM_GATEWAY_WIRE_PROTOCOL', 'AGY_LLM_GATEWAY_HEADERS']) delete e[k];
  if (kind === 'api') e.GEMINI_API_KEY = readFileSync(join(home, 'api-key'), 'utf8').trim();
  if (kind === 'compat') { const cp = readAgyCompat(home); e.AGY_LLM_GATEWAY_URL = cp.baseUrl; e.AGY_LLM_GATEWAY_API_KEY = readFileSync(join(home, 'compat-key'), 'utf8').trim(); if (cp.models?.length) e.AGY_LLM_GATEWAY_MODELS = cp.models.join(','); e.AGY_LLM_GATEWAY_WIRE_PROTOCOL = cp.wire; }
  return { accountId: id, geminiDir: home, authMethod: agyAuthMethod(kind), env: e };
}

// 연결부 상태 보고(EA10): Antigravity 새 세션별 이어온 계정 이름표(created 기록의 account)·새 세션 기본 이름표. 이름표만.
export function agyAccountHealth(c) {
  const label = (id) => (id && id !== PC_DEFAULT ? agyAccounts(c).find((a) => a.id === id)?.label ?? null : null);
  const per = {};
  try {
    const f = c.newSessions?.createdPath;
    if (f && existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-500)) { try { const r = JSON.parse(l); const lb = label(r.account); if (lb && /^[0-9a-f-]{36}$/i.test(String(r.id))) per[String(r.id).toLowerCase()] = lb; } catch { /* 깨진 줄 */ } }
  } catch { /* 기록 없음 */ }
  return { agyAccounts: per, agyDefault: label(agyDefaultAccount(c)) };
}

export function saveAgyApiKey(home, key) {
  mkdirSync(home, { recursive: true }); rmSync(join(home, 'compat.json'), { force: true }); rmSync(join(home, 'compat-key'), { force: true });
  writeFileSync(join(home, 'api-key'), String(key).trim() + '\n', { mode: 0o600 });
  rmSync(join(home, 'kind'), { force: true });
}
export function agyLogoutFiles(home) { rmSync(join(home, 'compat.json'), { force: true }); rmSync(join(home, 'compat-key'), { force: true }); rmSync(join(home, 'api-key'), { force: true }); rmSync(join(home, 'kind'), { force: true }); rmSync(join(home, 'antigravity-cli', 'cache', 'acp-auth-state.json'), { force: true }); }

// 구독 로그인: 그 계정 폴더로 `agy acp`를 띄워 authenticate(oauth-personal)를 보낸다. Antigravity가 그 PC의 브라우저를 열고, 끝나면 응답이 온다.
// 응답이 오면 kind 파일에 subscription을 적는다. 15분 안에 끝나지 않으면 실패. 화면에 보일 주소가 출력되면 잡아 둔다(미실측).
export function createAgyLogin({ bin, home, spawnImpl = spawn, timeoutMs = 15 * 60_000, log = () => {} }) {
  let job = null;
  const finish = (cur, state, error = null) => { if (cur.state !== 'waiting') return; cur.state = state; cur.error = error; clearTimeout(cur.timer); try { cur.child.kill(); } catch { /* 끝남 */ } log({ event: 'agy_login', state }); };
  return {
    start() {
      if (job?.state === 'waiting') return this.view();
      mkdirSync(home, { recursive: true });
      let child;
      try { child = spawnImpl(bin, ['acp', '--gemini-dir', home, '--disable-telemetry'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch { job = { state: 'failed', error: 'engine_not_installed', url: null }; return this.view(); }
      job = { child, state: 'waiting', error: null, url: null, startedAt: new Date().toISOString() };
      const cur = job; let buf = '';
      const send = (m) => { try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); } catch { /* 닫힘 */ } };
      const onText = (t) => { cur.url ??= (String(t).match(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/) ?? [])[0] ?? null; };
      child.stderr?.on('data', onText);
      child.stdout.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; onText(line);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.id === 1 && m.result) send({ id: 2, method: 'authenticate', params: { methodId: 'oauth-personal' } });
          else if (m.id === 2) {
            if (m.error) finish(cur, 'failed', 'login_failed');
            else { try { writeFileSync(join(home, 'kind'), 'subscription\n'); finish(cur, 'done'); } catch { finish(cur, 'failed', 'save_failed'); } }
          }
        }
      });
      child.on('error', () => finish(cur, 'failed', 'engine_not_installed'));
      child.on('close', () => finish(cur, 'failed', 'exited'));
      cur.timer = setTimeout(() => finish(cur, 'failed', 'timeout'), timeoutMs); cur.timer.unref?.();
      send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } });
      log({ event: 'agy_login', state: 'started' });
      return this.view();
    },
    cancel() { if (job?.state === 'waiting') finish(job, 'cancelled'); return this.view(); },
    view() { return job ? { state: job.state, error: job.error, url: job.url } : { state: 'idle' }; },
  };
}
export { MAX_ACCOUNTS, PC_DEFAULT };
