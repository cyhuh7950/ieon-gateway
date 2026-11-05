import test from 'node:test';
import assert from 'node:assert/strict';
import { tempStore, owner } from './helpers.mjs';
import { fakeCodexThread, fakeClaudeChannel } from '../../src/pilot/fake-adapters.mjs';

test('Codex: Desktop이 thread를 잡고 있으면 실패로 끝내고 재시도하지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread({ desktopHoldsThread: true });
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  const done = await store.execute(r.requestId, adapter);
  assert.equal(done.status, 'failed');
  assert.equal(done.errorCode, 'desktop_holds_thread');
  assert.equal(done.http, 409);
  assert.equal(adapter.calls.length, 1);
  await store.execute(r.requestId, adapter);
  assert.equal(adapter.calls.length, 1, '같은 요청을 다시 실행하지 않는다');
});

test('Codex: 거부된 뒤에는 새 요청을 받을 수 있다(잠금 반납)', async (t) => {
  const { store } = tempStore(t);
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  await store.execute(r.requestId, fakeCodexThread({ desktopHoldsThread: true }));
  assert.equal(store.submit(owner, 'c_codex', 'k2', { question: 'again' }).http, 202);
});

test('Claude: 세션이 실행 중이 아니면 503 session_not_running', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeClaudeChannel({ sessionRunning: false });
  const r = store.submit(owner, 'c_claude', 'k1', { question: 'hi' });
  const done = await store.execute(r.requestId, adapter);
  assert.equal(done.status, 'failed');
  assert.equal(done.errorCode, 'session_not_running');
  assert.equal(done.http, 503);
});

test('Claude: 권한 확인 대기는 approval_required로 두고 자동 승인하지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeClaudeChannel({ needsApproval: true });
  const r = store.submit(owner, 'c_claude', 'k1', { question: 'hi' });
  const done = await store.execute(r.requestId, adapter);
  assert.equal(done.status, 'approval_required');
  assert.equal(store.submit(owner, 'c_claude', 'k2', { question: 'x' }).code, 'conversation_busy');
});

test('같은 세션에 진행 중 요청이 있으면 두 번째는 409이고 실행되지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  const a = store.submit(owner, 'c_codex', 'k1', { question: 'a' });
  const b = store.submit(owner, 'c_codex', 'k2', { question: 'b' });
  assert.equal(b.http, 409);
  assert.equal(b.code, 'conversation_busy');
  await store.execute(a.requestId, adapter);
  assert.equal(adapter.calls.length, 1);
  assert.equal(store.submit(owner, 'c_codex', 'k3', { question: 'c' }).http, 202, '완료 후에는 받는다');
});
