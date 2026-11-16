// RC1(REQUEST_CONTROL 5절): 승인 결정과 실제 실행 결과를 한 장의 승인에 잇는다.
// 거부 → 실행 0건, 한 번 허용 → 실행 1건, 같은 카드 두 번·두 화면 동시 응답 → 한 번만, 주인 아닌 사람·다른 PC·만료 차단,
// 허용 뒤 실패 → 두 화면 같은 실패, 엔진 항목이 다르면 받지 않음, 결과 없이 차례가 끝나면 결과 불명, 번호는 서버가 매겨 다시 켜도 같음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { approver, approvalReporter } from '../../src/pilot/connector.mjs';
import { appServerTurn, itemOutcome, matchAllowed } from '../../src/pilot/adapters/codex-thread.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';
const T2 = '01a18790-0000-7000-8000-000000000002';

async function setup(t, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc1-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const mk = () => createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }, { tokenSha256: sha('dev2'), hostId: 'h_other' }],
    bindings: [
      { conversationId: 'c1', label: '시험', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c2', label: '둘째', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T2 },
    ], ...extra });
  let app = mk();
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const dev = (path, { method = 'GET', body, token = 'dev' } = {}) => call(path, { method, body, token });
  const start = async (conv = 'c1') => {
    await dev('/v1/device/jobs');
    const q = await call(`/v1/conversations/${conv}/requests`, { method: 'POST', body: { question: '일해 줘' }, key: `k-rc1-${Math.random().toString(36).slice(2, 10)}` });
    const job = (await dev('/v1/device/jobs')).body;
    assert.equal(job.requestId, q.body.requestId);
    return q.body.requestId;
  };
  const ask = async (requestId, over = {}) => (await dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'npm test', cwd: 'C:/w', itemId: 'item-1', ...over } })).body;
  const cardsOf = async (conv = 'c1', token = 'web') => (await call(`/v1/conversations/${conv}/cards`, { token })).body.cards.filter((c) => c.kind.startsWith('approval'));
  const reopen = async () => { await app.close(); app = mk(); base = `http://127.0.0.1:${await app.listen(0)}`; closers.push(() => app.close()); };
  const devHeaders = { authorization: 'Bearer dev', 'content-type': 'application/json' };
  return { call, dev, start, ask, cardsOf, reopen, devHeaders, get base() { return base; } };
}

test('거부: 엔진에 거부가 전달되고 실행 결과는 받지 않는다(실행 0건)', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  let allowedCalls = 0;
  const waiting = approver({ baseUrl: s.base, headers: s.devHeaders, requestId, pollMs: 20, maxMs: 3000 })({ kind: 'command', summary: 'npm test', cwd: 'C:/w', itemId: 'item-1', onAllowed: () => { allowedCalls += 1; } });
  let card; for (let i = 0; i < 100 && !card; i++) { await new Promise((r) => setTimeout(r, 10)); [card] = await s.cardsOf(); }
  assert.equal(card.kind, 'approval');
  assert.deepEqual([card.n, card.state, card.agent, card.engine], [1, 'pending', '시험', 'codex_thread'], '카드에 번호·상태·누가(AI 직원 또는 대화 이름)·엔진');
  assert.equal((await s.call('/v1/approvals/' + card.approvalId, { method: 'POST', body: { decision: 'deny' } })).status, 200);
  assert.equal(await waiting, 'decline');
  assert.equal(allowedCalls, 0, '거부면 실행 결과를 이을 준비도 하지 않는다');
  const after = (await s.cardsOf())[0];
  assert.deepEqual([after.kind, after.state], ['approval_result', 'denied'], '결정 뒤에는 버튼 없는 종류로 바뀐다');
  // 거부된 승인에는 실행 결과를 받지 않는다(엔진이 잘못 실행했다고 보고해도)
  assert.deepEqual(await s.dev(`/v1/device/approvals/${card.approvalId}/result`, { method: 'POST', body: { outcome: 'completed', itemId: 'item-1' } }), { status: 409, body: { error: 'not_allowed' } });
  assert.equal((await s.cardsOf())[0].state, 'denied');
});

test('한 번 허용: 승인됨 → 실행 중 → 완료가 같은 승인에 남고, 결과는 한 번만 받는다(실행 1건)', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  const { approvalId, n } = await s.ask(requestId);
  assert.equal(n, 1);
  assert.equal((await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' } })).status, 200);
  assert.equal((await s.cardsOf())[0].state, 'approved', '허용했지만 연결부가 아직 읽어 가지 않음');
  assert.equal((await s.dev('/v1/device/approvals/' + approvalId)).body.status, 'allowed');
  assert.equal((await s.cardsOf())[0].state, 'running', '연결부가 허용을 읽어 간 뒤');
  const report = approvalReporter({ baseUrl: s.base, headers: s.devHeaders });
  assert.equal(await report(approvalId, { outcome: 'completed', exitCode: 0, itemId: 'item-1' }), true);
  const done = (await s.cardsOf())[0];
  assert.deepEqual([done.kind, done.state, done.exitCode, done.requestId], ['approval_result', 'completed', 0, requestId]);
  // 같은 결과를 또 보내도(재전송) 바뀌지 않는다
  assert.equal(await report(approvalId, { outcome: 'failed', exitCode: 1, itemId: 'item-1' }), false);
  assert.equal((await s.cardsOf())[0].state, 'completed');
  const rec = (await s.call('/v1/conversations/c1/approvals')).body.approvals[0];
  assert.deepEqual([rec.status, rec.execStatus, rec.decidedBy, rec.requestId, typeof rec.decidedAt, typeof rec.execAt], ['allowed', 'completed', 'u_sinsan', requestId, 'string', 'string'], '요청 ID·결정한 사람·결정 시각·실행 결과가 한 기록에');
});

test('같은 카드를 두 번 누르거나 두 화면이 동시에 답해도 결정은 하나다', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  const { approvalId } = await s.ask(requestId);
  const post = (decision, token) => s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision }, token });
  const results = await Promise.all([post('allow', 'web'), post('deny', 'msg'), post('allow', 'web'), post('allow', 'msg')]);
  assert.equal(results.filter((r) => r.status === 200).length, 1, '하나만 적용');
  assert.equal(results.filter((r) => r.status === 409 && r.body.error === 'approval_closed').length, 3);
  const winner = results.find((r) => r.status === 200).body.status;
  assert.equal((await s.call('/v1/conversations/c1/approvals')).body.approvals[0].status, winner);
  // 웹과 메신저(같은 주인)가 같은 상태를 본다
  assert.deepEqual((await s.cardsOf('c1', 'web')).map((c) => [c.approvalId, c.state]), (await s.cardsOf('c1', 'msg')).map((c) => [c.approvalId, c.state]));
});

test('주인 아닌 사람·다른 PC·만료된 카드는 막는다', async (t) => {
  const s = await setup(t, { approvalTtlMs: 60 });
  const requestId = await s.start();
  const { approvalId } = await s.ask(requestId);
  assert.equal((await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' }, token: 'other' })).status, 404, '다른 사람');
  assert.equal((await s.call('/v1/conversations/c1/cards', { token: 'other' })).status, 404);
  assert.equal((await s.dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: { outcome: 'completed' }, token: 'dev2' })).status, 404, '다른 PC의 연결부');
  await new Promise((r) => setTimeout(r, 90));
  const late = await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' } });
  assert.deepEqual([late.status, late.body.error, late.body.status], [409, 'approval_closed', 'expired'], '시간이 지난 카드');
  assert.equal((await s.dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: { outcome: 'completed' } })).body.error, 'not_allowed');
});

test('허용 뒤 실행이 실패하면 웹과 메신저가 같은 실패를 본다', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  const { approvalId } = await s.ask(requestId);
  await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' }, token: 'msg' });
  await s.dev('/v1/device/approvals/' + approvalId);
  assert.equal((await s.dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: { outcome: 'failed', exitCode: 2, itemId: 'item-1' } })).status, 200);
  for (const token of ['web', 'msg']) {
    const c = (await s.cardsOf('c1', token))[0];
    assert.deepEqual([c.state, c.exitCode], ['failed', 2], token);
  }
  assert.equal((await s.dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: { outcome: 'weird' } })).body.error, 'bad_outcome');
});

test('승인한 것과 다른 엔진 항목의 결과는 받지 않는다', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  const { approvalId } = await s.ask(requestId, { itemId: 'item-A' });
  await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' } });
  await s.dev('/v1/device/approvals/' + approvalId);
  assert.deepEqual(await s.dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: { outcome: 'completed', itemId: 'item-B' } }), { status: 409, body: { error: 'item_mismatch' } });
  assert.equal((await s.cardsOf())[0].state, 'running', '다른 항목의 결과로는 완료가 되지 않는다');
});

test('결과 없이 차례가 끝나면 허용한 것은 결과 불명, 답하지 않은 것은 거부', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  const a = await s.ask(requestId, { itemId: 'item-1' });
  const b = await s.ask(requestId, { itemId: 'item-2', kind: 'file', summary: 'a.txt 만들기' });
  assert.deepEqual([a.n, b.n], [1, 2]);
  await s.call('/v1/approvals/' + a.approvalId, { method: 'POST', body: { decision: 'allow' } });
  assert.equal((await s.dev(`/v1/device/jobs/${requestId}/result`, { method: 'POST', body: { status: 'completed', answer: '끝' } })).status, 200);
  const states = Object.fromEntries((await s.call('/v1/conversations/c1/approvals')).body.approvals.map((x) => [x.n, x.state]));
  assert.deepEqual(states, { 1: 'unknown', 2: 'turn_ended' }, '완료로 짐작하지 않는다');
  assert.equal((await s.dev(`/v1/device/approvals/${a.approvalId}/result`, { method: 'POST', body: { outcome: 'completed', itemId: 'item-1' } })).body.error, 'result_closed', '차례가 끝난 뒤 늦게 온 결과는 받지 않는다');
});

test('승인 번호는 대화마다 따로 매기고 서버를 다시 켜도 같다', async (t) => {
  const s = await setup(t);
  const r1 = await s.start('c1');
  const a1 = await s.ask(r1); const a2 = await s.ask(r1, { itemId: 'item-2' });
  const r2 = await s.start('c2');
  const b1 = await s.ask(r2);
  assert.deepEqual([a1.n, a2.n, b1.n], [1, 2, 1]);
  await s.reopen();
  const list = (await s.call('/v1/conversations/c1/approvals')).body.approvals;
  assert.deepEqual(list.map((x) => [x.n, x.approvalId]).sort(), [[1, a1.approvalId], [2, a2.approvalId]]);
});

test('메신저: 다시 켠 뒤에도 /허용 n 이 같은 승인을 가리킨다(번호를 프로그램이 기억하지 않는다)', async (t) => {
  const s = await setup(t);
  const requestId = await s.start();
  await s.ask(requestId); const second = await s.ask(requestId, { itemId: 'item-2' });
  const api = ({ method, path, body }) => s.call(path, { method, body, token: 'msg' });
  const mkBridge = () => createBridge({ api, roomStore: { rooms: { 'telegram:default:77': 'c1' }, save() {} }, allowedUsers: { telegram: ['5'] } });
  const sent = [];
  const say = (bridge, text, userId = 5) => bridge.handle({ platform: 'telegram', userId, chatId: 77, text, isGroup: false, called: true }, async (x) => { sent.push(x); });
  await say(mkBridge(), '/허용 2'); // 새로 만든 브리지 = 메신저를 다시 켠 것
  assert.match(sent.at(-1), /승인 요청 2: 허용함/);
  const list = (await s.call('/v1/conversations/c1/approvals')).body.approvals;
  assert.equal(list.find((x) => x.n === 2).status, 'allowed');
  assert.equal(list.find((x) => x.n === 2).approvalId, second.approvalId);
  assert.equal(list.find((x) => x.n === 1).status, 'pending', '다른 번호는 그대로');
  await say(mkBridge(), '/허용 2');
  assert.match(sent.at(-1), /이미 끝났어요/);
  await say(mkBridge(), '/거부 9');
  assert.match(sent.at(-1), /9번이 이 대화방에 없어요/);
});

// --- 엔진 쪽: 허용한 항목이 끝나면 그 승인에만 결과를 잇는다 ---
function fakeAppServer({ items }) {
  let onMsg = () => {}; const sent = [];
  const emit = (m) => setImmediate(() => onMsg(m));
  const tr = {
    onMessage(fn) { onMsg = fn; }, close() {},
    send(m) {
      sent.push(m);
      if (m.method === 'initialize' || m.method === 'thread/resume') return emit({ id: m.id, result: {} });
      if (m.method === 'turn/start') {
        emit({ id: m.id, result: { turn: { id: 'turn-1' } } });
        return emit({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: T1, turnId: 'turn-1', itemId: 'item-1', command: 'npm test', cwd: 'C:/w' } });
      }
      if (m.id === 900 && m.result) { // 승인 답을 받은 뒤 엔진이 항목들을 끝낸다
        for (const item of items) emit({ method: 'item/completed', params: { threadId: T1, turnId: 'turn-1', item } });
        emit({ method: 'item/completed', params: { threadId: T1, turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1', text: '했어요' } } });
        emit({ method: 'turn/completed', params: { threadId: T1, turn: { id: 'turn-1', status: 'completed' } } });
      }
    },
  };
  return { tr, sent };
}
const turn = (items, decision) => {
  const reports = []; const fake = fakeAppServer({ items });
  const approve = async ({ onAllowed }) => { if (decision === 'accept') onAllowed('apv_x'); return decision; };
  return appServerTurn(fake.tr, { threadId: T1, question: '해 줘', cwd: 'C:/w', approve, approvalResult: async (id, r) => { reports.push([id, r.outcome, r.exitCode, r.itemId]); }, timeoutMs: 2000 })
    .then((r) => ({ r, reports, answer: fake.sent.find((m) => m.id === 900).result.decision }));
};

test('엔진: 허용한 항목이 끝나면 결과를 한 번 보고하고, 승인 없이 지나간 다른 항목은 잇지 않는다', async () => {
  const ok = await turn([
    { type: 'commandExecution', id: 'item-9', status: 'completed', exitCode: 0 }, // 승인 없이 실행된 다른 명령(읽기 전용 등)
    { type: 'commandExecution', id: 'item-1', status: 'completed', exitCode: 0 },
    { type: 'commandExecution', id: 'item-1', status: 'completed', exitCode: 0 }, // 같은 알림이 또 와도
  ], 'accept');
  assert.equal(ok.answer, 'accept');
  assert.deepEqual(ok.reports, [['apv_x', 'completed', 0, 'item-1']]);
  const bad = await turn([{ type: 'commandExecution', id: 'item-1', status: 'completed', exitCode: 3 }], 'accept');
  assert.deepEqual(bad.reports, [['apv_x', 'failed', 3, 'item-1']], '종료 코드가 0이 아니면 실패');
  const failed = await turn([{ type: 'commandExecution', id: 'item-1', status: 'failed', exitCode: null }], 'accept');
  assert.deepEqual(failed.reports, [['apv_x', 'failed', null, 'item-1']]);
});

test('엔진: 거부했으면 어떤 결과도 보고하지 않고, 허용했는데 항목이 끝나지 않으면 보고하지 않는다(서버가 결과 불명으로 둠)', async () => {
  const denied = await turn([{ type: 'commandExecution', id: 'item-1', status: 'declined', exitCode: null }], 'decline');
  assert.equal(denied.answer, 'decline');
  assert.deepEqual(denied.reports, []);
  const silent = await turn([{ type: 'commandExecution', id: 'item-1', status: 'inProgress', exitCode: null }], 'accept');
  assert.deepEqual(silent.reports, []);
});

test('항목 판정: 종류·상태·ID가 맞을 때만', () => {
  assert.equal(itemOutcome({ type: 'agentMessage', id: 'x', status: 'completed' }), null);
  assert.equal(itemOutcome({ type: 'fileChange', status: 'completed' }), null, 'ID 없음');
  assert.deepEqual(itemOutcome({ type: 'fileChange', id: 'f1', status: 'completed' }), { kind: 'file', itemId: 'f1', outcome: 'completed', exitCode: null });
  const allowed = [{ approvalId: 'a', itemId: 'f1', kind: 'command' }, { approvalId: 'b', itemId: null, kind: 'file' }, { approvalId: 'c', itemId: 'f1', kind: 'file' }];
  assert.equal(matchAllowed(allowed, { kind: 'file', itemId: 'f1' }).approvalId, 'c', '종류가 다르거나 ID가 없는 승인에는 잇지 않는다');
  assert.equal(matchAllowed(allowed, { kind: 'file', itemId: 'zz' }), null);
});

test('메신저: 승인 요청을 번호와 함께 알리고, 허용한 뒤의 실행 결과도 같은 대화방에 한 번만 알린다', async () => {
  const conv = { conversationId: 'c1', label: '시험', engine: 'codex_thread', deviceOnline: true, workMode: true };
  const approval = (kind, state) => ({ kind, approvalId: 'apv_1', requestId: 'r1', approvalKind: 'command', summary: 'npm test', cwd: 'C:/w', n: 4, state, exitCode: state === 'failed' ? 1 : null });
  // 요청 상태와 카드가 폴링마다 한 걸음씩 나아간다: 승인 대기 → 실행 중 → 실패(차례는 완료)
  const steps = [
    { status: 'running', cards: [approval('approval', 'pending')] },
    { status: 'running', cards: [approval('approval', 'pending')] }, // 같은 요청을 또 알리지 않는다
    { status: 'running', cards: [approval('approval_result', 'running')] },
    { status: 'running', cards: [approval('approval_result', 'failed'), { ...approval('approval_result', 'completed'), approvalId: 'apv_old', requestId: 'r0', n: 3 }] }, // 이전 요청의 카드는 알리지 않는다
    { status: 'completed', answer: '실패했어요', cards: [approval('approval_result', 'failed')] },
  ];
  let i = 0;
  const api = async ({ method, path }) => {
    if (method === 'GET' && path === '/v1/conversations') return { status: 200, body: { conversations: [conv] } };
    if (method === 'POST' && path === '/v1/conversations/c1/requests') return { status: 202, body: { requestId: 'r1' } };
    if (path === '/v1/requests/r1') { const s = steps[Math.min(i, steps.length - 1)]; return { status: 200, body: { status: s.status, answer: s.answer ?? null } }; }
    if (path === '/v1/conversations/c1/cards') { const s = steps[Math.min(i, steps.length - 1)]; i += 1; return { status: 200, body: { cards: s.cards } }; }
    return { status: 404, body: { error: 'not_found' } };
  };
  const bridge = createBridge({ api, roomStore: { rooms: { 'telegram:default:77': 'c1' }, save() {} }, allowedUsers: { telegram: ['5'] }, pollMs: 5, waitMs: 3000 });
  const sent = [];
  await bridge.handle({ platform: 'telegram', userId: 5, chatId: 77, text: '테스트 돌려 줘', isGroup: false, called: true }, async (x) => { sent.push(x); });
  assert.equal(sent.filter((x) => /승인 요청 4: 명령 실행 — npm test/.test(x)).length, 1, '승인 요청은 한 번만');
  assert.match(sent.find((x) => /승인 요청 4: 명령 실행/.test(x)), /\/허용 4 {3}거부: \/거부 4/);
  assert.equal(sent.filter((x) => x === '[시험] 승인 요청 4: 실행 실패(종료 코드 1)').length, 1, '실행 결과도 한 번만');
  assert.ok(!sent.some((x) => /승인 요청 3/.test(x)), '다른 요청의 결과는 알리지 않는다');
  assert.equal(sent.at(-1), '실패했어요');
  assert.ok(sent.findIndex((x) => /실행 실패/.test(x)) < sent.length - 1, '결과 알림이 답보다 먼저');
});
