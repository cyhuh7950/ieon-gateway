// RC4(REQUEST_CONTROL 4절): 끊긴 뒤 같은 세션인지 확인. 요청마다 그때의 엔진·PC·세션·연결 방식·작업 모드를 남기고,
// 다시 볼 때 지금 이 대화의 세션과 같은지·보관 기록이 그대로인지·확인 필요 질문이 막고 있는지 알려 준다. 세션 ID는 응답에 싣지 않는다. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { openStore } from '../../src/pilot/store.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000031';
const T9 = '01a18790-0000-7000-8000-000000000039';

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc4-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '하나', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), text: '' }));
  await call('/v1/device/jobs', { token: 'dev' });
  return { call };
}

test('결과 불명으로 끊긴 질문: 그때와 같은 세션임을 확인 카드·작업 상세에 보이고, 세션 ID는 어디에도 싣지 않는다', async (t) => {
  const s = await setup(t);
  const id = (await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: 'k-rc4-000001' })).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' });
  await s.call(`/v1/device/jobs/${id}/result`, { token: 'dev', method: 'POST', body: { status: 'unknown', errorCode: 'result_unknown' } });
  const d = (await s.call('/v1/tasks/' + id)).body;
  assert.deepEqual([d.resume.known, d.resume.verdict, d.resume.sameSession, d.resume.sameEngine, d.resume.sameHost, d.resume.historyKept, d.resume.heldBy.isThis, d.resume.deviceOnline],
    [true, 'needs_review', true, true, true, true, true, true], '같은 세션, 이 질문이 대화를 막고 있음');
  assert.equal(d.resume.then.engine, 'codex_thread');
  const held = (await s.call('/v1/conversations/c1/cards')).body.cards.find((c) => c.kind === 'held');
  assert.deepEqual(held.resume, { verdict: 'needs_review', sameSession: true, historyKept: true });
  const all = JSON.stringify([d, held, (await s.call('/v1/tasks')).body]);
  assert.ok(!all.includes(T1) && !all.includes(T1.slice(0, 8)), '세션 ID(앞부분도)는 응답에 없다');
  // 정리하면 막힘이 풀리고 같은 세션
  await s.call(`/v1/requests/${id}/review`, { method: 'POST', body: { executed: false } });
  assert.equal((await s.call('/v1/tasks/' + id)).body.resume.verdict, 'same');
});

test('보관 기록을 지운 뒤에는 "보관 기록이 그 뒤 지워짐"으로 알린다', async (t) => {
  const s = await setup(t);
  const id = (await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: 'k-rc4-000002' })).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' });
  await s.call(`/v1/device/jobs/${id}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: 'a' } });
  assert.equal((await s.call('/v1/tasks/' + id)).body.resume.historyKept, true);
  assert.equal((await s.call('/v1/conversations/c1/messages', { method: 'DELETE' })).status, 204);
  const r = (await s.call('/v1/tasks/' + id)).body.resume;
  assert.deepEqual([r.historyKept, r.sameSession, r.verdict], [false, true, 'same']);
});

test('그 뒤 대화 연결이 다른 세션·다른 PC로 바뀌면 "세션이 바뀜"(mismatch), 없는 질문은 null', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc4s-'));
  const store = openStore(join(d, 's.db'));
  t.after(() => { try { store.close?.(); rmSync(d, { recursive: true, force: true }); } catch { /* Windows 파일 잠금이면 남겨 둠 */ } });
  const me = { userId: 'u_sinsan', appId: 'app_web' };
  assert.equal(store.saveBinding('u_sinsan', { conversationId: 'cw', label: '웹 등록', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }).http, 200);
  const r1 = store.submit(me, 'cw', 'k-rc4-s-0001', { question: 'q' });
  assert.equal(store.claim('h_pc').requestId, r1.requestId);
  store.report('h_pc', r1.requestId, { status: 'completed', answer: 'a', sessionRef: T1 });
  assert.equal(store.resumeCheck(r1.requestId).verdict, 'same');
  // 사람이 웹에서 이 대화를 다른 Codex 대화로 바꿈(잠금이 없을 때만 가능)
  assert.equal(store.saveBinding('u_sinsan', { conversationId: 'cw', label: '웹 등록', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T9 }).http, 200);
  const c = store.resumeCheck(r1.requestId);
  assert.deepEqual([c.verdict, c.sameSession, c.sameEngine, c.sameHost], ['mismatch', false, true, true]);
  // 다른 PC로 옮긴 경우도 mismatch
  store.saveBinding('u_sinsan', { conversationId: 'cw', label: '웹 등록', appIds: ['app_web'], hostId: 'h_other', engine: 'codex_thread', sessionRef: T1 });
  assert.deepEqual([store.resumeCheck(r1.requestId).verdict, store.resumeCheck(r1.requestId).sameHost], ['mismatch', false]);
  assert.equal(store.resumeCheck('req_nope'), null);
});

test('메신저 /status: 확인 필요 질문이 막고 있으면 그때 세션과 같은지 한 줄', async () => {
  const said = []; let same = true;
  const api = async (req) => {
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [{ conversationId: 'c1', label: '하나', engine: 'codex_thread', deviceOnline: true, busy: true, heldBy: { requestId: 'req_7', status: 'unknown' } }] } };
    if (req.method === 'GET' && req.path === '/v1/tasks/req_7') return { status: 200, body: { resume: { known: true, sameSession: same } } };
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'] }, roomsPath: join(mkdtempSync(join(tmpdir(), 'ieon-rc4b-')), 'rooms.json'), pollMs: 1, waitMs: 100 });
  const send = async (x) => { said.push(x); };
  const m = (text, id) => ({ platform: 'telegram', userId: '111', chatId: '-1', text, msgId: `tg--1-${id}` });
  await bridge.handle(m('/use 1', 1), send);
  await bridge.handle(m('/status', 2), send);
  assert.match(said.at(-1), /그때 보낸 세션과 지금 세션이 같음 — 원래 앱에서 확인 후 \/review done/);
  same = false;
  await bridge.handle(m('/status', 3), send);
  assert.match(said.at(-1), /⚠ 그때 보낸 세션과 지금 연결된 세션이 다름/);
});

// 2026-11-20 실측: 처리하던 연결부가 죽었다가 다시 켜져도 질문이 계속 '처리 중'(대화 막힘)으로 남던 것 — 다시 켜졌다고 알리면 결과 불명(확인 카드)으로
test('연결부가 다시 켜지면 그 PC가 처리 중이던 질문은 결과 불명(connector_restarted)으로, 대기 중 질문은 그대로', async (t) => {
  const s = await setup(t);
  const id = (await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: 'k-rc4-restart1' })).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' }); // 연결부가 가져감(dispatching)
  assert.equal((await s.call('/v1/requests/' + id)).body.status, 'dispatching');
  const r = await s.call('/v1/device/restarted', { token: 'dev', method: 'POST', body: {} });
  assert.deepEqual([r.status, r.body.unknown], [200, 1]);
  const b = (await s.call('/v1/requests/' + id)).body;
  assert.deepEqual([b.status, b.errorCode], ['unknown', 'connector_restarted']);
  assert.ok((await s.call('/v1/conversations/c1/cards')).body.cards.some((c) => c.kind === 'held'), '확인 카드');
  assert.equal((await s.call('/v1/device/restarted', { token: 'dev', method: 'POST', body: {} })).body.unknown, 0, '두 번째는 바꿀 것 없음');
});

// 2026-11-20 실측: 연결부 경로는 끝날 때까지 "보내는 중"(dispatching)으로만 보였다 — 엔진 실행을 시작하면 처리 중(running)
test('연결부가 엔진 실행 시작을 알리면 처리 중, 다른 PC·없는 질문은 404, 처리 중에도 결과·중지는 그대로', async (t) => {
  const s = await setup(t);
  const id = (await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: 'k-rc4-running1' })).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' });
  assert.equal((await s.call(`/v1/device/jobs/${id}/running`, { token: 'dev', method: 'POST', body: {} })).status, 204);
  assert.equal((await s.call('/v1/requests/' + id)).body.status, 'running');
  assert.equal((await s.call('/v1/device/jobs/req_none/running', { token: 'dev', method: 'POST', body: {} })).status, 404);
  assert.equal((await s.call(`/v1/requests/${id}/stop`, { method: 'POST' })).status, 202, '처리 중에도 중지 가능');
  await s.call(`/v1/device/jobs/${id}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: '답' } });
  assert.equal((await s.call('/v1/requests/' + id)).body.status, 'completed');
});
