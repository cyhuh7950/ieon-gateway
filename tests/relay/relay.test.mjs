// 중계 시험(모델 호출 없음). 이 PC의 loopback 임시 포트만 쓰고 외부에는 나가지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay, callbackAllowed } from '../../src/relay/relay.mjs';

const PC = 'pc-token-0123456789abcdef';
const SECRET = 'kakao-secret-0123456789abcdef';
const CB = 'https://bot-api.kakao.com/v2/bots/b1/callback/abc';

async function start(t, over = {}) {
  const logs = [];
  const clock = { t: 1_000_000 };
  const relay = createRelay({ pcToken: PC, kakaoSecret: SECRET, pollWaitMs: 150, log: (e) => logs.push(e), now: () => clock.t, ...over });
  const addr = await relay.listen(0);
  t.after(() => relay.close());
  const base = `http://127.0.0.1:${addr.port}`;
  const post = (body, secret = SECRET) => fetch(`${base}/kakao/skill/${secret}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const poll = (token = PC) => fetch(`${base}/pc/poll`, { headers: { authorization: `Bearer ${token}` } });
  return { relay, logs, clock, base, post, poll };
}
const req = (utterance = '안녕', over = {}) => ({ userRequest: { utterance, user: { id: 'u1' }, callbackUrl: CB, ...over } });

test('PC가 연결돼 있으면 접수 응답을 주고 질문은 PC가 가져가면 지워진다', async (t) => {
  const r = await start(t);
  await r.poll(); // PC 연결 표시(빈 폴링)
  const a = await (await r.post(req('질문입니다'))).json();
  assert.equal(a.useCallback, true);
  const got = await (await r.poll()).json();
  assert.equal(got.items.length, 1);
  assert.equal(got.items[0].text, '질문입니다');
  assert.equal(got.items[0].callbackUrl, CB);
  assert.equal(r.relay.depth(), 0);
  assert.equal((await (await r.poll()).json()).items.length, 0);
});

test('대기 중인 폴링이 있으면 질문이 들어오는 즉시 전달된다', async (t) => {
  const r = await start(t, { pollWaitMs: 3000 });
  const waiting = r.poll();
  await new Promise((ok) => setTimeout(ok, 50));
  await r.post(req('바로'));
  const got = await (await waiting).json();
  assert.equal(got.items[0].text, '바로');
});

test('PC가 연결돼 있지 않으면 PC 연결 끊김으로 바로 답하고 쌓지 않는다', async (t) => {
  const r = await start(t);
  const a = await (await r.post(req())).json();
  assert.match(a.template.outputs[0].simpleText.text, /PC가 연결되어 있지 않습니다/);
  assert.equal(r.relay.depth(), 0);
  await r.poll();
  r.clock.t += 46_000; // 연결 표시가 만료된다
  assert.match((await (await r.post(req('x', { callbackUrl: CB + '2' }))).json()).template.outputs[0].simpleText.text, /연결되어 있지 않습니다/);
});

test('스킬 주소의 비밀 값이 틀리면 404, PC 토큰이 틀리면 401', async (t) => {
  const r = await start(t);
  assert.equal((await r.post(req(), 'wrong-secret-0123456789')).status, 404);
  assert.equal((await r.poll('wrong-token-0123456789')).status, 401);
  assert.equal((await fetch(`${r.base}/pc/poll`)).status, 401);
});

test('콜백 주소는 https와 허용 도메인만 받는다(PC가 그 주소로 보내므로)', async (t) => {
  assert.equal(callbackAllowed(CB, ['bot-api.kakao.com']), true);
  for (const bad of ['http://bot-api.kakao.com/x', 'https://evil.example.com/x', 'https://bot-api.kakao.com.evil.com/x',
    'https://user:pw@bot-api.kakao.com/x', 'https://bot-api.kakao.com:8443/x', 'not a url']) assert.equal(callbackAllowed(bad, ['bot-api.kakao.com']), false, bad);
  const r = await start(t);
  await r.poll();
  const a = await (await r.post(req('x', { callbackUrl: 'https://evil.example.com/steal' }))).json();
  assert.match(a.template.outputs[0].simpleText.text, /처리할 수 없습니다/);
  assert.equal(r.relay.depth(), 0);
});

test('콜백이 없는 요청은 안내만 하고 쌓지 않는다', async (t) => {
  const r = await start(t);
  await r.poll();
  const body = req(); delete body.userRequest.callbackUrl;
  assert.match((await (await r.post(body)).json()).template.outputs[0].simpleText.text, /콜백/);
  assert.equal(r.relay.depth(), 0);
});

test('같은 콜백 주소의 재전송은 한 번만 쌓는다', async (t) => {
  const r = await start(t);
  await r.poll();
  await r.post(req('같은 글'));
  const again = await (await r.post(req('같은 글'))).json();
  assert.equal(again.useCallback, true);
  assert.equal(r.relay.depth(), 1);
});

test('대기열 상한을 넘으면 받지 않고, 오래된 요청은 TTL 뒤 지운다', async (t) => {
  const r = await start(t, { maxQueue: 2, ttlMs: 10_000 });
  await r.poll();
  for (const i of [1, 2]) await r.post(req('q' + i, { callbackUrl: CB + i }));
  const full = await (await r.post(req('q3', { callbackUrl: CB + 3 }))).json();
  assert.match(full.template.outputs[0].simpleText.text, /너무 많습니다/);
  r.clock.t += 11_000;
  const got = await (await r.poll()).json();
  assert.equal(got.items.length, 0);
  assert.ok(r.logs.some((e) => e.event === 'expired'));
});

test('너무 큰 본문·잘못된 JSON·긴 글은 거절하고 호출 빈도를 제한한다', async (t) => {
  const r = await start(t, { rateLimit: 5 });
  await r.poll();
  assert.equal((await r.post('x'.repeat(20_000))).status, 413);
  assert.equal((await r.post('{not json')).status, 400);
  const long = await (await r.post(req('가'.repeat(2001)))).json();
  assert.match(long.template.outputs[0].simpleText.text, /처리할 수 없습니다/);
  assert.equal(r.relay.depth(), 0);
  let last;
  for (let i = 0; i < 6; i++) last = await r.post(req('r' + i, { callbackUrl: CB + 'r' + i }));
  assert.equal(last.status, 429);
});

test('로그에 질문 원문·사용자 키·콜백 주소가 남지 않는다', async (t) => {
  const r = await start(t);
  await r.poll();
  await r.post(req('비밀 질문 내용', { user: { id: 'secret-user-key' } }));
  await r.poll();
  const all = JSON.stringify(r.logs);
  for (const s of ['비밀 질문 내용', 'secret-user-key', CB, PC, SECRET]) assert.ok(!all.includes(s), s);
});

test('설정 값이 짧으면 시작하지 않는다', () => {
  assert.throws(() => createRelay({ pcToken: 'short', kakaoSecret: SECRET }));
  assert.throws(() => createRelay({ pcToken: PC, kakaoSecret: 'short' }));
});

test('health는 비밀 값 없이 PC 연결 여부만 알려 준다', async (t) => {
  const r = await start(t);
  assert.deepEqual(await (await fetch(`${r.base}/health`)).json(), { ok: true, pc: false });
  await r.poll();
  assert.deepEqual(await (await fetch(`${r.base}/health`)).json(), { ok: true, pc: true });
});
