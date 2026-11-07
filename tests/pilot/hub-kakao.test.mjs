// P5: 허브 내장 카카오 수신 — 카카오가 허브의 /kakao/skill/<비밀>을 부르고, 같은 기계의 메신저가 /pc/poll로 가져간다(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const PC = 'hub-relay-pc-token-0123456789';
const SECRET = 'hub-kakao-secret-0123456789abcdef';
const CB = 'https://bot-api.kakao.com/v2/bots/b1/callback/abc';
const skill = (utterance, cb = CB) => ({ userRequest: { utterance, user: { id: 'kakao-user-1' }, callbackUrl: cb } });

async function hub(t, webAccess) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p5-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), webAccess, bindings: [], users: [], devices: [],
    relay: { pcToken: PC, kakaoSecret: SECRET } });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return { base, dir };
}
const post = (base, body, secret = SECRET, xff) => fetch(`${base}/kakao/skill/${secret}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) }, body: JSON.stringify(body) });

test('허브 내장 중계: 메신저가 붙기 전에는 바로 "PC 꺼짐" 응답, 붙으면 대기열로 받아 /pc/poll로 넘긴다', async (t) => {
  const { base } = await hub(t);
  let r = await (await post(base, skill('/whoami'))).json();
  assert.match(JSON.stringify(r), /simpleText/); // 메신저 미연결 안내(콜백 없이 즉시)
  assert.equal((await post(base, skill('/whoami'), 'wrong-secret-xxxxxxxxxxxxxxxx')).status, 404);
  assert.equal((await fetch(`${base}/pc/poll`)).status, 401);
  // 메신저가 폴링을 시작한 뒤의 질문은 대기열 → 폴링으로 전달
  const polling = fetch(`${base}/pc/poll`, { headers: { authorization: `Bearer ${PC}` } }).then((x) => x.json());
  await new Promise((s) => setTimeout(s, 100)); // 폴링이 기다리는 중 = 메신저 연결됨
  r = await (await post(base, skill('/sessions'))).json();
  assert.equal(r.useCallback, true);
  const got = (await polling).items;
  assert.equal(got.length, 1);
  assert.equal(got[0].text, '/sessions');
  assert.equal(got[0].callbackUrl, CB);
});

test('허브 접속 제한과 함께: /kakao/*는 예외로 열리고, /pc/poll은 앞단을 거치면 403(이 기계 안에서만)', async (t) => {
  const { base } = await hub(t, { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] });
  assert.equal((await post(base, skill('/whoami'), SECRET, '203.0.113.7')).status, 200);
  assert.equal((await fetch(`${base}/pc/poll`, { headers: { authorization: `Bearer ${PC}`, 'x-forwarded-for': '203.0.113.7' } })).status, 403);
});

test('서버 실행: relay.envFile의 비밀 값을 읽어 내장 중계를 켜고, 값이 없으면 시작하지 않는다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p5m-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const serverJs = fileURLToPath(new URL('../../src/pilot/server.mjs', import.meta.url));
  const run = (envText) => new Promise((resolve) => {
    writeFileSync(join(dir, 'relay.env'), envText);
    writeFileSync(join(dir, 'server.json'), JSON.stringify({ port: 0, dbPath: join(dir, 'p.db'), users: [{ tokenSha256: sha('w'), userId: 'u', appId: 'app_web' }], devices: [], bindings: [], relay: { envFile: join(dir, 'relay.env') } }));
    const p = spawn(process.execPath, [serverJs, join(dir, 'server.json')], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (/ieon pilot server: http/.test(err)) { p.kill(); } });
    p.on('exit', (code) => resolve({ code, err }));
    setTimeout(() => p.kill(), 8000);
  });
  const ok = await run(`KAKAO_RELAY_TOKEN=${PC}\nIEON_RELAY_KAKAO_SECRET="${SECRET}"\n`);
  assert.match(ok.err, /ieon pilot server: http/);
  assert.ok(!ok.err.includes(PC) && !ok.err.includes(SECRET)); // 비밀 값은 로그에 없다
  const bad = await run('KAKAO_RELAY_TOKEN=short\n');
  assert.notEqual(bad.code, 0);
  assert.doesNotMatch(bad.err, /ieon pilot server: http/);
});

test('허브 메신저 준비 스크립트: 토큰·비밀 파일을 만들고 server.json에 해시와 relay만 더하며, 두 번 실행하면 거부한다', async (t) => {
  const { initHubMessenger } = await import('../../scripts/hub-messenger-init.mjs');
  const { readFileSync, existsSync, mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p5i-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.local', 's2'), { recursive: true });
  const before = { port: 28760, dbPath: 'x.db', users: [{ userId: 'u_sinsan', appId: 'app_web', tokenSha256: sha('w') }], devices: [], bindings: [] };
  writeFileSync(join(dir, '.local/s2/server.json'), JSON.stringify(before));
  const r = initHubMessenger(dir);
  const s = JSON.parse(readFileSync(join(dir, '.local/s2/server.json'), 'utf8'));
  const token = readFileSync(join(dir, '.local/messenger/token'), 'utf8');
  assert.equal(s.users[1].appId, 'app_messenger');
  assert.equal(s.users[1].userId, 'u_sinsan');
  assert.equal(s.users[1].tokenSha256, sha(token));
  assert.match(s.relay.envFile, /\.local\/messenger\/bots\.env$/);
  const env = readFileSync(join(dir, '.local/messenger/bots.env'), 'utf8');
  assert.match(env, /^KAKAO_RELAY_TOKEN=[0-9a-f]{64}$/m);
  assert.match(env, /^IEON_RELAY_KAKAO_SECRET=[0-9a-f]{64}$/m);
  const cfg = JSON.parse(readFileSync(join(dir, '.local/messenger/config.json'), 'utf8'));
  assert.equal(cfg.kakaoRelayUrl, 'http://127.0.0.1:28760');
  assert.deepEqual(JSON.parse(readFileSync(r.backup, 'utf8')), before);
  assert.ok(existsSync(r.backup));
  assert.ok(!JSON.stringify(r).includes(token)); // 결과에 값 없음
  assert.throws(() => initHubMessenger(dir), /already_initialized/);
});
