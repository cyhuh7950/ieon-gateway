// 여러 봇 M1: 실제 이어온 서버 + 대역 메신저 연결로 봇 2개를 동시에 돌린다(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';
import { serverApi } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t, { env = {}, rooms } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-run-'));
  const app = createApp({
    dbPath: join(dir, 'pilot.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }],
    bindings: [
      { conversationId: 'c_shared', label: '공용', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' },
      { conversationId: 'c_review', label: '리뷰 전용', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_bot_telegram_ieun01'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't2' },
    ],
  });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  writeFileSync(join(dir, 'msg.token'), 'msg');
  if (rooms) writeFileSync(join(dir, 'rooms.json'), JSON.stringify(rooms));
  const web = (path, method = 'GET', body) => fetch(base + path, { method, headers: { authorization: 'Bearer web', 'content-type': 'application/json' },
    body: body && JSON.stringify(body) }).then(async (r) => (r.status === 204 ? null : r.json()));
  // 대역 메신저 연결: 띄운 봇과 그 onMessage를 기록한다.
  const started = new Map();
  const fake = (platform) => (o) => {
    started.set(`${platform}:${o.token ?? o.botToken}`, o);
    o.log({ platform, event: 'started', bot: `@${platform}_${o.token ?? o.botToken}_bot`, canReadAll: false });
  };
  const runner = createBotRunner({
    api: serverApi(base, join(dir, 'msg.token')),
    apiFor: (platform, botId) => serverApi(base, join(dir, 'msg.token'), `${platform}:${botId}`),
    env, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'),
    runners: { telegram: fake('telegram'), discord: fake('discord'), slack: fake('slack') },
    bridgeOpts: { pollMs: 1, waitMs: 500 },
  });
  t.after(async () => { runner.stopAll(); await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const say = async (platform, token, text, user = '111', chat = '-100') => {
    const out = [];
    await started.get(`${platform}:${token}`).onMessage({ platform, userId: user, chatId: chat, text }, async (s) => { out.push(s); });
    return out;
  };
  return { runner, web, started, say, dir };
}

test('기존 설정만으로: 토큰이 있는 default 봇만 켜지고 지금처럼 동작한다', async (t) => {
  const s = await setup(t, { env: { TELEGRAM_BOT_TOKEN: 'T0' }, rooms: { 'telegram:-100': 'c_shared' } });
  const st = await s.runner.sync();
  assert.deepEqual(st.map((x) => [x.platform, x.botId, x.state]), [
    ['discord', 'default', 'token_missing'], ['slack', 'default', 'token_missing'], ['telegram', 'default', 'connected']]);
  assert.deepEqual([...s.started.keys()], ['telegram:T0']);
  assert.match((await s.say('telegram', 'T0', '/status'))[0], /공용/); // 옛 rooms.json 연결이 이어짐
});

test('같은 메신저 봇 2개를 동시에 돌리고 세션 범위·허용 사용자·대화방 연결을 봇마다 나눈다', async (t) => {
  const s = await setup(t, { env: { TELEGRAM_BOT_TOKEN: 'T0', TELEGRAM_BOT_IEUN01_TOKEN: 'T1' } });
  await s.web('/v1/admin/bots/telegram/ieun01', 'PUT', { name: '리뷰 봇', extraUsers: ['222'] });
  await s.runner.sync();
  assert.deepEqual([...s.started.keys()].sort(), ['telegram:T0', 'telegram:T1']);
  // 세션 범위: default는 공용만, ieun01은 리뷰 전용만
  assert.match((await s.say('telegram', 'T0', '/sessions'))[0], /^1\. 공용/);
  assert.match((await s.say('telegram', 'T1', '/sessions'))[0], /^1\. 리뷰 전용/);
  // 허용 사용자: 222는 ieun01에만 허용
  assert.deepEqual(await s.say('telegram', 'T0', '/sessions', '222'), []);
  assert.match((await s.say('telegram', 'T1', '/sessions', '222'))[0], /리뷰 전용/);
  // 같은 대화방이라도 봇마다 연결이 따로 저장된다
  await s.say('telegram', 'T0', '/use 1');
  await s.say('telegram', 'T1', '/use 1');
  assert.deepEqual(JSON.parse(readFileSync(join(s.dir, 'rooms.json'), 'utf8')).rooms,
    { 'telegram:default:-100': 'c_shared', 'telegram:ieun01:-100': 'c_review' });
  assert.match((await s.say('telegram', 'T1', '/whoami'))[0], /봇 ID: ieun01/);
});

test('상태 보고·변경 반영: 토큰 없음·중복을 알리고, 끄거나 지우면 연결을 멈추며 허용 사용자 변경은 바로 반영', async (t) => {
  const s = await setup(t, { env: { TELEGRAM_BOT_TOKEN: 'T0', TELEGRAM_BOT_IEUN01_TOKEN: 'T1', DISCORD_BOT_TOKEN: 'T1' } });
  await s.web('/v1/admin/bots/telegram/ieun01', 'PUT', { name: '리뷰 봇' });
  await s.web('/v1/admin/bots/slack/ieun01', 'PUT', { name: '슬랙 리뷰' });
  const st = await s.runner.sync();
  const by = Object.fromEntries(st.map((x) => [`${x.platform}:${x.botId}`, x]));
  assert.equal(by['telegram:ieun01'].state, 'duplicate_token'); // 디스코드 default와 같은 값
  assert.equal(by['discord:default'].state, 'duplicate_token');
  assert.deepEqual(by['slack:ieun01'].missing, ['SLACK_BOT_IEUN01_APP_TOKEN', 'SLACK_BOT_IEUN01_BOT_TOKEN']);
  const admin = (await s.web('/v1/admin/bots')).bots;
  assert.equal(admin.find((b) => b.platform === 'telegram' && b.botId === 'default').status.username, '@telegram_T0_bot');
  assert.equal(admin.find((b) => b.platform === 'telegram' && b.botId === 'default').status.canReadAll, false);
  assert.equal(JSON.stringify(admin).includes('"T0"') || JSON.stringify(admin).includes('"T1"'), false); // 토큰 값은 보고되지 않음

  const s2 = await setup(t, { env: { TELEGRAM_BOT_TOKEN: 'T0', TELEGRAM_BOT_IEUN01_TOKEN: 'T1' } });
  await s2.web('/v1/admin/bots/telegram/ieun01', 'PUT', { name: '리뷰 봇' });
  await s2.runner.sync();
  const conn = s2.started.get('telegram:T1');
  assert.deepEqual(await s2.say('telegram', 'T1', '/sessions', '333'), []);
  await s2.web('/v1/admin/bots/telegram/ieun01', 'PUT', { name: '리뷰 봇', extraUsers: ['333'] });
  await s2.runner.sync();
  assert.match((await s2.say('telegram', 'T1', '/sessions', '333'))[0], /리뷰 전용/);
  await s2.web('/v1/admin/bots/telegram/ieun01', 'PUT', { name: '리뷰 봇', enabled: false });
  await s2.runner.sync();
  assert.equal(conn.signal.aborted, true);
  assert.equal(s2.runner.running.has('telegram:ieun01'), false);
});
