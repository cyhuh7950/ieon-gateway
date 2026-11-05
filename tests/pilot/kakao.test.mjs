// 카카오 PC 러너 시험(모델 호출 없음). 실제 중계 모듈 + 가짜 브리지·가짜 콜백 전송. loopback 임시 포트만 사용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../../src/relay/relay.mjs';
import { runKakao, kakaoBody } from '../../src/pilot/messenger/kakao.mjs';
import { PLATFORMS, tokenEnvNames, resolveBotTokens } from '../../src/pilot/bots.mjs';

const PC = 'pc-token-0123456789abcdef';
const SECRET = 'kakao-secret-0123456789abcdef';
const cb = (n) => `https://bot-api.kakao.com/v2/bots/b1/callback/${n}`;
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };

async function setup(t, { onMessage, ...over } = {}) {
  const relay = createRelay({ pcToken: PC, kakaoSecret: SECRET, pollWaitMs: 200 });
  const addr = await relay.listen(0);
  const ac = new AbortController();
  const logs = []; const posts = []; const messages = [];
  t.after(async () => { ac.abort(); await relay.close(); });
  runKakao({
    relayUrl: `http://127.0.0.1:${addr.port}`, token: PC, signal: ac.signal, log: (e) => logs.push(e),
    onMessage: onMessage ?? (async (m, send) => { messages.push(m); await send('[세션] 접수됨 — 답을 기다리는 중'); await send(`답: ${m.text}`); }),
    postCallback: async (url, body) => { posts.push({ url, body }); return typeof over.postOk === 'function' ? over.postOk() : (over.postOk ?? true); },
    ...over,
  });
  await until(() => logs.some((l) => l.event === 'started'));
  const ask = (utterance, n, user = 'u1') => fetch(`http://127.0.0.1:${addr.port}/kakao/skill/${SECRET}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance, user: { id: user }, callbackUrl: cb(n) } }) }).then((r) => r.json());
  return { relay, logs, posts, messages, ask };
}
const textsOf = (p) => p.body.template.outputs.map((o) => o.simpleText.text);

test('질문이 중계를 거쳐 브리지로 가고 답이 콜백으로 한 번에 나간다(중간 접수 안내는 뺀다)', async (t) => {
  const r = await setup(t);
  assert.equal((await r.ask('안녕하세요', 1)).useCallback, true);
  await until(() => r.posts.length);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].url, cb(1));
  assert.deepEqual(textsOf(r.posts[0]), ['답: 안녕하세요']);
  assert.deepEqual(r.messages[0], { platform: 'kakao', userId: 'u1', chatId: 'u1', isGroup: false, called: true, text: '안녕하세요' });
});

test('여러 번 나눠 보낸 글은 하나로 모아 말풍선으로 나눈다(최대 3개, 넘치면 줄임)', () => {
  assert.equal(kakaoBody('가'.repeat(2500)).template.outputs.length, 3);
  const b = kakaoBody('가'.repeat(5000)).template.outputs;
  assert.equal(b.length, 3);
  assert.ok(b[2].simpleText.text.length <= 1000);
  assert.match(b[2].simpleText.text, /줄임/);
  assert.equal(kakaoBody('짧음').template.outputs.length, 1);
});

test('제한 시간 안에 답이 안 끝나면 안내를 콜백으로 보내고, 뒤늦은 답은 /last로 받는다', async (t) => {
  let finish;
  const gate = new Promise((ok) => { finish = ok; });
  const r = await setup(t, { callbackLimitMs: 100, onMessage: async (m, send) => { if (m.text === '느린 질문') { await gate; await send('늦은 답'); } } });
  await r.ask('느린 질문', 1);
  await until(() => r.posts.length === 1);
  assert.match(textsOf(r.posts[0]).join(''), /\/last/);
  finish();
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(r.posts.length, 1); // 쓴 콜백은 다시 쓰지 않는다
  await r.ask('/last', 2);
  await until(() => r.posts.length === 2);
  assert.deepEqual(textsOf(r.posts[1]), ['늦은 답']);
  await r.ask('/last', 3);
  await until(() => r.posts.length === 3);
  assert.deepEqual(textsOf(r.posts[2]), ['보관된 답이 없습니다.']);
});

test('/last는 다른 사용자의 보관된 답을 보여 주지 않는다', async (t) => {
  let finish;
  const gate = new Promise((ok) => { finish = ok; });
  const r = await setup(t, { callbackLimitMs: 50, onMessage: async (m, send) => { if (m.text === '느림') { await gate; await send('A의 답'); } } });
  await r.ask('느림', 1, 'userA');
  await until(() => r.posts.length === 1);
  finish();
  await new Promise((ok) => setTimeout(ok, 100));
  await r.ask('/last', 2, 'userB');
  await until(() => r.posts.length === 2);
  assert.deepEqual(textsOf(r.posts[1]), ['보관된 답이 없습니다.']);
});

test('콜백 전송이 실패하면 로그를 남기고 답을 보관해 /last로 받을 수 있다', async (t) => {
  let ok = false;
  const r = await setup(t, { postOk: () => ok, onMessage: async (m, send) => { if (m.text !== '/last') await send(`답: ${m.text}`); } });
  await r.ask('질문', 1);
  await until(() => r.logs.some((l) => l.event === 'callback_failed'));
  ok = true;
  await r.ask('/last', 2);
  await until(() => r.posts.length === 2);
  assert.deepEqual(textsOf(r.posts[1]), ['답: 질문']);
});

test('허용되지 않은 콜백 주소·잘못된 항목은 처리하지 않는다', async (t) => {
  const r = await setup(t);
  // 중계를 거치지 않고 러너가 직접 받은 항목도 PC에서 한 번 더 막는다는 것을 확인: 중계가 거르므로 여기서는 중계 거절을 확인한다.
  const a = await fetch(`http://127.0.0.1:${(r.relay.server.address()).port}/kakao/skill/${SECRET}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: 'x', user: { id: 'u1' }, callbackUrl: 'https://evil.example.com/x' } }) }).then((x) => x.json());
  assert.match(a.template.outputs[0].simpleText.text, /처리할 수 없습니다/);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(r.posts.length, 0);
  assert.equal(r.messages.length, 0);
});

test('중계 토큰이 틀리면 연결 오류로 멈추고 다시 붙지 않는다', async (t) => {
  const relay = createRelay({ pcToken: PC, kakaoSecret: SECRET, pollWaitMs: 100 });
  const addr = await relay.listen(0);
  t.after(() => relay.close());
  const logs = [];
  runKakao({ relayUrl: `http://127.0.0.1:${addr.port}`, token: 'wrong-token-0123456789', log: (e) => logs.push(e), onMessage: async () => {} });
  await until(() => logs.some((l) => l.event === 'open_error'));
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(logs.filter((l) => l.event === 'open_error').length, 1);
  assert.ok(!JSON.stringify(logs).includes('wrong-token'));
});

test('카카오 봇 등록 규칙: 플랫폼 목록·토큰 변수 이름', () => {
  assert.ok(PLATFORMS.includes('kakao'));
  assert.deepEqual(tokenEnvNames('kakao', 'default'), { token: 'KAKAO_RELAY_TOKEN' });
  assert.deepEqual(tokenEnvNames('kakao', 'aidot'), { token: 'KAKAO_BOT_AIDOT_RELAY_TOKEN' });
  const [b] = resolveBotTokens([{ platform: 'kakao', botId: 'aidot', enabled: true }], { KAKAO_BOT_AIDOT_RELAY_TOKEN: 'x' });
  assert.equal(b.status, 'ready');
  assert.equal(resolveBotTokens([{ platform: 'kakao', botId: 'aidot', enabled: true }], {})[0].status, 'token_missing');
});
