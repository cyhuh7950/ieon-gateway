import test from 'node:test';
import assert from 'node:assert/strict';
import { probeReadOnly, projectStatus } from '../../src/pilot/app-server-transport.mjs';

const target = '01a185d0-e8fd-7812-80d1-ba8ff1d470e9';
const notifications = ['thread/status/changed', 'item/started', 'thread/started'];

function fixture(reply) {
  const writes = [];
  let stops = 0;
  return { writes, get stops() { return stops; }, transport: {
    send(message) { writes.push(message); },
    async receive() { return reply(writes.length, writes); },
    close() { stops++; },
  }};
}

test('본문 RPC 없이 initialize와 ID 목록만 요청하며 다른 알림을 억제한다', async () => {
  const fx = fixture((_, writes) => writes.length === 1
    ? { id: 1, result: { userAgent: 'probe' } }
    : { id: 2, result: { data: [target, 'other'], nextCursor: null } });
  const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
  assert.deepEqual(fx.writes.map(m => m.method), ['initialize', 'initialized', 'thread/loaded/list']);
  assert.deepEqual(fx.writes[0].params.capabilities, { optOutNotificationMethods: ['item/started', 'thread/started'] });
  assert.equal(result.targetLoaded, true);
  assert.equal(result.status, 'unknown');
  assert.equal(result.rpcRequests, 2);
  assert.equal(fx.stops, 1);
  assert.ok(!JSON.stringify(result).includes('other'));
});

test('허용 대상의 status만 투영하고 본문·예외 메시지를 출력하지 않는다', () => {
  assert.deepEqual(projectStatus({ method: 'thread/status/changed', params: {
    threadId: target, status: { type: 'active', activeFlags: ['waitingOnApproval'], prompt: 'SECRET' }, body: 'SECRET',
  }}, target), { type: 'active', activeFlags: ['waitingOnApproval'] });
  assert.equal(projectStatus({ method: 'thread/status/changed', params: { threadId: 'other', status: { type: 'idle' } } }, target), null);
  assert.equal(projectStatus({ method: 'item/started', params: { threadId: target, body: 'SECRET' } }, target), null);
  assert.equal(projectStatus({ method: 'thread/status/changed', params: { threadId: target, status: { type: 'unrecognized' } } }, target), null);
});

test('대상이 loaded 목록에 없어도 read/resume/start나 다음 페이지 조회를 하지 않는다', async () => {
  const fx = fixture((_, writes) => writes.length === 1 ? { id: 1, result: {} }
    : { id: 2, result: { data: ['other'], nextCursor: 'cursor' } });
  const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
  assert.equal(result.targetLoaded, false);
  assert.equal(result.listComplete, false);
  assert.equal(fx.writes.length, 3);
  assert.equal(result.status, 'unknown');
});

test('시간초과·오류는 원문 없이 unknown으로 남기며 재접속·재전송하지 않는다', async () => {
  for (const error of [Object.assign(new Error('SECRET'), { code: 'PROBE_TIMEOUT' }), new Error('SECRET')]) {
    const fx = fixture(() => { throw error; });
    const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
    assert.equal(result.status, 'unknown');
    assert.equal(result.outcome, error.code === 'PROBE_TIMEOUT' ? 'timeout' : 'transport_error');
    assert.equal(fx.writes.length, 1);
    assert.equal(fx.stops, 1);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
});

test('서버 오류가 나면 다음 RPC·본문 조회 없이 끝낸다', async () => {
  const fx = fixture(() => ({ id: 1, error: { code: -1, message: 'SECRET' } }));
  const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
  assert.equal(result.outcome, 'rpc_error');
  assert.equal(fx.writes.length, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});

test('초기화 응답 전에 온 status도 대상 ID와 상태만 기록한다', async () => {
  let responses = 0;
  const fx = fixture((_, writes) => {
    responses++;
    if (responses === 1) return { method: 'thread/status/changed', params: { threadId: target, status: { type: 'active', activeFlags: [] } } };
    if (writes.length === 1) return { id: 1, result: {} };
    return { id: 2, result: { data: [target] } };
  });
  const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
  assert.equal(result.status, 'active');
  assert.equal(result.statusSource, 'passive_notification');
});
test('상태 알림 후 연결/응답 오류가 나면 과거 idle·active를 unknown으로 무효화한다', async () => {
  for (const observed of ['idle', 'active']) {
    for (const fault of ['timeout', 'transport', 'rpc']) {
      let responses = 0;
      const fx = fixture(() => {
        responses++;
        if (responses === 1) return { method: 'thread/status/changed', params: {
          threadId: target, status: { type: observed, activeFlags: [] },
        }};
        if (fault === 'rpc') return { id: 1, error: { code: -1, message: 'SECRET' } };
        throw Object.assign(new Error('SECRET'), { code: fault === 'timeout' ? 'PROBE_TIMEOUT' : 'CLOSED' });
      });
      const result = await probeReadOnly(fx.transport, { threadId: target, notificationMethods: notifications });
      assert.equal(result.status, 'unknown', `${observed}/${fault}`);
      assert.equal(result.statusSource, 'invalidated_after_error');
      assert.equal(result.outcome, fault === 'rpc' ? 'rpc_error' : fault === 'timeout' ? 'timeout' : 'transport_error');
      assert.equal(fx.writes.length, 1);
      assert.equal(fx.stops, 1);
    }
  }
});