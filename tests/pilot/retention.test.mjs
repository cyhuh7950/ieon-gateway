import test from 'node:test';
import assert from 'node:assert/strict';
import { tempStore, owner, otherApp } from './helpers.mjs';
import { fakeCodexThread } from '../../src/pilot/fake-adapters.mjs';

test('답변은 삭제 전까지 보관되고 다른 앱은 조회·삭제할 수 없다', async (t) => {
  const { store } = tempStore(t);
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  await store.execute(r.requestId, fakeCodexThread({ answer: '보관 답변' }));
  assert.equal(store.messages(owner, 'c_codex')[0].answer, '보관 답변');
  assert.equal(store.messages(otherApp, 'c_codex'), null);
  assert.equal(store.deleteMessages(otherApp, 'c_codex').http, 404);
  assert.equal(store.messages(owner, 'c_codex').length, 1);
});

test('삭제 후 늦게 도착한 결과는 원문을 되살리지 않는다', async (t) => {
  const { store } = tempStore(t);
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  const adapter = fakeCodexThread({
    answer: '늦은 답변',
    beforeReturn: () => store.deleteMessages(owner, 'c_codex'),
  });
  await store.execute(r.requestId, adapter);
  assert.deepEqual(store.messages(owner, 'c_codex'), []);
  assert.equal(store.getRequest(owner, r.requestId).status, 'completed');
});

test('서버 삭제는 원래 세션 삭제를 호출하지 않는다', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread();
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  await store.execute(r.requestId, adapter);
  store.deleteMessages(owner, 'c_codex');
  assert.equal(adapter.deletes, 0);
});
