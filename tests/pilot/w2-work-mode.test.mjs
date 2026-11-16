// W2(WORK_AND_VOICE A1·WV1·WV4): 대화별 작업 모드. 켠 Codex 대화만 app-server 차례로 승인 카드(이번 한 번만), 쓰기는 작업 폴더 안,
// 인터넷 막음, 승인 판단은 사람(reviewer user). 번갈아 쓰기는 Desktop 잠금 판별을 그대로 지킨다. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { pollOnce } from '../../src/pilot/connector.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { EngineError } from '../../src/pilot/contracts.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';

// 가짜 app-server: 요청에 답하고, 차례가 시작되면 승인 요청 → (이어온 답을 보고) 답 → 차례 끝
function fakeAppServer({ status = 'idle', approvals = ['item/commandExecution/requestApproval'], finalStatus = 'completed', turnError = null, answer = '했어요' } = {}) {
  const sent = []; const answers = []; let handler = () => {}; let closed = false;
  const emit = (m) => setTimeout(() => handler(m), 1);
  const tr = {
    opened: Promise.resolve(),
    onMessage: (fn) => { handler = fn; },
    close: () => { closed = true; },
    send: (m) => {
      sent.push(m);
      if (m.method === 'initialize') emit({ id: m.id, result: {} });
      else if (m.method === 'thread/read') emit({ id: m.id, result: { thread: { status: { type: status } } } });
      else if (m.method === 'thread/resume') emit({ id: m.id, result: {} });
      else if (m.method === 'turn/start') {
        emit({ id: m.id, result: { turn: { id: 'turn_1' } } });
        approvals.forEach((method, i) => emit({ id: 900 + i, method, params: { threadId: m.params.threadId, command: 'dir', cwd: m.params.cwd, reason: 'a.txt' } }));
        if (!approvals.length) finishTurn(m.params.threadId);
      } else if (m.id >= 900 && m.result) { answers.push(m.result.decision); if (answers.length === approvals.length) finishTurn(sent.find((x) => x.method === 'turn/start').params.threadId); }
    },
  };
  function finishTurn(threadId) {
    if (answer) emit({ method: 'item/completed', params: { threadId, turnId: 'turn_1', item: { type: 'agentMessage', text: answer } } });
    emit({ method: 'turn/completed', params: { threadId, turn: { id: 'turn_1', status: finalStatus, error: turnError } } });
  }
  return { tr, sent, answers, get closed() { return closed; } };
}

test('서버: 작업 모드는 Codex 기존 대화만·주인 웹 화면만·처리 중엔 못 바꿈, 켠 대화의 질문에만 작업 모드 표시', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c_cl', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'ieon' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  assert.equal((await call('/v1/conversations/c_cl/work-mode', { method: 'PUT', body: { on: true } })).body.error, 'work_mode_not_supported');
  assert.equal((await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: true }, token: 'msg' })).status, 403);
  assert.equal((await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: true }, token: 'other' })).status, 404);
  assert.equal((await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: 'yes' } })).body.error, 'bad_work_mode');
  assert.equal((await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: true } })).body.workMode, true);
  assert.equal((await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c1').workMode, true);
  await call('/v1/device/jobs', { token: 'dev' });
  await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '일해' }, key: 'k-w2-work-0001' });
  assert.equal((await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: false } })).body.error, 'conversation_busy');
  const job = (await call('/v1/device/jobs', { token: 'dev' })).body;
  assert.equal(job.workMode, true);
  await call(`/v1/device/jobs/${job.requestId}/result`, { method: 'POST', body: { status: 'completed', answer: 'ok' }, token: 'dev' });
  await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: false } });
  await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '질문' }, key: 'k-w2-work-0002' });
  assert.equal((await call('/v1/device/jobs', { token: 'dev' })).body.workMode, undefined, '끄면 표시 없음');
  // 연결부는 작업 모드 표시를 어댑터에 그대로 넘긴다
  let seen = null;
  await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: true } }).catch(() => {});
});

test('번갈아 쓰기 작업 모드: Desktop 잠금 먼저, 작업 폴더 필수, app-server 차례(사람 판단·작업 폴더 안·인터넷 없음), 승인은 이어온 카드로', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2a-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  let fake; let spawned = 0; let sdk = 0;
  const base = { live: true, allowlist: [T1], loadSdk: async () => { sdk += 1; throw new Error('SDK는 작업 모드에서 쓰지 않음'); },
    appServer: () => { spawned += 1; fake = fakeAppServer(); return fake.tr; } };
  const run = (o, approve) => codexThreadAdapter({ ...base, ...o }).run({ engine: 'codex_thread', sessionRef: T1, question: '일해', connectMode: 'alternate', workMode: true }, { approve });
  await assert.rejects(run({ probe: () => 'NO_LOCK_FILE' }), (e) => e instanceof EngineError && e.code === 'work_dir_required');
  await assert.rejects(run({ probe: () => 'NO_LOCK_FILE', workingDirectories: { [T1]: join(d, 'none') } }), (e) => e.code === 'work_dir_missing');
  await assert.rejects(run({ probe: () => 'WRITER_LOCK_CONFLICT', workingDirectories: { [T1]: d } }), (e) => e.code === 'desktop_holds_thread');
  assert.equal(spawned, 0, '거절되면 app-server를 띄우지 않음');
  const asked = [];
  const r = await run({ probe: () => 'NO_LOCK_FILE', workingDirectories: { [T1]: d } }, async (x) => { asked.push(x); return 'accept'; });
  assert.equal(r.answer, '했어요');
  assert.equal(sdk, 0);
  const resume = fake.sent.find((m) => m.method === 'thread/resume').params;
  const turn = fake.sent.find((m) => m.method === 'turn/start').params;
  assert.deepEqual([resume.approvalPolicy, resume.approvalsReviewer, resume.sandbox, resume.cwd], ['untrusted', 'user', 'workspace-write', d]);
  assert.deepEqual([turn.approvalPolicy, turn.approvalsReviewer], ['untrusted', 'user']);
  assert.deepEqual(turn.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [d], networkAccess: false });
  assert.deepEqual(asked.map((a) => ({ kind: a.kind, summary: a.summary, cwd: a.cwd })), [{ kind: 'command', summary: 'dir', cwd: d }]);
  assert.deepEqual(fake.answers, ['accept']);
  assert.equal(fake.closed, true, '차례가 끝나면 app-server를 닫음');
  // 작업 모드가 아니면 지금처럼 SDK(읽기 전용)
  await assert.rejects(codexThreadAdapter({ ...base, probe: () => 'NO_LOCK_FILE' }).run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate' }), /SDK/);
  assert.equal(sdk, 1);
});

test('거부·승인 없이(approve 없음)는 decline, 사용 한도는 실행 안 됨, 일을 시작한 뒤의 실패는 결과 불명 쪽', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2b-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  let fake;
  const mk = (f) => codexThreadAdapter({ live: true, allowlist: [T1], probe: () => 'NO_LOCK_FILE', workingDirectories: { [T1]: d }, appServer: () => { fake = f; return f.tr; } });
  const run = (f, approve) => mk(f).run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate', workMode: true }, { approve });
  await run(fakeAppServer(), null);
  assert.deepEqual(fake.answers, ['decline'], '승인 길이 없으면 거부');
  await run(fakeAppServer({ approvals: ['item/fileChange/requestApproval'] }), async () => 'decline');
  assert.deepEqual(fake.answers, ['decline']);
  await assert.rejects(run(fakeAppServer({ approvals: [], finalStatus: 'failed', turnError: { message: 'usageLimitExceeded' }, answer: '' })), (e) => e instanceof EngineError && e.code === 'usage_limit');
  await assert.rejects(run(fakeAppServer({ approvals: [], finalStatus: 'failed', turnError: { message: 'boom' }, answer: '' })), (e) => !(e instanceof EngineError));
});

test('동시 사용 작업 모드: 사람이 쓰는 중(idle 아님)이면 거부, 같은 정책으로 공유 서버 차례', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2c-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const tokenFile = join(d, 'tok'); (await import('node:fs')).writeFileSync(tokenFile, 't');
  let fake;
  const mk = (f) => codexThreadAdapter({ live: true, allowlist: [T1], workingDirectories: { [T1]: d }, shared: { endpoint: 'ws://127.0.0.1:1', tokenFile }, wsTransport: () => { fake = f; return f.tr; } });
  const run = (f) => mk(f).run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'shared_server', workMode: true }, { approve: async () => 'accept' });
  await assert.rejects(run(fakeAppServer({ status: 'active' })), (e) => e.code === 'thread_busy');
  const r = await run(fakeAppServer());
  assert.equal(r.answer, '했어요');
  assert.deepEqual(fake.sent.find((m) => m.method === 'turn/start').params.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [d], networkAccess: false });
  assert.deepEqual(fake.answers, ['accept']);
});

test('연결부: 질문의 작업 모드 표시를 어댑터에 넘기고 승인 길(approve)을 함께 준다', async () => {
  let got = null;
  const job = { requestId: 'req_1', engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate', workMode: true };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/v1/device/jobs') ? { status: 200, json: async () => job } : { status: 200, json: async () => ({}) });
  try {
    await pollOnce({ baseUrl: 'http://x', deviceToken: 't', receipts: { has: () => false, add() {} },
      adapters: { codex_thread: { run: async (j, o) => { got = { j, approve: typeof o?.approve }; return { answer: 'ok' }; } } } });
  } finally { globalThis.fetch = orig; }
  assert.deepEqual([got.j.workMode, got.approve], [true, 'function']);
});

test('화면: 연결 설정의 작업 모드(Codex 기존 대화만, 켤 때 확인), 대화 위쪽 표시, 작업 폴더 없음 안내', () => {
  const A = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
  assert.ok(A.includes('id="pWork"') && A.includes('id="wmOn"') && A.includes('id="workChip"'));
  assert.ok(A.includes("$('pWork').hidden = c.engine !== 'codex_thread' || Boolean(c.newSession)"));
  assert.ok(A.includes("if (on && !confirm('작업 모드를 켤까요?"));
  assert.ok(A.includes("work_dir_required: ['warn'"));
});

test('메신저 승인(W2-b): 작업 모드 질문의 승인 요청을 그 대화방에 알리고 /허용 n · /거부 n, 주인만, 알린 번호만', async (t) => {
  const { createBridge } = await import('../../src/pilot/messenger/bridge.mjs');
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2m-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const conv = { conversationId: 'c1', label: '작업', engine: 'codex_thread', connectMode: 'alternate', deviceOnline: true, busy: false, workMode: true };
  let status = 'running'; const decisions = [];
  const api = async (req) => {
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [conv] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_1' } };
    if (req.path === '/v1/requests/req_1') return { status: 200, body: status === 'done' ? { status: 'completed', answer: '끝' } : { status } };
    if (req.path === '/v1/conversations/c1/cards') return { status: 200, body: { cards: [{ kind: 'approval', approvalId: 'apv_a', approvalKind: 'command', summary: 'npm test', cwd: 'C:/w' }] } };
    if (req.method === 'POST' && req.path === '/v1/approvals/apv_a') { decisions.push(req.body.decision); status = 'done'; return { status: 200, body: { status: 'allowed' } }; }
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, roomsPath: join(d, 'rooms.json'), pollMs: 5, waitMs: 2000,
    isAllowed: (m) => ['111', '222'].includes(m.userId), isOwner: (m) => m.userId === '111' });
  const said = []; const say = (userId, text) => bridge.handle({ platform: 'telegram', userId, chatId: '-1', text }, async (s) => { said.push(s); });
  await say('111', '/use 1');
  const asking = say('111', '테스트 돌려 줘');
  for (let i = 0; i < 100 && !said.some((s) => s.includes('승인 요청 1')); i += 1) await new Promise((r) => setTimeout(r, 5));
  const note = said.find((s) => s.includes('승인 요청 1'));
  assert.ok(note && note.includes('명령 실행') && note.includes('npm test') && note.includes('/허용 1') && note.includes('/거부 1'), note);
  await new Promise((r) => setTimeout(r, 60)); // 그사이 여러 번 확인해도 같은 요청은 다시 알리지 않아야 함
  await say('222', '/허용 1');
  assert.match(said.at(-1), /주인만/); assert.deepEqual(decisions, [], '봇에 더한 사람은 승인 못 함');
  await say('111', '/허용 9');
  assert.match(said.at(-1), /9번이 이 대화방에 없어요/);
  await say('111', '/허용 1');
  assert.deepEqual(decisions, ['allow']);
  await asking;
  assert.ok(said.some((s) => s === '끝'), '허용 뒤 답');
  assert.equal(said.filter((s) => s.includes('허용: /허용')).length, 1, '같은 요청은 한 번만 알림');
});

test('서버: 승인 결정은 웹 화면·메신저 봇만, 외부 프로그램 키는 불가', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w2s-'));
  const closers = []; t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('ext'), userId: 'u_sinsan', appId: 'app_ext' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger', 'app_ext'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`; closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  await call('/v1/device/jobs', { token: 'dev' });
  const q = await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: 'k-w2-srv-0001' });
  await call('/v1/device/jobs', { token: 'dev' });
  const a = (await call('/v1/device/approvals', { method: 'POST', body: { requestId: q.body.requestId, kind: 'command', summary: 'x' }, token: 'dev' })).body;
  assert.equal((await call(`/v1/approvals/${a.approvalId}`, { method: 'POST', body: { decision: 'allow' }, token: 'ext' })).status, 403);
  assert.equal((await call(`/v1/approvals/${a.approvalId}`, { method: 'POST', body: { decision: 'deny' }, token: 'msg' })).body.status, 'denied');
});
