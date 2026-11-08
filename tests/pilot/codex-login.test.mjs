// W5: 허브 웹 Codex 로그인(기기 코드) — 가짜 Codex 프로세스로 확인(실제 로그인·모델 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createCodexLogin, parseDeviceAuth } from '../../src/pilot/codex-login.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function fakeSpawn(script) {
  const calls = [];
  const spawnImpl = (_bin, args) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', null)); };
    calls.push({ args: args.slice(1), p });
    setImmediate(() => script(args.slice(1), p));
    return p;
  };
  return { spawnImpl, calls };
}

test('출력에서 로그인 주소와 코드를 찾는다(색 코드 섞여도)', () => {
  assert.deepEqual(parseDeviceAuth('\x1b[1mOpen https://auth.openai.com/codex/device\x1b[0m\nEnter code: ABCD-12345\n'),
    { url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' });
  assert.deepEqual(parseDeviceAuth('nothing yet'), { url: null, code: null });
});

test('로그인 상태·기기 코드 로그인 진행·완료·취소', async () => {
  const { spawnImpl, calls } = fakeSpawn((args, p) => {
    if (args[1] === 'status') { p.stdout.emit('data', 'Logged in using ChatGPT\n'); p.emit('exit', 0); }
    if (args[1] === '--device-auth') { p.stdout.emit('data', 'Go to https://auth.openai.com/codex/device and enter WXYZ-9876\n'); }
  });
  const cl = createCodexLogin({ spawnImpl, entry: () => 'codex.js' });
  assert.deepEqual(await cl.status(), { loggedIn: true, method: 'chatgpt' });
  assert.equal(cl.start().state, 'waiting');
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual({ ...cl.view(), startedAt: undefined }, { state: 'waiting', url: 'https://auth.openai.com/codex/device', code: 'WXYZ-9876', startedAt: undefined, error: null });
  assert.equal(cl.start().code, 'WXYZ-9876'); // 진행 중이면 새로 띄우지 않는다
  assert.equal(calls.filter((c) => c.args[1] === '--device-auth').length, 1);
  calls.at(-1).p.emit('exit', 0);
  assert.equal(cl.view().state, 'done');
  cl.start(); await new Promise((ok) => setImmediate(ok));
  assert.equal(cl.cancel().state, 'cancelled');
});

test('허브에만 Codex 로그인 화면이 있다(PC에는 없음)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w5-'));
  const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];
  const { spawnImpl } = fakeSpawn((args, p) => { if (args[1] === 'status') { p.stdout.emit('data', 'Not logged in\n'); p.emit('exit', 1); } });
  const hub = createApp({ dbPath: join(dir, 'hub.db'), users, devices: [], bindings: [], codexLogin: createCodexLogin({ spawnImpl, entry: () => 'codex.js' }),
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const pc = createApp({ dbPath: join(dir, 'pc.db'), users, devices: [], bindings: [] });
  const hubUrl = `http://127.0.0.1:${await hub.listen(0)}`; const pcUrl = `http://127.0.0.1:${await pc.listen(0)}`;
  t.after(async () => { await hub.close(); await pc.close(); rmSync(dir, { recursive: true, force: true }); });
  const get = (base, xff) => fetch(`${base}/v1/admin/codex`, { headers: { authorization: 'Bearer web', ...(xff ? { 'x-forwarded-for': xff } : {}) } });
  const r = await get(hubUrl, '198.51.100.9');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { login: { loggedIn: false, method: null }, job: { state: 'idle' } });
  assert.equal((await get(pcUrl)).status, 404);
});

test('로그인 실패 구분(2026-11-08 허브 실측): 오류 줄의 주소는 로그인 주소로 잡지 않고, 접속 실패를 따로 알린다', async () => {
  const { loginFailure } = await import('../../src/pilot/codex-login.mjs');
  const net = 'Error logging in with device code: error sending request for url (https://auth.openai.com/api/accounts/deviceauth/usercode)\n';
  assert.deepEqual(parseDeviceAuth(net), { url: null, code: null });
  assert.equal(loginFailure(net), 'network');
  assert.equal(loginFailure('device code login is not enabled\n'), 'login_failed');
  assert.equal(parseDeviceAuth('Open (https://auth.openai.com/codex/device).\n').url, 'https://auth.openai.com/codex/device');
});

test('허브 이미지는 HTTPS 인증서 묶음을 설치한다(없으면 Codex가 OpenAI에 접속하지 못함)', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../../deploy/hub/Dockerfile', import.meta.url), 'utf8'), /apt-get install[^\n]*ca-certificates/);
});
