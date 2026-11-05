import test from 'node:test';
import assert from 'node:assert/strict';
import { tempStore, owner, codexBinding } from './helpers.mjs';
import { fakeCodexThread } from '../../src/pilot/fake-adapters.mjs';

test('같은 key·payload 재요청은 같은 request로 연결되고 실행은 1회다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  const a = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  const b = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  assert.equal(a.http, 202);
  assert.equal(b.http, 202);
  assert.equal(a.requestId, b.requestId);
  await store.execute(a.requestId, adapter);
  await store.execute(b.requestId, adapter);
  assert.equal(adapter.calls.length, 1);
});

test('같은 key·다른 payload는 409 idempotency_conflict이고 추가 실행이 없다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  const a = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  await store.execute(a.requestId, adapter);
  const b = store.submit(owner, 'c_codex', 'k1', { question: 'different' });
  assert.equal(b.http, 409);
  assert.equal(b.code, 'idempotency_conflict');
  assert.equal(adapter.calls.length, 1);
});

test('같은 세션을 다른 대화로 두 번 등록해도 잠금을 공유한다', (t) => {
  const alias = { ...codexBinding, conversationId: 'c_alias' };
  const { store } = tempStore(t, [codexBinding, alias]);
  assert.equal(store.submit(owner, 'c_codex', 'k1', { question: 'a' }).http, 202);
  const r = store.submit(owner, 'c_alias', 'k2', { question: 'b' });
  assert.equal(r.http, 409);
  assert.equal(r.code, 'conversation_busy');
});
