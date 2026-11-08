// W5: 허브 웹의 "Codex 로그인". 서버가 공식 `codex login --device-auth`(기기 코드 로그인)를 띄우고 화면에 나온
// 로그인 주소와 코드를 웹에 보여 준다. 신산님은 자기 브라우저에서 그 주소를 열어 코드를 넣고 승인만 한다.
// 자격 증명은 Codex가 CODEX_HOME에 직접 저장하며, 이어온은 그 파일을 읽거나 옮기지 않는다. 로그에는 상태만 남긴다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
export const codexEntry = () => require.resolve('@openai/codex/bin/codex.js');

// 기기 코드 로그인 출력에서 주소와 코드를 찾는다(형식이 조금 바뀌어도 되도록 느슨하게).
export function parseDeviceAuth(text) {
  const t = strip(text);
  const url = (t.match(/https:\/\/[^\s"'<>]+/) ?? [])[0] ?? null;
  const code = (t.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/) ?? [])[0] ?? null;
  return { url, code };
}

export function createCodexLogin({ env = process.env, spawnImpl = spawn, entry = codexEntry, timeoutMs = 15 * 60_000, log = () => {} } = {}) {
  let job = null; // { child, state, url, code, startedAt, error }
  const run = (args) => spawnImpl(process.execPath, [entry(), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    // 로그인 여부(공식 `codex login status`). 계정 이메일 등은 돌려주지 않는다.
    status() {
      return new Promise((ok) => {
        let out = '';
        let p;
        try { p = run(['login', 'status']); } catch { return ok({ loggedIn: false, method: null }); }
        p.stdout?.on('data', (d) => { out += d; }); p.stderr?.on('data', (d) => { out += d; });
        const t = setTimeout(() => { p.kill?.(); ok({ loggedIn: false, method: null }); }, 15000);
        p.on('exit', (code) => {
          clearTimeout(t);
          const s = strip(out);
          ok({ loggedIn: code === 0 && /Logged in/i.test(s), method: /ChatGPT/i.test(s) ? 'chatgpt' : /API key/i.test(s) ? 'api_key' : null });
        });
      });
    },
    start() {
      if (job?.state === 'waiting') return this.view();
      let out = '';
      const child = run(['login', '--device-auth']);
      job = { child, state: 'waiting', url: null, code: null, startedAt: new Date().toISOString(), error: null };
      const cur = job;
      const onData = (d) => { out += d; const p = parseDeviceAuth(out); cur.url ??= p.url; cur.code ??= p.code; };
      child.stdout?.on('data', onData); child.stderr?.on('data', onData);
      const t = setTimeout(() => { if (cur.state === 'waiting') { cur.state = 'failed'; cur.error = 'timeout'; child.kill?.(); } }, timeoutMs);
      t.unref?.();
      child.on('exit', (code) => {
        clearTimeout(t);
        if (cur.state === 'waiting') { cur.state = code === 0 ? 'done' : 'failed'; cur.error = code === 0 ? null : 'login_failed'; }
        log({ event: 'codex_login', state: cur.state });
      });
      log({ event: 'codex_login', state: 'started' });
      return this.view();
    },
    cancel() { if (job?.state === 'waiting') { job.state = 'cancelled'; job.child.kill?.(); } return this.view(); },
    view() { return job ? { state: job.state, url: job.url, code: job.code, startedAt: job.startedAt, error: job.error } : { state: 'idle' }; },
  };
}
