import test from 'node:test';
import assert from 'node:assert/strict';
import { validBotId, validCallName, tokenEnvNames, botAppId, resolveBotTokens, migrateRooms } from '../../src/pilot/bots.mjs';

test('봇 ID 규칙: 영문 소문자·숫자·- 2~32자', () => {
  for (const ok of ['default', 'ieun01', 'code-review', '01', 'a'.repeat(32)]) assert.equal(validBotId(ok), true, ok);
  for (const bad of ['a', 'Review', 'code_review', '-ab', 'ab-', '리뷰', 'a'.repeat(33), '', null]) assert.equal(validBotId(bad), false, String(bad));
});

test('부르는 이름 규칙: 한글·영문·숫자 1~20자, 명령어 불가', () => {
  for (const ok of ['리뷰', '리뷰봇', 'Reviewer', '봇1', '리 뷰']) assert.equal(validCallName(ok), true, ok);
  for (const bad of ['', 'help', 'New', 'Review', '리뷰!', 'a'.repeat(21)]) assert.equal(validCallName(bad), false, bad);
});

test('토큰 변수 이름: default는 기존 이름, 그 밖은 <메신저>_BOT_<ID>_TOKEN', () => {
  assert.deepEqual(tokenEnvNames('telegram', 'default'), { token: 'TELEGRAM_BOT_TOKEN' });
  assert.deepEqual(tokenEnvNames('slack', 'default'), { appToken: 'SLACK_APP_TOKEN', botToken: 'SLACK_BOT_TOKEN' });
  assert.deepEqual(tokenEnvNames('telegram', 'ieun01'), { token: 'TELEGRAM_BOT_IEUN01_TOKEN' });
  assert.deepEqual(tokenEnvNames('discord', 'code-review'), { token: 'DISCORD_BOT_CODE_REVIEW_TOKEN' });
  assert.deepEqual(tokenEnvNames('slack', 'ieun01'), { appToken: 'SLACK_BOT_IEUN01_APP_TOKEN', botToken: 'SLACK_BOT_IEUN01_BOT_TOKEN' });
  assert.equal(botAppId('telegram', 'default'), 'app_messenger');
  assert.equal(botAppId('telegram', 'ieun01'), 'app_bot_telegram_ieun01');
});

test('토큰 찾기: 없는 토큰·중복 토큰을 알리고 값은 상태에 싣지 않는다', () => {
  const bots = [
    { platform: 'telegram', botId: 'default', enabled: true },
    { platform: 'telegram', botId: 'ieun01', enabled: true },
    { platform: 'slack', botId: 'ieun01', enabled: true },
    { platform: 'discord', botId: 'copy', enabled: true },
    { platform: 'discord', botId: 'off', enabled: false },
  ];
  const env = { TELEGRAM_BOT_TOKEN: 't0', TELEGRAM_BOT_IEUN01_TOKEN: 't1', SLACK_BOT_IEUN01_APP_TOKEN: 'xapp', DISCORD_BOT_COPY_TOKEN: 't1' };
  const r = resolveBotTokens(bots, env);
  assert.deepEqual(r.map((b) => [b.platform, b.botId, b.status]), [
    ['telegram', 'default', 'ready'], ['telegram', 'ieun01', 'duplicate_token'],
    ['slack', 'ieun01', 'token_missing'], ['discord', 'copy', 'duplicate_token']]);
  assert.deepEqual(r[2].missing, ['SLACK_BOT_IEUN01_BOT_TOKEN']);
});

test('대화방 키 전환: 옛 키는 default 봇으로, 이미 바뀐 파일은 그대로', () => {
  const { data, changed } = migrateRooms({ 'telegram:-100': 'c1', 'telegram:-100:7': 'c2', 'slack:C0X': 'c3' });
  assert.equal(changed, true);
  assert.deepEqual(data, { _v: 2, rooms: { 'telegram:default:-100': 'c1', 'telegram:default:-100:7': 'c2', 'slack:default:C0X': 'c3' } });
  assert.deepEqual(migrateRooms(data), { data, changed: false });
  assert.deepEqual(migrateRooms(undefined).data, { _v: 2, rooms: {} });
});
