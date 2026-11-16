// RC5(REQUEST_CONTROL 4절): 사람에게 넘기기. 대화마다 "사람이 직접 할 일" 규칙(종류·명령에 든 글자)을 두고, 맞는 요청은
// 엔진에 거부로 답한 뒤 넘김 카드로 보여 주고, 사람이 직접 처리함/하지 않음을 원래 요청에 기록한다. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { approver } from '../../src/pilot/connector.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc5-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '하나', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000041' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  let k = 0;
  const start = async () => {
    await call('/v1/device/jobs', { token: 'dev' });
    const id = (await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: `k-rc5-${++k}-xxxx` })).body.requestId;
    assert.equal((await call('/v1/device/jobs', { token: 'dev' })).body.requestId, id);
    return id;
  };
  const ask = async (requestId, kind, summary) => (await call('/v1/device/approvals', { token: 'dev', method: 'POST', body: { requestId, kind, summary, cwd: 'C:/w', itemId: 'i-' + Math.random() } })).body;
  return { base, call, start, ask, devHeaders: { authorization: 'Bearer dev', 'content-type': 'application/json' } };
}

test('규칙: 웹 화면 주인만 바꾸고, 종류·글자를 검사하고, 비우면 지운다', async (t) => {
  const s = await setup(t);
  assert.deepEqual((await s.call('/v1/conversations/c1/handoff')).body, { kinds: [], patterns: [], setAt: null });
  assert.equal((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', token: 'msg', body: { kinds: ['command'] } })).status, 403, '메신저로는 못 바꿈');
  assert.equal((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', token: 'other', body: { kinds: ['command'] } })).status, 404, '남의 대화는 없는 것과 같다');
  assert.deepEqual((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { kinds: ['rm'] } })).body, { error: 'bad_kinds' });
  assert.deepEqual((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { patterns: ['x'.repeat(61)] } })).body, { error: 'bad_patterns' });
  assert.deepEqual((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { kinds: ['file'], patterns: [' git push ', 'deploy', 'deploy'] } })).body, { kinds: ['file'], patterns: ['git push', 'deploy'] });
  assert.deepEqual((await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { kinds: [], patterns: [] } })).body, { kinds: [], patterns: [] });
  assert.equal((await s.call('/v1/conversations/c1/handoff')).body.setAt, null, '비우면 규칙이 없어짐');
});

test('규칙에 맞는 요청은 묻지 않고 엔진에 거부로 답하고(실행 0), 넘김 카드로 남는다 — 맞지 않으면 평소대로 승인 대기', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { kinds: ['file'], patterns: ['git push'] } });
  const id = await s.start();
  // 연결부의 승인 기다리기(실제 approver): 넘긴 일은 바로 거부로 끝나고, 허용 연결도 하지 않는다
  let allowed = 0;
  const said = await approver({ baseUrl: s.base, headers: s.devHeaders, requestId: id, pollMs: 10, maxMs: 2000 })({ kind: 'command', summary: 'git push origin main', cwd: 'C:/w', itemId: 'i1', onAllowed: () => { allowed += 1; } });
  assert.deepEqual([said, allowed], ['decline', 0], '엔진에는 "하지 마세요"');
  const f = await s.ask(id, 'file', '파일 수정'); assert.equal(f.handoff, true, '파일 수정은 종류 전체가 넘김');
  const n = await s.ask(id, 'command', 'npm test'); assert.equal(n.handoff, undefined, '규칙에 없는 명령은 평소대로');
  const cards = (await s.call('/v1/conversations/c1/cards')).body.cards.filter((c) => c.kind.startsWith('approval') || c.kind === 'handoff');
  assert.deepEqual(cards.map((c) => [c.kind, c.state, c.summary]).sort(), [['approval', 'pending', 'npm test'], ['handoff', 'handoff', 'git push origin main'], ['handoff', 'handoff', '파일 수정']].sort());
  // 글자 규칙은 명령에만 — 파일 수정 사유에 같은 글자가 있어도 종류 규칙이 없으면 넘기지 않음
  await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { kinds: [], patterns: ['git push'] } });
  assert.equal((await s.ask(id, 'file', 'git push 전에 파일 정리')).handoff, undefined);
  // 대문자도 같은 글자로 본다
  assert.equal((await s.ask(id, 'command', 'GIT PUSH --force')).handoff, true);
});

test('넘긴 일은 차례가 끝나도 남아 있고, 사람이 직접 처리함/하지 않음을 한 번만 기록한다 — 허용·거부와 섞이지 않음', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c1/handoff', { method: 'PUT', body: { patterns: ['deploy'] } });
  const id = await s.start();
  const h = await s.ask(id, 'command', './deploy.sh prod');
  const p = await s.ask(id, 'command', 'ls');
  await s.call(`/v1/device/jobs/${id}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: '배포는 사람이 해야 해요' } });
  const after = (await s.call('/v1/conversations/c1/approvals')).body.approvals;
  assert.deepEqual([after.find((a) => a.approvalId === h.approvalId).state, after.find((a) => a.approvalId === p.approvalId).state], ['handoff', 'turn_ended'], '승인 대기는 차례 끝 거부, 넘긴 일은 그대로');
  assert.deepEqual((await s.call('/v1/approvals')).body.approvals.map((a) => [a.approvalId, a.handoff]), [[h.approvalId, true]], '승인 대기함에 넘긴 일이 남음');
  assert.deepEqual((await s.call('/v1/approvals/' + h.approvalId, { method: 'POST', body: { decision: 'allow' } })).body, { error: 'approval_closed', status: 'handoff' }, '넘긴 일을 허용으로 바꿀 수 없음');
  assert.equal((await s.call('/v1/approvals/' + h.approvalId, { method: 'POST', token: 'other', body: { decision: 'done' } })).status, 404);
  assert.deepEqual((await s.call('/v1/approvals/' + h.approvalId, { method: 'POST', token: 'msg', body: { decision: 'done' } })).body, { status: 'handoff_done' }, '메신저 주인도 기록 가능');
  assert.deepEqual((await s.call('/v1/approvals/' + h.approvalId, { method: 'POST', body: { decision: 'drop' } })).body, { error: 'approval_closed', status: 'handoff_done' }, '한 번만');
  const card = (await s.call('/v1/conversations/c1/cards')).body.cards.find((c) => c.approvalId === h.approvalId);
  assert.deepEqual([card.kind, card.state], ['approval_result', 'handoff_done']);
  const task = (await s.call('/v1/tasks/' + id)).body;
  assert.equal(task.approvals.find((a) => a.approvalId === h.approvalId).state, 'handoff_done', '원래 요청(작업)에 기록이 남음');
  // 평소 승인에는 처리 기록을 쓸 수 없음
  const id2 = await s.start();
  const q = await s.ask(id2, 'command', 'npm test');
  assert.deepEqual((await s.call('/v1/approvals/' + q.approvalId, { method: 'POST', body: { decision: 'done' } })).body, { error: 'approval_closed', status: 'pending' });
});

test('메신저: 넘긴 일을 대화방에 알리고 /처리 n · /중단 n 으로 기록(주인만)', async () => {
  const said = []; const calls = []; let st = 'running';
  const api = async (req) => {
    calls.push(req);
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [{ conversationId: 'c1', label: '하나', engine: 'codex_thread', deviceOnline: true, busy: false, workMode: true }] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_1' } };
    if (req.method === 'GET' && req.path === '/v1/requests/req_1') { const s = st; st = 'completed'; return { status: 200, body: { status: s, answer: '답' } }; }
    if (req.method === 'GET' && req.path === '/v1/conversations/c1/cards') return { status: 200, body: { cards: [{ kind: 'handoff', approvalId: 'apv_h', requestId: 'req_1', approvalKind: 'command', summary: 'git push', cwd: 'C:/w', n: 3, state: 'handoff' }] } };
    if (req.method === 'GET' && req.path === '/v1/conversations/c1/approvals') return { status: 200, body: { approvals: [{ approvalId: 'apv_h', n: 3, state: 'handoff' }] } };
    if (req.method === 'POST' && req.path === '/v1/approvals/apv_h') return { status: 200, body: { status: req.body.decision === 'done' ? 'handoff_done' : 'handoff_dropped' } };
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111', '222'] }, isOwner: (m) => String(m.userId) === '111', roomsPath: join(mkdtempSync(join(tmpdir(), 'ieon-rc5b-')), 'rooms.json'), pollMs: 1, waitMs: 2000 });
  const send = async (x) => { said.push(x); };
  const m = (text, userId = '111', id = Math.random()) => ({ platform: 'telegram', userId, chatId: '-1', text, msgId: `tg--1-${id}` });
  await bridge.handle(m('/use 1'), send);
  await bridge.handle(m('배포해 줘'), send);
  assert.ok(said.some((x) => /사람이 직접 할 일 3: 명령 실행 — git push \(작업 폴더 C:\/w\)[\s\S]*\/처리 3[\s\S]*\/중단 3/.test(x)), said.join(' | '));
  await bridge.handle(m('/처리 3', '222'), send);
  assert.match(said.at(-1), /주인만/);
  await bridge.handle(m('/처리 3'), send);
  assert.match(said.at(-1), /사람이 직접 할 일 3: 직접 처리함으로 기록/);
  assert.deepEqual(calls.filter((c) => c.path === '/v1/approvals/apv_h').map((c) => c.body.decision), ['done']);
});

test('웹 화면: 넘김 카드·규칙 칸·작업 서랍 버튼(PC형·허브형 같은 화면)', () => {
  const html = readFileSync(new URL('../../src/pilot/web/app.html', import.meta.url), 'utf8');
  for (const s of ["k.kind === 'handoff'", "mark('done')", "mark('drop')", 'id="hoCmd"', 'id="hoPat"', "'/handoff'", "[['직접 처리함', 'done'], ['하지 않음', 'drop']]", 'handoff_done']) assert.ok(html.includes(s), s);
});
