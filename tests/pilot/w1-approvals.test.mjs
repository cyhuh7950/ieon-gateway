// W1(WORK_AND_VOICE A1·A3, WV1~WV3): 승인 카드 바탕 — 엔진이 묻는 승인(명령·파일)을 연결부가 올리고, 주인이 웹에서 허용·거부.
// 15분(시험은 짧게) 안에 답이 없으면 거부, 차례가 끝나면 거부, 이번 한 번만(항상 허용 없음), 180일 보관. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../src/pilot/server.mjs';
import { approver } from '../../src/pilot/connector.mjs';
import { answerServerRequest } from '../../src/pilot/adapters/codex-thread.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';

async function setup(t, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w1-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const mk = () => createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }, { tokenSha256: sha('dev2'), hostId: 'h_other' }],
    bindings: [{ conversationId: 'c1', label: '시험', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }], ...extra });
  let app = mk();
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const dev = (path, { method = 'GET', body, token = 'dev' } = {}) => call(path, { method, body, token });
  const start = async () => {
    await dev('/v1/device/jobs');
    const q = await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '일해 줘' }, key: `k-w1-${Math.random().toString(36).slice(2, 10)}` });
    const job = (await dev('/v1/device/jobs')).body;
    return { requestId: q.body.requestId, job };
  };
  const reopen = async () => { await app.close(); app = mk(); base = `http://127.0.0.1:${await app.listen(0)}`; closers.push(() => app.close()); };
  return { d, call, dev, start, reopen, get base() { return base; } };
}

test('승인 왕복: 연결부가 올림 → 카드(요약·작업 폴더) → 주인이 허용 → 연결부가 허용을 받음, 다시 누르면 이미 끝남', async (t) => {
  const s = await setup(t);
  const { requestId } = await s.start();
  const a = await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'dir', cwd: 'C:/w' } });
  assert.equal(a.status, 201);
  const cards = (await s.call('/v1/conversations/c1/cards')).body.cards;
  const card = cards.find((c) => c.kind === 'approval');
  assert.deepEqual([card.approvalKind, card.summary, card.cwd], ['command', 'dir', 'C:/w']);
  assert.ok(Date.parse(card.expiresAt) > Date.now());
  assert.equal((await s.call('/v1/conversations')).body.conversations[0].attention >= 1, true, '목록 개수에도');
  assert.equal((await s.dev(`/v1/device/approvals/${a.body.approvalId}`)).body.status, 'pending');
  assert.equal((await s.call(`/v1/approvals/${a.body.approvalId}`, { method: 'POST', body: { decision: 'allow' } })).body.status, 'allowed');
  assert.equal((await s.dev(`/v1/device/approvals/${a.body.approvalId}`)).body.status, 'allowed');
  const again = await s.call(`/v1/approvals/${a.body.approvalId}`, { method: 'POST', body: { decision: 'deny' } });
  assert.deepEqual([again.status, again.body.error, again.body.status], [409, 'approval_closed', 'allowed']);
  const rec = (await s.call('/v1/conversations/c1/approvals')).body.approvals[0];
  assert.deepEqual([rec.status, rec.decidedBy], ['allowed', 'u_sinsan'], '누가 허용했는지 기록');
  assert.equal((await s.call('/v1/conversations/c1/cards')).body.cards.some((c) => c.kind === 'approval'), false);
});

test('주인만: 다른 PC는 올리거나 읽지 못하고, 다른 사람은 허용하지 못함, 처리 중이 아닌 질문·모르는 종류는 거절', async (t) => {
  const s = await setup(t);
  const { requestId } = await s.start();
  assert.equal((await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'x' }, token: 'dev2' })).status, 404);
  assert.equal((await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'always', summary: 'x' } })).body.error, 'bad_kind');
  const a = (await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'file', summary: 'a.txt' } })).body;
  assert.equal((await s.dev(`/v1/device/approvals/${a.approvalId}`, { token: 'dev2' })).status, 404);
  assert.equal((await s.call(`/v1/approvals/${a.approvalId}`, { method: 'POST', body: { decision: 'allow' }, token: 'other' })).status, 404);
  // 메신저 봇은 W2부터 브리지가 주인인지 확인한 뒤 결정할 수 있음(w2-work-mode 시험), 외부 프로그램 키는 403
  assert.equal((await s.call(`/v1/approvals/${a.approvalId}`, { method: 'POST', body: { decision: 'always' } })).body.error, 'bad_decision', '항상 허용 없음');
  await s.dev(`/v1/device/jobs/${requestId}/result`, { method: 'POST', body: { status: 'completed', receipt: 'r', answer: 'ok' } });
  assert.equal((await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'x' } })).status, 404, '끝난 질문');
});

test('15분(시험은 짧게) 안에 답이 없으면 거부, 차례가 끝나면 남은 요청은 거부', async (t) => {
  const s = await setup(t, { approvalTtlMs: 150 });
  const { requestId } = await s.start();
  const a = (await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'x' } })).body;
  await new Promise((r) => setTimeout(r, 250));
  assert.equal((await s.dev(`/v1/device/approvals/${a.approvalId}`)).body.status, 'expired');
  assert.equal((await s.call(`/v1/approvals/${a.approvalId}`, { method: 'POST', body: { decision: 'allow' } })).body.status, 'expired');
  const b = (await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'file', summary: 'y' } })).body;
  await s.dev(`/v1/device/jobs/${requestId}/result`, { method: 'POST', body: { status: 'completed', receipt: 'r', answer: 'ok' } });
  assert.equal((await s.dev(`/v1/device/approvals/${b.approvalId}`)).body.status, 'turn_ended');
  // 연결부는 시간이 지나 거부된 것을 허용으로 착각하지 않는다
  const { requestId: r2 } = await s.start();
  assert.equal(await approver({ baseUrl: s.base, headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, requestId: r2, pollMs: 50, maxMs: 3000 })({ kind: 'command', summary: 'z' }), 'decline');
});

test('연결부: 허용이면 accept, 거부·시간 초과·서버가 거절하면 decline(모르면 거부)', async (t) => {
  const s = await setup(t);
  const { requestId } = await s.start();
  const headers = { authorization: 'Bearer dev', 'content-type': 'application/json' };
  const ask = approver({ baseUrl: s.base, headers, requestId, pollMs: 20, maxMs: 3000 });
  const p = ask({ kind: 'command', summary: 'dir', cwd: null });
  await new Promise((r) => setTimeout(r, 80));
  const id = (await s.call('/v1/conversations/c1/cards')).body.cards.find((c) => c.kind === 'approval').approvalId;
  await s.call(`/v1/approvals/${id}`, { method: 'POST', body: { decision: 'allow' } });
  assert.equal(await p, 'accept');
  const p2 = ask({ kind: 'file', summary: 'a.txt' });
  await new Promise((r) => setTimeout(r, 80));
  const id2 = (await s.call('/v1/conversations/c1/cards')).body.cards.find((c) => c.kind === 'approval').approvalId;
  await s.call(`/v1/approvals/${id2}`, { method: 'POST', body: { decision: 'deny' } });
  assert.equal(await p2, 'decline');
  assert.equal(await approver({ baseUrl: s.base, headers, requestId: 'req_none', pollMs: 20 })({ kind: 'command', summary: 'x' }), 'decline', '서버가 거절');
  assert.equal(await approver({ baseUrl: s.base, headers, requestId, pollMs: 20, maxMs: 100 })({ kind: 'command', summary: 'x' }), 'decline', '기다리다 시간 초과');
});

test('공유 서버의 승인 요청: 작업 모드가 아니면 바로 거부(멈추지 않음), 이 thread만 사람에게, 이번 한 번만, 모르는 요청은 지원 안 함', async () => {
  const msg = (method, params) => ({ id: 7, method, params: { threadId: T1, command: 'dir', cwd: 'C:/w', ...params } });
  assert.deepEqual(await answerServerRequest(msg('item/commandExecution/requestApproval'), T1, null), { jsonrpc: '2.0', id: 7, result: { decision: 'decline' } });
  const seen = [];
  const approve = async (r) => { seen.push(r); return 'accept'; };
  assert.equal((await answerServerRequest(msg('item/commandExecution/requestApproval'), T1, approve)).result.decision, 'accept');
  assert.deepEqual(seen[0], { kind: 'command', summary: 'dir', cwd: 'C:/w' });
  assert.equal((await answerServerRequest(msg('item/fileChange/requestApproval', { reason: 'a.txt 만들기' }), T1, approve)).result.decision, 'accept');
  assert.equal(seen[1].kind, 'file');
  assert.equal((await answerServerRequest(msg('item/commandExecution/requestApproval', { threadId: 'other' }), T1, approve)).result.decision, 'decline', '다른 thread');
  assert.equal((await answerServerRequest(msg('item/tool/requestUserInput'), T1, approve)).error.code, -32601);
  assert.equal((await answerServerRequest(msg('item/commandExecution/requestApproval'), T1, async () => 'acceptForSession')).result.decision, 'decline', '항상 허용 같은 답은 거부로');
});

test('승인 기록은 180일 보관(서버 켤 때 지난 것 정리)', async (t) => {
  const s = await setup(t);
  const { requestId } = await s.start();
  await s.dev('/v1/device/approvals', { method: 'POST', body: { requestId, kind: 'command', summary: 'new' } });
  const db = new DatabaseSync(join(s.d, 'p.db'));
  db.prepare("INSERT INTO approvals (approval_id, request_id, conversation_id, kind, summary, status, created_at) VALUES ('apv_old', ?, 'c1', 'command', 'old', 'denied', ?)")
    .run(requestId, new Date(Date.now() - 200 * 86400_000).toISOString());
  db.close();
  await s.reopen();
  const list = (await s.call('/v1/conversations/c1/approvals')).body.approvals.map((a) => a.summary);
  assert.ok(list.includes('new') && !list.includes('old'), JSON.stringify(list));
});

test('화면: 승인 카드(허용·거부만, 남은 시간), 처리 중에도 카드를 바로 불러옴', () => {
  const A = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
  assert.ok(A.includes("if (k.kind === 'approval')") && A.includes("btn('허용', () => decide('allow'))") && A.includes("btn('거부', () => decide('deny'))"));
  assert.ok(A.includes('분 안에 답하지 않으면 거부돼요') && !/항상 허용/.test(A.replace('항상 허용 없음', '')));
  assert.ok(A.includes("if (r.status === 'running' || r.status === 'dispatching') loadCards()"));
});
