// 메시지 처리 신뢰성(2026-11-14 신산님 요청 검토 항목, 모델 0):
// ① 메신저가 같은 메시지를 다시 보내도 한 번만 실행(원본 메시지 기준 요청 열쇠)
// ② 슬랙 스레드마다 세션 연결이 따로(같은 채널의 다른 스레드와 섞이지 않음) — 연결이 없는 스레드는 채널 연결을 따름(기존 동작)
// ③ 엔진 실행 완료와 답 전달 완료를 나눔 — 전달이 실패하면 엔진을 다시 돌리지 않고 전달만 다시(/last), 메신저 API 오류(ok:false)를 성공으로 보지 않음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';
import { messengerOk } from '../../src/pilot/messenger/platforms.mjs';

const conv = (id, label, over = {}) => ({ conversationId: id, label, engine: 'codex_thread', connectMode: 'alternate', deviceOnline: true, busy: false, ...over });

function setup(t, { conversations = [conv('c1', '세션 하나'), conv('c2', '세션 둘')], answer = '답' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-rel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = []; const logs = [];
  let n = 0;
  const api = async (req) => {
    calls.push(req);
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) { n += 1; return { status: 202, body: { requestId: 'req_' + n } }; }
    if (req.method === 'GET' && req.path.startsWith('/v1/requests/')) return { status: 200, body: { status: 'completed', answer: `${answer}(${req.path.split('/').pop()})` } };
    return { status: 404, body: { error: 'not_found' } };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'], slack: ['U1'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000, log: (e) => logs.push(e), deliverRetryMs: 1 });
  const posts = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/requests'));
  return { bridge, calls, posts, logs };
}

test('① 같은 메시지가 다시 오면(같은 msgId) 한 번만 보낸다 — 원본 메시지 기준 요청 열쇠, 다른 메시지는 다른 열쇠', async (t) => {
  const s = setup(t);
  const said = []; const send = async (x) => { said.push(x); };
  const m = (text, msgId) => ({ platform: 'telegram', userId: '111', chatId: '-100', text, msgId });
  await s.bridge.handle(m('/use 1', 'tg--100-1'), send);
  await s.bridge.handle(m('빌드 돌려 줘', 'tg--100-2'), send);
  await s.bridge.handle(m('빌드 돌려 줘', 'tg--100-2'), send); // 다시 옴(재접속·재전송)
  assert.equal(s.posts().length, 1, '엔진에 한 번만');
  const key = s.posts()[0].headers['idempotency-key'];
  assert.match(key, /^msg-[0-9a-f]{40}$/, '원본 메시지에서 만든 열쇠');
  await s.bridge.handle(m('빌드 돌려 줘', 'tg--100-3'), send); // 같은 글이라도 새 메시지면 새 질문
  assert.equal(s.posts().length, 2);
  assert.notEqual(s.posts()[1].headers['idempotency-key'], key);
  // 다시 켠 뒤(새 브리지)에 같은 메시지가 와도 같은 열쇠 → 서버가 같은 요청으로 받음(중복 실행 없음)
  const s2 = setup(t);
  await s2.bridge.handle(m('/use 1', 'tg--100-1'), send);
  await s2.bridge.handle(m('빌드 돌려 줘', 'tg--100-2'), send);
  assert.equal(s2.posts()[0].headers['idempotency-key'], key);
});

test('② 슬랙: 스레드마다 연결이 따로 — 한 스레드의 /use가 다른 스레드를 바꾸지 않음, 연결 없는 스레드는 채널 연결을 따름', async (t) => {
  const s = setup(t);
  const said = []; const send = async (x) => { said.push(x); };
  const sl = (text, threadKey, ts) => ({ platform: 'slack', userId: 'U1', chatId: 'C1', isGroup: true, called: true, text, threadKey, msgId: `sl-C1-${ts}` });
  await s.bridge.handle(sl('/use 1', undefined, '1'), send);          // 채널 기본: 세션 하나
  await s.bridge.handle(sl('/use 2', 'T-A', '2'), send);              // 스레드 A만: 세션 둘
  await s.bridge.handle(sl('스레드 A 질문', 'T-A', '3'), send);
  await s.bridge.handle(sl('스레드 B 질문', 'T-B', '4'), send);        // 스레드 B: 연결 없음 → 채널(세션 하나)
  await s.bridge.handle(sl('채널 질문', undefined, '5'), send);
  assert.deepEqual(s.posts().map((p) => p.path), ['/v1/conversations/c2/requests', '/v1/conversations/c1/requests', '/v1/conversations/c1/requests']);
  // 텔레그램 주제(topic)는 지금처럼 따로이고 채널 연결을 따르지 않음(기존 동작 보존)
  const tg = (text, threadKey, id) => ({ platform: 'telegram', userId: '111', chatId: '-200', text, threadKey, msgId: `tg--200-${id}` });
  await s.bridge.handle(tg('/use 1', undefined, 1), send);
  said.length = 0;
  await s.bridge.handle(tg('주제 질문', 77, 2), send);
  assert.match(said.at(-1), /연결된 세션이 없음/);
});

test('③ 답 전달이 실패하면 엔진은 다시 돌리지 않고 전달만 다시 — 잠깐 실패는 재시도, 끝내 실패하면 기록하고 /last로 다시 받기', async (t) => {
  const s = setup(t, { answer: '결과' });
  let fails = 2; const said = [];
  const flaky = async (x) => { if (/^결과/.test(x) && fails > 0) { fails -= 1; throw Object.assign(new Error('telegram_429'), { retryable: true }); } said.push(x); };
  const m = (text, id) => ({ platform: 'telegram', userId: '111', chatId: '-100', text, msgId: `tg--100-${id}` });
  await s.bridge.handle(m('/use 1', 1), flaky);
  await s.bridge.handle(m('질문', 2), flaky);
  assert.ok(said.includes('결과(req_1)'), '두 번 실패 뒤 세 번째에 전달');
  assert.equal(s.posts().length, 1);
  // 끝내 실패(재시도 불가 오류) → 전달 실패로 기록, 엔진 다시 안 돌림
  const dead = async (x) => { if (/^결과/.test(x)) throw Object.assign(new Error('telegram_403'), { retryable: false }); said.push(x); };
  await s.bridge.handle(m('두 번째 질문', 3), dead);
  assert.ok(s.logs.some((e) => e.event === 'deliver_failed' && e.requestId === 'req_2'), '전달 실패 기록(내용 없이)');
  assert.ok(!JSON.stringify(s.logs).includes('결과'), '로그에 답 원문 없음');
  assert.match(said.at(-1), /답을 보내지 못했어요.*\/last/);
  // /status에 전달 실패가 보이고, /last는 요청을 다시 읽어 전달만(새 질문 없음)
  said.length = 0;
  const ok = async (x) => { said.push(x); };
  await s.bridge.handle(m('/status', 4), ok);
  assert.match(said.at(-1), /답 전달 실패/);
  await s.bridge.handle(m('/last', 5), ok);
  assert.ok(said.includes('결과(req_2)'));
  assert.equal(s.posts().length, 2, '엔진은 두 번만(질문 두 개)');
});

test('③ 메신저 API가 오류를 돌려주면(텔레그램·슬랙 ok:false) 성공으로 보지 않는다', () => {
  assert.doesNotThrow(() => messengerOk('telegram', { ok: true, result: {} }));
  assert.throws(() => messengerOk('telegram', { ok: false, error_code: 429, description: 'Too Many Requests' }), (e) => e.retryable === true && /telegram_429/.test(e.message));
  assert.throws(() => messengerOk('telegram', { ok: false, error_code: 403 }), (e) => e.retryable === false);
  assert.throws(() => messengerOk('slack', { ok: false, error: 'ratelimited' }), (e) => e.retryable === true);
  assert.throws(() => messengerOk('slack', { ok: false, error: 'channel_not_found' }), (e) => e.retryable === false);
  assert.throws(() => messengerOk('slack', null), (e) => e.retryable === true);
});

test('메신저 연결: 원본 메시지 번호와 슬랙 스레드를 브리지에 넘긴다', async () => {
  const { telegramMsgId, discordMsgId, slackMsgId, slackThreadKey } = await import('../../src/pilot/messenger/platforms.mjs');
  assert.equal(telegramMsgId({ chat: { id: -100 }, message_id: 42 }), 'tg--100-42');
  assert.equal(discordMsgId({ id: '9' }), 'dc-9');
  assert.equal(slackMsgId({ channel: 'C1', client_msg_id: 'abc', ts: '1.2' }), 'sl-C1-abc');
  assert.equal(slackMsgId({ channel: 'C1', ts: '1.2' }), 'sl-C1-1.2');
  assert.equal(slackThreadKey({ ts: '5.0' }), undefined, '채널 글은 스레드 없음');
  assert.equal(slackThreadKey({ ts: '6.0', thread_ts: '5.0' }), '5.0', '스레드 답글은 그 스레드');
  const P = (await import('node:fs')).readFileSync(new URL('../../src/pilot/messenger/platforms.mjs', import.meta.url), 'utf8');
  assert.ok(P.includes('threadKey: slackThreadKey(ev), msgId: slackMsgId(ev)') && P.includes('msgId: telegramMsgId(msg)') && P.includes('msgId: discordMsgId(d)'));
  assert.ok(P.includes("messengerOk('telegram', b)") && P.includes("messengerOk('slack', b)"), '보내기 결과를 확인');
});
