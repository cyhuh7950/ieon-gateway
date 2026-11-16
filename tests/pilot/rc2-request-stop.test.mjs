// RC2(REQUEST_CONTROL 4절): 그 요청만 멈추기. 대기 중 → 바로 취소, 실행 중 → 연결부가 엔진을 멈추고 확인한 뒤 중지됨,
// 확인하지 못하면 결과 불명, 이미 끝난 것은 그대로(먼저 확정된 쪽이 이긴다), 다른 대화의 요청은 그대로 진행. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { pollOnce, stopWatcher } from '../../src/pilot/connector.mjs';
import { StoppedError } from '../../src/pilot/contracts.mjs';
import { appServerTurn } from '../../src/pilot/adapters/codex-thread.mjs';
import { runCli, cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000011';
const T2 = '01a18790-0000-7000-8000-000000000012';

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc2-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }, { tokenSha256: sha('dev2'), hostId: 'h_other' }],
    bindings: [
      { conversationId: 'c1', label: '하나', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c2', label: '둘', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T2 },
      { conversationId: 'c3', label: '클로드 창', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'ch-1' },
    ] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const dev = (path, opt = {}) => call(path, { token: 'dev', ...opt });
  const submit = async (conv = 'c1') => {
    await dev('/v1/device/jobs', { token: 'dev' }).catch(() => {}); // 온라인 표시(대기 중인 것이 있으면 가져가므로 처음에만)
    const q = await call(`/v1/conversations/${conv}/requests`, { method: 'POST', body: { question: '일해 줘' }, key: `k-rc2-${Math.random().toString(36).slice(2, 10)}` });
    assert.equal(q.status, 202, JSON.stringify(q.body));
    return q.body.requestId;
  };
  const status = async (id) => (await call('/v1/requests/' + id)).body;
  return { base, call, dev, submit, status, devHeaders: { authorization: 'Bearer dev', 'content-type': 'application/json' } };
}

test('대기 중이면 바로 취소 — 연결부에 넘어가지 않고, 세션 잠금이 풀려 다음 질문을 받는다', async (t) => {
  const s = await setup(t);
  const id = await s.submit('c1');
  const r = await s.call(`/v1/requests/${id}/stop`, { method: 'POST' });
  assert.deepEqual([r.status, r.body.status], [200, 'cancelled']);
  assert.deepEqual([(await s.status(id)).status, (await s.status(id)).errorCode], ['cancelled', 'stopped_by_user']);
  assert.equal((await s.dev('/v1/device/jobs')).status, 204, '취소한 질문은 연결부가 가져가지 않는다');
  const again = await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '다음' }, key: 'k-rc2-next-0001' });
  assert.equal(again.status, 202, '잠금이 풀려 같은 대화에 새 질문을 받는다');
  // 두 번 눌러도 상태는 그대로(이미 중지됨)
  assert.deepEqual((await s.call(`/v1/requests/${id}/stop`, { method: 'POST' })).body, { error: 'not_running', status: 'cancelled' });
});

test('실행 중이면 멈추는 중 → 그 PC 연결부만 멈춤을 읽고, 멈춘 것을 확인해 보고하면 중지됨', async (t) => {
  const s = await setup(t);
  const id = await s.submit('c1');
  assert.equal((await s.dev('/v1/device/jobs')).body.requestId, id);
  assert.deepEqual((await s.dev(`/v1/device/jobs/${id}/control`)).body, { stop: false });
  assert.equal((await s.call(`/v1/requests/${id}/stop`, { method: 'POST', token: 'other' })).status, 404, '그 대화 주인이 아니면 멈출 수 없다');
  const r = await s.call(`/v1/requests/${id}/stop`, { method: 'POST' });
  assert.deepEqual([r.status, r.body.status], [202, 'stopping']);
  const v = await s.status(id);
  assert.deepEqual([v.status, v.stopRequested], ['dispatching', true], '엔진이 멈추기 전에는 중지됨이라고 하지 않는다');
  assert.deepEqual((await s.dev(`/v1/device/jobs/${id}/control`)).body, { stop: true });
  assert.equal((await s.dev(`/v1/device/jobs/${id}/control`, { token: 'dev2' })).status, 404, '다른 PC는 읽지 못한다');
  assert.equal((await s.dev(`/v1/device/jobs/${id}/result`, { method: 'POST', body: { status: 'cancelled', errorCode: 'stopped_by_user' } })).status, 200);
  assert.deepEqual([(await s.status(id)).status, (await s.status(id)).errorCode], ['cancelled', 'stopped_by_user']);
  assert.equal((await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '다음' }, key: 'k-rc2-next-0002' })).status, 202, '중지가 확인되면 잠금이 풀린다');
});

test('멈추라고 하지 않았는데 중지됐다고 오면 결과 불명, 멈춘 것을 확인하지 못해도 결과 불명(자동 재전송 없음)', async (t) => {
  const s = await setup(t);
  const a = await s.submit('c1');
  await s.dev('/v1/device/jobs');
  await s.dev(`/v1/device/jobs/${a}/result`, { method: 'POST', body: { status: 'cancelled' } });
  assert.deepEqual([(await s.status(a)).status, (await s.status(a)).errorCode], ['unknown', 'unexpected_stop']);
  const b = await s.submit('c2');
  await s.dev('/v1/device/jobs');
  await s.call(`/v1/requests/${b}/stop`, { method: 'POST' });
  await s.dev(`/v1/device/jobs/${b}/result`, { method: 'POST', body: { status: 'unknown', errorCode: 'stop_unconfirmed' } });
  assert.deepEqual([(await s.status(b)).status, (await s.status(b)).errorCode], ['unknown', 'stop_unconfirmed']);
  assert.equal((await s.call('/v1/conversations/c2/requests', { method: 'POST', body: { question: '다음' }, key: 'k-rc2-next-0003' })).status, 409, '결과 불명이면 잠금 유지');
});

test('먼저 확정된 쪽이 이긴다 — 멈춤 요청 뒤라도 엔진이 끝까지 답했으면 완료, 이미 끝난 질문은 멈출 수 없다', async (t) => {
  const s = await setup(t);
  const id = await s.submit('c1');
  await s.dev('/v1/device/jobs');
  await s.call(`/v1/requests/${id}/stop`, { method: 'POST' });
  await s.dev(`/v1/device/jobs/${id}/result`, { method: 'POST', body: { status: 'completed', answer: '다 했어요' } });
  const v = await s.status(id);
  assert.deepEqual([v.status, v.answer], ['completed', '다 했어요']);
  assert.deepEqual((await s.call(`/v1/requests/${id}/stop`, { method: 'POST' })).body, { error: 'not_running', status: 'completed' });
  assert.equal((await s.dev(`/v1/device/jobs/${id}/control`)).body.stop, false, '끝난 질문에는 멈춤 신호를 주지 않는다');
});

test('사람이 띄운 Claude 창은 실행 중에는 멈출 수 없다고 알린다(대기 중 취소는 됨)', async (t) => {
  const s = await setup(t);
  const id = await s.submit('c3');
  await s.dev('/v1/device/jobs');
  assert.deepEqual((await s.call(`/v1/requests/${id}/stop`, { method: 'POST' })).body, { error: 'stop_unsupported', status: 'dispatching' });
  assert.equal((await s.status(id)).stopRequested, false);
});

test('멈추면 기다리던 승인 카드는 더 묻지 않는다(차례 끝으로 거부)', async (t) => {
  const s = await setup(t);
  const id = await s.submit('c1');
  await s.dev('/v1/device/jobs');
  const { approvalId } = (await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId: id, kind: 'command', summary: 'npm test', cwd: 'C:/w', itemId: 'i1' } })).body;
  await s.call(`/v1/requests/${id}/stop`, { method: 'POST' });
  assert.equal((await s.dev('/v1/device/approvals/' + approvalId)).body.status, 'turn_ended', '연결부는 거부로 받아 엔진에 전달');
  assert.equal((await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' } })).status, 409, '멈춘 뒤에는 허용할 수 없다');
});

test('A만 멈춰도 다른 대화의 B는 그대로 진행한다(연결부 끝까지: 실제 pollOnce + 가짜 엔진)', async (t) => {
  const s = await setup(t);
  const a = await s.submit('c1');
  const b = await s.call('/v1/conversations/c2/requests', { method: 'POST', body: { question: 'B 일' }, key: 'k-rc2-b-000001' }).then((r) => r.body.requestId);
  const seen = [];
  const engine = { codex_thread: { run: async ({ requestId }, { signal }) => {
    seen.push(requestId);
    if (requestId !== a) return { receipt: 'r-b', answer: 'B 답' };
    // A: 멈춤 신호가 올 때까지 일하다가, 신호가 오면 멈춘 것을 확인하고 알린다
    await new Promise((ok) => (signal.aborted ? ok() : signal.addEventListener('abort', ok, { once: true })));
    throw new StoppedError();
  } } };
  const receipts = { has: () => false, add: () => {} };
  const runA = pollOnce({ baseUrl: s.base, deviceToken: 'dev', adapters: engine, receipts, stopPollMs: 20 });
  for (let i = 0; i < 100 && (await s.status(a)).status === 'queued'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal((await s.call(`/v1/requests/${a}/stop`, { method: 'POST' })).status, 202);
  await runA;
  assert.equal((await s.status(a)).status, 'cancelled');
  assert.equal((await s.status(b)).status, 'queued', 'B는 손대지 않음');
  await pollOnce({ baseUrl: s.base, deviceToken: 'dev', adapters: engine, receipts, stopPollMs: 20 });
  assert.deepEqual([(await s.status(b)).status, (await s.status(b)).answer], ['completed', 'B 답']);
  assert.deepEqual(seen, [a, b]);
});

test('연결부: 멈춤 신호를 보냈는데 엔진이 멈춘 것을 확인하지 못하면 결과 불명, 신호를 무시하고 끝까지 답하면 완료', async (t) => {
  const s = await setup(t);
  const receipts = { has: () => false, add: () => {} };
  const a = await s.submit('c1');
  const vague = { codex_thread: { run: async (_, { signal }) => { await new Promise((ok) => signal.addEventListener('abort', ok, { once: true })); throw new Error('끊김'); } } };
  const p = pollOnce({ baseUrl: s.base, deviceToken: 'dev', adapters: vague, receipts, stopPollMs: 20 });
  for (let i = 0; i < 100 && (await s.status(a)).status === 'queued'; i++) await new Promise((r) => setTimeout(r, 10));
  await s.call(`/v1/requests/${a}/stop`, { method: 'POST' });
  await p;
  assert.deepEqual([(await s.status(a)).status, (await s.status(a)).errorCode], ['unknown', 'stop_unconfirmed']);
  const b = await s.call('/v1/conversations/c2/requests', { method: 'POST', body: { question: 'x' }, key: 'k-rc2-c-000001' }).then((r) => r.body.requestId);
  const stubborn = { codex_thread: { run: async (_, { signal }) => { await new Promise((ok) => signal.addEventListener('abort', ok, { once: true })); return { receipt: 'r', answer: '끝까지 함' }; } } };
  const q = pollOnce({ baseUrl: s.base, deviceToken: 'dev', adapters: stubborn, receipts, stopPollMs: 20 });
  for (let i = 0; i < 100 && (await s.status(b)).status === 'queued'; i++) await new Promise((r) => setTimeout(r, 10));
  await s.call(`/v1/requests/${b}/stop`, { method: 'POST' });
  await q;
  assert.deepEqual([(await s.status(b)).status, (await s.status(b)).answer], ['completed', '끝까지 함']);
});

test('멈춤 감시는 실행이 끝나면 더 묻지 않는다', async () => {
  let asked = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { asked += 1; return { status: 200, json: async () => ({ stop: false }) }; };
  try {
    const w = stopWatcher({ baseUrl: 'http://x', headers: {}, requestId: 'r', pollMs: 10 });
    await new Promise((r) => setTimeout(r, 45));
    w.close(); const n = asked;
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(n >= 2 && asked === n, `닫은 뒤 묻지 않음(${n}→${asked})`);
  } finally { globalThis.fetch = realFetch; }
});

function fakeTransport({ finishWith }) {
  const sent = []; let handler = () => {};
  const tr = {
    sent,
    send(m) {
      sent.push(m);
      const reply = (result) => queueMicrotask(() => handler({ jsonrpc: '2.0', id: m.id, result }));
      if (m.method === 'initialize' || m.method === 'thread/resume') reply({});
      if (m.method === 'turn/start') reply({ turn: { id: 'turn-1' } });
      if (m.method === 'turn/interrupt') { reply({}); queueMicrotask(() => handler({ method: 'turn/completed', params: { threadId: 'th', turnId: 'turn-1', turn: { status: finishWith } } })); }
    },
    onMessage(fn) { handler = fn; }, close() {},
  };
  return tr;
}

test('Codex 작업 모드: 멈춤 → turn/interrupt, 엔진이 interrupted로 끝내야 중지됨', async () => {
  const c = new AbortController();
  const tr = fakeTransport({ finishWith: 'interrupted' });
  const p = appServerTurn(tr, { threadId: 'th', question: 'q', cwd: 'C:/w', approve: null, signal: c.signal });
  await new Promise((r) => setTimeout(r, 10));
  c.abort();
  await assert.rejects(p, (e) => e instanceof StoppedError);
  assert.deepEqual(tr.sent.find((m) => m.method === 'turn/interrupt')?.params, { threadId: 'th', turnId: 'turn-1' });
  // 끊으라고 했는데 completed로 끝나면 완료(먼저 확정된 쪽)
  const c2 = new AbortController();
  const tr2 = fakeTransport({ finishWith: 'completed' });
  const p2 = appServerTurn(tr2, { threadId: 'th', question: 'q', cwd: 'C:/w', approve: null, signal: c2.signal });
  await new Promise((r) => setTimeout(r, 10));
  c2.abort();
  assert.equal((await p2).receipt, 'codex:th:turn-1');
});

test('한 번 실행 CLI(Grok·Antigravity): 멈춤 → 프로세스를 끝내고 닫힌 것을 확인한 뒤 중지됨', async () => {
  const c = new AbortController();
  const p = runCli(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { signal: c.signal, timeoutMs: 30000 });
  setTimeout(() => c.abort(), 50);
  const r = await p;
  assert.equal(r.stopped, true);
  const ad = cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: ['sess-0001'], bin: 'x', run: async (_b, _a, o) => ({ code: null, stdout: '', stderr: '', stopped: o.signal?.aborted === true }), probe: () => 'NO_LOCK_FILE' });
  const c2 = new AbortController(); c2.abort();
  await assert.rejects(ad.run({ sessionRef: 'sess-0001', question: 'q' }, { signal: c2.signal }), (e) => e instanceof StoppedError);
});

test('메신저 /stop: 그 대화방의 마지막 질문만, 물어본 사람이나 주인만, 결과를 알린다', async () => {
  const calls = []; let reqStatus = 'running'; let stopReply = { status: 202, body: { status: 'stopping' } };
  const api = async (req) => {
    calls.push(req);
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [{ conversationId: 'c1', label: '하나', engine: 'codex_thread', deviceOnline: true, busy: false }] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_1' } };
    if (req.method === 'POST' && req.path === '/v1/requests/req_1/stop') { reqStatus = 'cancelled'; return stopReply; }
    if (req.method === 'GET' && req.path === '/v1/requests/req_1') return { status: 200, body: { status: reqStatus } };
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111', '222', '333'] }, isOwner: (m) => String(m.userId) === '111', roomsPath: join(mkdtempSync(join(tmpdir(), 'ieon-rc2b-')), 'rooms.json'), pollMs: 5, waitMs: 2000 });
  const said = []; const send = async (x) => { said.push(x); };
  const m = (text, userId = '222', id = Math.random()) => ({ platform: 'telegram', userId, chatId: '-1', text, msgId: `tg--1-${id}` });
  await bridge.handle(m('/use 1', '111'), send);
  const asking = bridge.handle(m('오래 걸리는 일', '222'), send); // 222가 물어봄(허용된 사람, 주인은 111)
  await new Promise((r) => setTimeout(r, 20));
  await bridge.handle(m('/stop', '333'), send);
  assert.match(said.at(-1), /보낸 사람이나 주인만/);
  await bridge.handle(m('/stop', '222'), send);
  assert.match(said.at(-1), /멈추는 중/);
  await asking;
  assert.ok(said.some((x) => /중지됨 — 이 질문만 멈췄어요/.test(x)), '질문을 기다리던 쪽이 중지됨을 알림');
  assert.equal(calls.filter((c) => c.path.endsWith('/stop')).length, 1);
  stopReply = { status: 409, body: { error: 'not_running', status: 'completed' } };
  await bridge.handle(m('/중지', '111'), send);
  assert.match(said.at(-1), /멈출 수 없어요: 이미 끝남/, '주인도 멈출 수 있고, 끝난 질문은 그대로');
});
