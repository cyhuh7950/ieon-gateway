// S2 서버·연결부·어댑터 경로 검사(모델 0). 실제 SDK·채널 대신 대역을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp, isTailscaleAddress } from '../../src/pilot/server.mjs';
import { pollOnce, receiptLog } from '../../src/pilot/connector.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { claudeChannelAdapter } from '../../src/pilot/adapters/claude-channel.mjs';
import { fakeCodexThread, fakeClaudeChannel } from '../../src/pilot/fake-adapters.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const THREAD = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-s2-'));
  const app = createApp({
    dbPath: join(dir, 'pilot.db'),
    users: [{ tokenSha256: sha('user-token'), userId: 'u_sinsan', appId: 'app_web' },
      { tokenSha256: sha('other-token'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('device-token'), hostId: 'h_sinsan' }],
    bindings: [
      { conversationId: 'c_codex', label: '시험 표식 확인', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: THREAD },
      { conversationId: 'c_claude', label: 'C1 채널', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_sinsan', engine: 'claude_channel', sessionRef: 'ieon' },
    ],
  });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'user-token', ...init } = {}) => fetch(base + path, {
    ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  const ask = (conv, question, key = `k-${Math.random().toString(36).slice(2, 12)}`, token) =>
    call(`/v1/conversations/${conv}/requests`, { method: 'POST', token, headers: { 'idempotency-key': key }, body: JSON.stringify({ question }) });
  const connector = (adapters) => ({ baseUrl: base, deviceToken: 'device-token', adapters, receipts: receiptLog(join(dir, 'receipts.jsonl')) });
  return { base, call, ask, connector, dir };
}

test('PC 연결 전에는 device_unavailable, 연결 후 접수·실행·완료', async (t) => {
  const s = await setup(t);
  assert.equal((await s.ask('c_codex', '질문')).status, 503);
  const conn = s.connector({ codex_thread: fakeCodexThread({ answer: '사과' }) });
  assert.equal(await pollOnce(conn), false);
  const r = await s.ask('c_codex', '질문');
  assert.equal(r.status, 202);
  assert.equal(await pollOnce(conn), true);
  const got = await s.call(`/v1/requests/${r.body.requestId}`);
  assert.deepEqual([got.body.status, got.body.answer], ['completed', '사과']);
  assert.equal((await s.call('/v1/conversations/c_codex/messages')).body.messages.length, 1);
});

test('토큰 없는 접근·다른 사용자·연결부 토큰으로 사용자 API 불가', async (t) => {
  const s = await setup(t);
  assert.equal((await s.call('/v1/conversations', { token: 'nope' })).status, 401);
  assert.equal((await s.call('/v1/conversations', { token: 'device-token' })).status, 401);
  assert.deepEqual((await s.call('/v1/conversations', { token: 'other-token' })).body.conversations, []);
  await pollOnce(s.connector({}));
  assert.equal((await s.ask('c_codex', '질문', undefined, 'other-token')).status, 404);
  assert.equal((await s.call('/v1/device/jobs', { token: 'user-token' })).status, 401);
});

test('처리 중이면 409 busy, Desktop 잠금은 failed(desktop_holds_thread)·재시도 없음', async (t) => {
  const s = await setup(t);
  const adapter = fakeCodexThread({ desktopHoldsThread: true });
  const conn = s.connector({ codex_thread: adapter });
  await pollOnce(conn);
  const r = await s.ask('c_codex', '질문');
  assert.equal((await s.ask('c_codex', '또')).body.error, 'conversation_busy');
  await pollOnce(conn);
  const got = await s.call(`/v1/requests/${r.body.requestId}`);
  assert.deepEqual([got.body.status, got.body.errorCode], ['failed', 'desktop_holds_thread']);
  assert.equal(await pollOnce(conn), false);
  assert.equal(adapter.calls.length, 1);
});

test('세션 미실행은 failed, 결과 불명은 unknown이며 다시 실행하지 않는다', async (t) => {
  const s = await setup(t);
  const conn = s.connector({ claude_channel: fakeClaudeChannel({ sessionRunning: false }), codex_thread: fakeCodexThread({ loseAck: true }) });
  await pollOnce(conn);
  const a = await s.ask('c_claude', '질문');
  await pollOnce(conn);
  assert.equal((await s.call(`/v1/requests/${a.body.requestId}`)).body.errorCode, 'session_not_running');
  const b = await s.ask('c_codex', '질문');
  await pollOnce(conn);
  assert.equal((await s.call(`/v1/requests/${b.body.requestId}`)).body.status, 'unknown');
  assert.equal((await s.ask('c_codex', '다음')).body.error, 'conversation_busy');
});

test('Codex 어댑터: live 꺼짐·allowlist 밖·업무 대화 거부, 잠금 충돌은 SDK를 부르지 않음', async () => {
  let sdkLoaded = 0;
  const loadSdk = async () => { sdkLoaded++; return {}; };
  const off = codexThreadAdapter({ live: false, allowlist: [THREAD], loadSdk, probe: () => 'NO_LOCK_FILE' });
  await assert.rejects(off.run({ sessionRef: THREAD, question: 'q' }), { code: 'live_disabled' });
  const on = codexThreadAdapter({ live: true, allowlist: [THREAD], loadSdk, probe: () => 'WRITER_LOCK_CONFLICT' });
  await assert.rejects(on.run({ sessionRef: '01a0dadd-739f-74d2-93c5-9c405cc1019b', question: 'q' }), { code: 'thread_not_allowed' });
  await assert.rejects(on.run({ sessionRef: 'other', question: 'q' }), { code: 'thread_not_allowed' });
  await assert.rejects(on.run({ sessionRef: THREAD, question: 'q' }), { code: 'desktop_holds_thread' });
  assert.equal(sdkLoaded, 0);
});

test('X2.4 연결 모드: 기본 warm(2026-11-24 빠른 응답 기본), 처리 중 전환 거부, 바뀐 모드가 연결부 작업에 실림', async (t) => {
  const s = await setup(t);
  const list = async () => (await s.call('/v1/conversations')).body.conversations;
  const put = (conv, connectMode, token) => s.call(`/v1/conversations/${conv}/settings`, { method: 'PUT', token, body: JSON.stringify({ connectMode }) });
  assert.equal((await list()).find((c) => c.conversationId === 'c_codex').connectMode, 'warm');
  assert.equal((await list()).find((c) => c.conversationId === 'c_claude').connectMode, undefined);
  assert.equal((await put('c_claude', 'shared_server')).status, 400);
  assert.equal((await put('c_codex', 'other')).status, 400);
  assert.equal((await put('c_codex', 'shared_server', 'other-token')).status, 404);

  const seen = [];
  const adapter = { engine: 'codex_thread', async run(job) { seen.push(job.connectMode); return { receipt: 'r', answer: 'a', usage: { inputTokens: 10, outputTokens: 2 } }; } };
  const conn = s.connector({ codex_thread: adapter });
  await pollOnce(conn);
  await s.ask('c_codex', '질문');
  assert.equal((await put('c_codex', 'shared_server')).body.error, 'conversation_busy');
  await pollOnce(conn);
  assert.equal((await put('c_codex', 'shared_server')).status, 200);
  const last = await s.ask('c_codex', '다음');
  await pollOnce(conn);
  assert.deepEqual(seen, ['warm', 'shared_server']);
  assert.deepEqual((await s.call(`/v1/requests/${last.body.requestId}`)).body.usage, { inputTokens: 10, outputTokens: 2 });
});

test('Codex 어댑터: alternate 재개는 읽기 전용·승인 없음·원래 작업 폴더로 고정한다', async () => {
  let seen = null;
  let cwdAtSpawn = null;
  const loadSdk = async () => ({
    Codex: class {
      resumeThread(id, options) {
        seen = options;
        return { id, runStreamed: async () => ({ events: (async function* () {
          cwdAtSpawn = process.cwd();
          yield { type: 'thread.started', thread_id: id };
          yield { type: 'item.completed', item: { type: 'agent_message', text: '포도' } };
          yield { type: 'turn.completed', usage: {} };
        })() }) };
      }
    },
  });
  const work = tmpdir();
  const before = process.cwd();
  const adapter = codexThreadAdapter({ live: true, allowlist: [THREAD], probe: () => 'NO_LOCK_FILE', loadSdk, workingDirectories: { [THREAD]: work } });
  const r = await adapter.run({ sessionRef: THREAD, question: 'q', connectMode: 'alternate' });
  assert.equal(r.answer, '포도');
  assert.deepEqual(seen, { sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled', skipGitRepoCheck: true });
  assert.equal(cwdAtSpawn.toLowerCase(), work.replace(/[\\/]$/, '').toLowerCase());
  assert.equal(process.cwd(), before);
});

test('연결부: 어댑터가 알린 결과 불명 사유(turn_joined_by_other_input)를 그대로 보고하고 답을 저장하지 않는다', async (t) => {
  const s = await setup(t);
  const adapter = { engine: 'codex_thread', async run() { throw Object.assign(new Error('x'), { unknownCode: 'turn_joined_by_other_input' }); } };
  const conn = s.connector({ codex_thread: adapter });
  await pollOnce(conn);
  const r = await s.ask('c_codex', '질문');
  await pollOnce(conn);
  const got = (await s.call(`/v1/requests/${r.body.requestId}`)).body;
  assert.deepEqual([got.status, got.errorCode, got.answer], ['unknown', 'turn_joined_by_other_input', null]);
});

test('결과 불명 정리: 잠금 표시 → 다른 사용자 불가 → 사람 확인으로 정리 후 다시 질문 가능, 재실행 없음', async (t) => {
  const s = await setup(t);
  const calls = [];
  const adapter = { engine: 'codex_thread', async run(job) { calls.push(job); if (calls.length === 1) throw new Error('ack lost'); return { receipt: 'r', answer: 'a' }; } };
  const conn = s.connector({ codex_thread: adapter });
  await pollOnce(conn);
  const r = await s.ask('c_codex', '질문');
  await pollOnce(conn);
  const held = (await s.call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c_codex').heldBy;
  assert.deepEqual([held.requestId, held.status], [r.body.requestId, 'unknown']);
  const review = (executed, token) => s.call(`/v1/requests/${r.body.requestId}/review`, { method: 'POST', token, body: JSON.stringify({ executed }) });
  assert.equal((await review(true, 'other-token')).status, 404);
  assert.equal((await review('yes')).status, 400);
  const done = await review(true);
  assert.deepEqual([done.status, done.body.status, done.body.errorCode], [200, 'completed', 'reviewed_executed:result_unknown']);
  assert.equal((await review(false)).status, 409);
  assert.equal((await s.call(`/v1/requests/${r.body.requestId}`)).body.answer, null);
  assert.equal((await s.call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c_codex').heldBy, undefined);
  assert.equal((await s.ask('c_codex', '다음')).status, 202);
  assert.equal(calls.length, 1);
});

test('엔진 상태: 연결부 보고로 꺼진 엔진은 표시·접수 거절, 켜지면 접수', async (t) => {
  const s = await setup(t);
  const fake = { codex_thread: fakeCodexThread(), claude_channel: fakeClaudeChannel() };
  let state = { codexShared: 'down', claudeChannel: 'down' };
  const conn = { ...s.connector(fake), health: async () => state };
  await pollOnce(conn);
  const list = async () => Object.fromEntries((await s.call('/v1/conversations')).body.conversations.map((c) => [c.conversationId, c.engineReady]));
  assert.deepEqual(await list(), { c_codex: true, c_claude: false });
  assert.equal((await s.ask('c_claude', '질문')).body.error, 'session_not_running');
  await s.call('/v1/conversations/c_codex/settings', { method: 'PUT', body: JSON.stringify({ connectMode: 'shared_server' }) });
  assert.equal((await s.ask('c_codex', '질문')).body.error, 'shared_server_down');
  state = { codexShared: 'up', claudeChannel: 'up' };
  await pollOnce(conn);
  assert.deepEqual(await list(), { c_codex: true, c_claude: true });
  assert.equal((await s.ask('c_claude', '질문')).status, 202);
});

test('Codex 어댑터: shared_server 설정이 없으면 실행하지 않는다', async () => {
  const adapter = codexThreadAdapter({ live: true, allowlist: [THREAD], probe: () => 'NO_LOCK_FILE', loadSdk: async () => ({}) });
  await assert.rejects(adapter.run({ sessionRef: THREAD, question: 'q', connectMode: 'shared_server' }), { code: 'shared_server_not_configured' });
});

test('Claude 어댑터: 채널 미기동은 session_not_running', async (t) => {
  const s = await setup(t);
  const tokenFile = join(s.dir, 'ch-token');
  writeFileSync(tokenFile, 'x');
  const adapter = claudeChannelAdapter({ live: true, baseUrl: 'http://127.0.0.1:18798', tokenFile });
  await assert.rejects(adapter.run({ requestId: 'req_abcdefgh', question: 'q' }), { code: 'session_not_running' });
});

test('추가 접속 주소는 Tailscale(100.64.0.0/10)만 허용한다', () => {
  assert.deepEqual(['100.98.75.104', '100.64.0.1', '100.127.255.255'].map(isTailscaleAddress), [true, true, true]);
  assert.deepEqual(['0.0.0.0', '192.168.220.220', '100.128.0.1', '100.63.0.1', '127.0.0.1', '', '100.1.2.300'].map(isTailscaleAddress),
    [false, false, false, false, false, false, false]);
});
