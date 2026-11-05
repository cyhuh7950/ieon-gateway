import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempStore, owner } from './helpers.mjs';
import { fakeCodexThread } from '../../src/pilot/fake-adapters.mjs';

const crashScript = fileURLToPath(new URL('./crash-worker.mjs', import.meta.url));

function crashAt(path, requestId, point) {
  const r = spawnSync(process.execPath, [crashScript, path, requestId, point], { encoding: 'utf8' });
  assert.equal(r.status, 86, `worker는 ${point}에서 강제 종료되어야 한다: ${r.stderr}`);
}

test('접수 후 실행 전 재시작: queued 유지, 실행 1회로 완료', async (t) => {
  const env = tempStore(t);
  const r = env.store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  const store = env.reopen();
  assert.equal(store.getRequest(owner, r.requestId).status, 'queued');
  const adapter = fakeCodexThread();
  assert.equal((await store.execute(r.requestId, adapter)).status, 'completed');
  assert.equal(adapter.calls.length, 1);
});

for (const point of ['before_send', 'after_send', 'after_receipt']) {
  test(`실제 프로세스가 ${point}에서 죽으면 ${point === 'before_send' ? '' : '전송 가능성 때문에 '}재실행하지 않는다`, async (t) => {
    const env = tempStore(t);
    const r = env.store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
    env.store.close();
    crashAt(env.path, r.requestId, point);
    const store = env.reopen();
    const req = store.getRequest(owner, r.requestId);
    assert.equal(req.status, 'unknown');
    const adapter = fakeCodexThread();
    await store.execute(r.requestId, adapter);
    assert.equal(adapter.calls.length, 0, 'unknown은 자동 재전송하지 않는다');
    assert.equal(store.submit(owner, 'c_codex', 'k2', { question: 'new' }).code, 'conversation_busy',
      'unknown이 풀리기 전에는 같은 세션에 새 실행을 받지 않는다');
  });
}

test('ack 손실(전송 후 응답 없이 예외)은 unknown이고 재전송 없음', async (t) => {
  const { store } = tempStore(t);
  const adapter = fakeCodexThread({ loseAck: true });
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  assert.equal((await store.execute(r.requestId, adapter)).status, 'unknown');
  await store.execute(r.requestId, adapter);
  assert.equal(adapter.calls.length, 1);
});

test('unknown은 공식 조회 결과로만 정리된다', async (t) => {
  const { store } = tempStore(t);
  const r = store.submit(owner, 'c_codex', 'k1', { question: 'hi' });
  await store.execute(r.requestId, fakeCodexThread({ loseAck: true }));
  store.resolveUnknown(r.requestId, { found: true, receipt: 'turn-9', answer: 'ok' });
  assert.equal(store.getRequest(owner, r.requestId).status, 'completed');
  assert.equal(store.submit(owner, 'c_codex', 'k2', { question: 'next' }).http, 202);
});
