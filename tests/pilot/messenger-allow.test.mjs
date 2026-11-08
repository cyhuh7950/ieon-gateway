// 웹에서 "허용"을 누르면 다음 설정 주기를 기다리지 않고 바로 통한다(실제 메신저 없이, 모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';

async function setup(t, allowRefreshMs) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-allow-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const state = { extraUsers: [], common: null, botReads: 0, denied: [], events: [] };
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') {
      state.botReads += 1;
      return { status: 200, body: { bots: [{ platform: 'telegram', botId: 'default', name: '기본', callNames: [], extraUsers: state.extraUsers, enabled: true }] } };
    }
    if (req.path === '/v1/messenger/config') return { status: 200, body: { allowedUsers: state.common } };
    if (req.path === '/v1/messenger/denied') state.denied.push(req.body.userId);
    return { status: 200, body: {} };
  };
  let onMessage;
  const runner = createBotRunner({ api, apiFor: () => api, env: { TELEGRAM_BOT_TOKEN: 'token-value' }, roomsPath: join(d, 'rooms.json'), allowRefreshMs,
    log: (e) => { if (e.event === 'message') state.events.push(e.allowed); },
    runners: { telegram: (o) => { onMessage = o.onMessage; } } });
  await runner.sync();
  t.after(() => runner.stopAll());
  const say = async (userId) => {
    const out = [];
    await onMessage({ platform: 'telegram', userId, chatId: 'c', text: '/whoami' }, async (x) => { out.push(x); });
    return out.join('\n');
  };
  return { state, say, runner };
}

test('허용 직후 보낸 메시지는 설정 주기를 기다리지 않고 통한다', async (t) => {
  const { state, say, runner } = await setup(t, 0);
  assert.match(await say('u1'), /허용 목록에 없음/);
  assert.deepEqual(state.denied, ['u1']);
  state.extraUsers = ['u1']; // 웹에서 허용
  assert.match(await say('u1'), /허용됨/);
  assert.deepEqual(state.events, [false, true]);
  assert.deepEqual(state.denied, ['u1'], '허용된 뒤에는 허용 요청에 다시 오르지 않는다');
  assert.deepEqual(runner.running.get('telegram:default').def.tokens, { token: 'token-value' }, '토큰은 그대로');
});

test('공통 허용 사용자에 넣어도 바로 통한다', async (t) => {
  const { state, say } = await setup(t, 0);
  state.common = { telegram: ['u2'] };
  assert.match(await say('u2'), /허용됨/);
  assert.deepEqual(state.denied, []);
});

test('허용된 사람은 다시 읽지 않고, 모르는 사람이 몰려도 최소 간격을 지킨다', async (t) => {
  const { state, say } = await setup(t, 60000);
  const afterSync = state.botReads;
  await say('stranger');
  assert.equal(state.botReads, afterSync + 1);
  await say('stranger');
  await say('stranger');
  assert.equal(state.botReads, afterSync + 1);
  assert.deepEqual(state.events, [false, false, false]);
  state.extraUsers = ['friend']; // 간격 안의 변경은 다음 읽기·주기에 반영된다
  await say('stranger');
  assert.equal(state.botReads, afterSync + 1);
});