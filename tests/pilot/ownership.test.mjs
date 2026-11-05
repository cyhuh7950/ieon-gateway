import test from 'node:test';
import assert from 'node:assert/strict';
import { tempStore, owner, stranger, otherApp } from './helpers.mjs';
import { fakeCodexThread } from '../../src/pilot/fake-adapters.mjs';

test('다른 사용자·앱·없는 대화는 404이고 실행되지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  for (const [principal, conv] of [[stranger, 'c_codex'], [otherApp, 'c_codex'], [owner, 'c_missing']]) {
    const r = store.submit(principal, conv, 'k1', { question: 'hi' });
    assert.equal(r.http, 404);
  }
  assert.equal(adapter.calls.length, 0);
});

test('payload의 user_id·thread ID·경로로 권한이나 대상이 바뀌지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  const r = store.submit(owner, 'c_codex', 'k1', {
    question: 'hi', userId: 'u_other', threadId: 'other-thread', cwd: 'C:\\', command: 'rm',
  });
  assert.equal(r.http, 202);
  await store.execute(r.requestId, adapter);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(adapter.calls[0], { engine: 'codex_thread', sessionRef: 'thread-test-1', question: 'hi' });
});

test('다른 사용자는 요청 상태를 조회할 수 없다', (t) => {
  const { store } = tempStore(t);
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  assert.equal(store.getRequest(stranger, r.requestId), null);
  assert.equal(store.getRequest(owner, r.requestId).status, 'queued');
});
