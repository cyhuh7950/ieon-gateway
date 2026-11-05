// 여러 봇 M2: 메신저별 "이 봇을 불렀는지" 판별(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramAddress, discordAddress, slackAddress } from '../../src/pilot/messenger/platforms.mjs';

test('텔레그램: 1:1·멘션·답장·/명령@이 봇은 부름, /명령@다른 봇은 무시', () => {
  const g = (text, extra = {}) => telegramAddress({ chat: { type: 'supergroup' }, text, ...extra }, 'ieun_cyhuh_bot');
  assert.deepEqual(telegramAddress({ chat: { type: 'private' }, text: '안녕' }, 'ieun_cyhuh_bot'), { isGroup: false, called: false, forOther: false, text: '안녕' });
  assert.deepEqual(g('안녕'), { isGroup: true, called: false, forOther: false, text: '안녕' });
  assert.deepEqual(g('@ieun_cyhuh_bot 이 PR 봐 줘'), { isGroup: true, called: true, forOther: false, text: '이 PR 봐 줘' });
  assert.deepEqual(g('@IEUN_CYHUH_BOT, 상태'), { isGroup: true, called: true, forOther: false, text: '상태' });
  assert.deepEqual(g('/status@ieun_cyhuh_bot'), { isGroup: true, called: true, forOther: false, text: '/status' });
  assert.deepEqual(g('/status@Test_cyhuh_01_bot'), { isGroup: true, called: false, forOther: true, text: '/status@Test_cyhuh_01_bot' });
  assert.equal(g('계속', { reply_to_message: { from: { username: 'ieun_cyhuh_bot' } } }).called, true);
  assert.equal(g('계속', { reply_to_message: { from: { username: 'someone' } } }).called, false);
  assert.equal(g('메일 @ieun_cyhuh_botx 참고').called, false); // 다른 이름의 일부는 멘션 아님
});

test('디스코드: 서버 채널은 그룹, <@봇> 멘션·봇 메시지 답장은 부름', () => {
  assert.deepEqual(discordAddress({ content: '안녕' }, 'B1'), { isGroup: false, called: false, forOther: false, text: '안녕' });
  assert.deepEqual(discordAddress({ guild_id: 'G', content: '<@B1> 이거 봐' }, 'B1'), { isGroup: true, called: true, forOther: false, text: '이거 봐' });
  assert.deepEqual(discordAddress({ guild_id: 'G', content: '<@!B1>, /status' }, 'B1').text, '/status');
  assert.equal(discordAddress({ guild_id: 'G', content: '<@B2> 이거' }, 'B1').called, false);
  assert.equal(discordAddress({ guild_id: 'G', content: '계속', referenced_message: { author: { id: 'B1' } } }, 'B1').called, true);
});

test('슬랙: im은 1:1, <@봇> 멘션·봇 스레드 답장은 부름, !명령은 /명령', () => {
  assert.deepEqual(slackAddress({ channel_type: 'im', text: '!whoami' }, 'U1'), { isGroup: false, called: false, forOther: false, text: '/whoami' });
  assert.deepEqual(slackAddress({ channel_type: 'channel', text: '<@U1> !status' }, 'U1'), { isGroup: true, called: true, forOther: false, text: '/status' });
  assert.deepEqual(slackAddress({ channel_type: 'channel', text: '<@U2> 질문' }, 'U1'), { isGroup: true, called: false, forOther: false, text: '질문' });
  assert.equal(slackAddress({ channel_type: 'channel', text: '계속', parent_user_id: 'U1' }, 'U1').called, true);
});

test('다른 봇을 부른 글: 텔레그램 다른 @…bot·디스코드 다른 봇 멘션·봇 역할 멘션은 그 봇 것', () => {
  const tg = (text, extra = {}) => telegramAddress({ chat: { type: 'group' }, text, ...extra }, 'Test_cyhuh_01_bot');
  assert.equal(tg('@ieun_cyhuh_bot /whoami').forOther, true);
  assert.equal(tg('@Test_cyhuh_01_bot /whoami').forOther, false);
  assert.equal(tg('계속', { reply_to_message: { from: { is_bot: true, username: 'ieun_cyhuh_bot' } } }).forOther, true);
  assert.equal(tg('@someone 안녕').forOther, false); // 사람 멘션은 상관없음
  const roles = { mine: new Set(['R_ME']), bots: new Set(['R_ME', 'R_OTHER']) };
  assert.deepEqual(discordAddress({ guild_id: 'G', content: '<@&R_ME> /whoami', mention_roles: ['R_ME'] }, 'B1', roles),
    { isGroup: true, called: true, forOther: false, text: '/whoami' });
  assert.equal(discordAddress({ guild_id: 'G', content: '<@&R_OTHER> /whoami', mention_roles: ['R_OTHER'] }, 'B1', roles).forOther, true);
  assert.equal(discordAddress({ guild_id: 'G', content: '<@B2> /whoami', mentions: [{ id: 'B2', bot: true }] }, 'B1', roles).forOther, true);
  assert.equal(discordAddress({ guild_id: 'G', content: '<@U9> 안녕', mentions: [{ id: 'U9', bot: false }] }, 'B1', roles).forOther, false);
});
