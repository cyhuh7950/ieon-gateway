// W2: 봇 토큰 웹 입력(쓰기 전용)·메신저 자동 다시 읽기·카카오 스킬 URL·"이 사람 허용"(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';
import { serverApi } from '../../src/pilot/messenger/bridge.mjs';
import { readEnvFile, writeEnvValue } from '../../src/pilot/secrets-file.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('비밀 파일: 주석·다른 줄은 두고 그 이름만 바꾸거나 지우며, 줄바꿈 든 값은 거절, Linux에서는 600', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-sec-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const f = join(d, 'bots.env');
  writeFileSync(f, '# 설명\nKAKAO_RELAY_TOKEN=abc\nTELEGRAM_BOT_TOKEN=old\n');
  writeEnvValue(f, 'TELEGRAM_BOT_TOKEN', '123:new-token');
  writeEnvValue(f, 'DISCORD_BOT_TOKEN', 'disc.tok');
  assert.deepEqual(readEnvFile(f), { KAKAO_RELAY_TOKEN: 'abc', TELEGRAM_BOT_TOKEN: '123:new-token', DISCORD_BOT_TOKEN: 'disc.tok' });
  assert.match(readFileSync(f, 'utf8'), /^# 설명\n/);
  writeEnvValue(f, 'DISCORD_BOT_TOKEN', null);
  assert.equal(readEnvFile(f).DISCORD_BOT_TOKEN, undefined);
  assert.throws(() => writeEnvValue(f, 'TELEGRAM_BOT_TOKEN', 'a\nEVIL=1'), /bad_secret_value/);
  assert.throws(() => writeEnvValue(f, 'bad name', 'x'), /bad_secret_name/);
  if (process.platform !== 'win32') assert.equal(statSync(f).mode & 0o777, 0o600);
});

async function setup(t, { relay = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w2-'));
  const secretsFile = join(dir, 'bots.env');
  writeFileSync(secretsFile, relay ? 'KAKAO_RELAY_TOKEN=relay-pc-token-0123456789\n' : '');
  const app = createApp({ dbPath: join(dir, 'pilot.db'), secretsFile, devices: [], bindings: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    ...(relay ? { relay: { pcToken: 'relay-pc-token-0123456789', kakaoSecret: 'kakao-secret-0123456789abcdef' } } : {}) });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  return { call, base, dir, secretsFile };
}

test('봇 토큰 웹 입력: 정의된 봇의 토큰 이름만 받고, 값은 다시 보여 주지 않으며(있음/없음), 지울 수 있다', async (t) => {
  const s = await setup(t);
  let r = await s.call('/v1/admin/secrets');
  assert.equal(r.body.configured, true);
  const tg = r.body.names.find((n) => n.name === 'TELEGRAM_BOT_TOKEN');
  assert.deepEqual(tg, { name: 'TELEGRAM_BOT_TOKEN', platform: 'telegram', botId: 'default', internal: false, present: false });
  assert.equal((await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'PUT', body: { value: '123456:ABC-def' } })).body.present, true);
  r = await s.call('/v1/admin/secrets');
  assert.equal(r.body.names.find((n) => n.name === 'TELEGRAM_BOT_TOKEN').present, true);
  assert.ok(!JSON.stringify(r.body).includes('123456:ABC-def')); // 값은 돌려주지 않는다
  assert.equal(readEnvFile(s.secretsFile).TELEGRAM_BOT_TOKEN, '123456:ABC-def');
  assert.equal((await s.call('/v1/admin/secrets/PATH', { method: 'PUT', body: { value: 'x' } })).body.error, 'unknown_secret');
  assert.equal((await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'PUT', body: { value: ' spaced ' } })).body.error, 'bad_secret_value');
  assert.equal((await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'PUT', body: { value: 'x' }, token: 'msg' })).body.error, 'admin_only');
  assert.equal((await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'DELETE' })).body.present, false);
  assert.equal(readEnvFile(s.secretsFile).TELEGRAM_BOT_TOKEN, undefined);
  assert.equal((await s.call('/v1/admin/kakao/skill-url')).body.error, 'no_embedded_relay');
});

test('허브 내장 카카오: 카카오 수신 토큰은 이어온이 관리(웹에서 못 바꿈), 스킬 URL은 접속한 주소로 만들어 준다', async (t) => {
  const s = await setup(t, { relay: true });
  await s.call('/v1/admin/bots/kakao/default', { method: 'PUT', body: { name: '카카오' } });
  const k = (await s.call('/v1/admin/secrets')).body.names.find((n) => n.name === 'KAKAO_RELAY_TOKEN');
  assert.deepEqual(k, { name: 'KAKAO_RELAY_TOKEN', platform: 'kakao', botId: 'default', internal: true, present: true });
  assert.equal((await s.call('/v1/admin/secrets/KAKAO_RELAY_TOKEN', { method: 'PUT', body: { value: 'other-token-0123456789' } })).body.error, 'internal_secret');
  const u = await s.call('/v1/admin/kakao/skill-url', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'ieun-gateway.sinsan.kr' } });
  assert.equal(u.body.url, 'https://ieun-gateway.sinsan.kr/kakao/skill/kakao-secret-0123456789abcdef');
});

test('이 사람 허용: 허용 목록에 없는 사람이 보내면 메신저가 알리고, 웹에서 누르면 그 봇의 추가 허용 사용자가 된다', async (t) => {
  const s = await setup(t);
  assert.equal((await s.call('/v1/messenger/denied', { method: 'POST', token: 'msg', body: { platform: 'telegram', botId: 'default', userId: '999', name: '홍길동' } })).status, 204);
  await s.call('/v1/messenger/denied', { method: 'POST', token: 'msg', body: { platform: 'telegram', botId: 'default', userId: '999' } });
  assert.equal((await s.call('/v1/messenger/denied', { method: 'POST', token: 'msg', body: { platform: 'telegram', botId: 'nope', userId: '1' } })).status, 400);
  const list = (await s.call('/v1/admin/denied')).body.denied;
  assert.equal(list.length, 1);
  assert.deepEqual({ ...list[0], at: undefined }, { platform: 'telegram', botId: 'default', userId: '999', name: '홍길동', at: undefined, count: 2 });
  assert.equal((await s.call('/v1/admin/denied/allow', { method: 'POST', body: list[0] })).body.allowed, true);
  const bot = (await s.call('/v1/admin/bots')).body.bots.find((b) => b.platform === 'telegram' && b.botId === 'default');
  assert.deepEqual(bot.extraUsers, ['999']);
  assert.equal((await s.call('/v1/admin/denied')).body.denied.length, 0);
});

test('메신저: 웹에서 넣은 토큰을 다음 동기화 때 읽어 봇을 켜고, 토큰이 바뀌면 그 봇만 다시 연결한다', async (t) => {
  const s = await setup(t);
  writeFileSync(join(s.dir, 'msg.token'), 'msg');
  const starts = [];
  const fake = (o) => { starts.push(o.token); o.log({ platform: 'telegram', event: 'started', bot: '@b' }); };
  const runner = createBotRunner({ api: serverApi(s.base, join(s.dir, 'msg.token')),
    apiFor: (p, b) => serverApi(s.base, join(s.dir, 'msg.token'), `${p}:${b}`),
    env: {}, loadEnv: () => readEnvFile(s.secretsFile), allowedUsers: {}, roomsPath: join(s.dir, 'rooms.json'),
    runners: { telegram: fake, discord: () => {}, slack: () => {} }, bridgeOpts: { pollMs: 1, waitMs: 100 } });
  t.after(() => runner.stopAll());
  let st = await runner.sync();
  assert.equal(st.find((b) => b.platform === 'telegram').state, 'token_missing');
  await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'PUT', body: { value: '111:first' } });
  st = await runner.sync();
  assert.equal(st.find((b) => b.platform === 'telegram').state, 'connected');
  await runner.sync();
  assert.deepEqual(starts, ['111:first']); // 같은 토큰이면 다시 연결하지 않는다
  await s.call('/v1/admin/secrets/TELEGRAM_BOT_TOKEN', { method: 'PUT', body: { value: '222:second' } });
  await runner.sync();
  assert.deepEqual(starts, ['111:first', '222:second']);
});
