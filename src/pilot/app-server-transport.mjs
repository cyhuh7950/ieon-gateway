import { spawn } from 'node:child_process';

const STATUS_TYPES = new Set(['notLoaded', 'idle', 'systemError', 'active']);
const FLAGS = new Set(['waitingOnApproval', 'waitingOnUserInput']);

export function projectStatus(message, threadId) {
  if (message?.method !== 'thread/status/changed' || message.params?.threadId !== threadId) return null;
  const status = message.params.status;
  if (!STATUS_TYPES.has(status?.type)) return null;
  return status.type === 'active'
    ? { type: 'active', activeFlags: Array.isArray(status.activeFlags) ? status.activeFlags.filter(f => FLAGS.has(f)) : [] }
    : { type: status.type };
}

// S0 전용: 실행·본문 조회·설정/인증 RPC를 만들거나 전달하는 경로가 없다.
export async function probeReadOnly(transport, { threadId, notificationMethods }) {
  const receipt = { threadId, initialized: false, targetLoaded: null, listComplete: false,
    status: 'unknown', statusSource: 'not_observed', rpcRequests: 0, outcome: 'unknown' };
  async function receive(id) {
    for (;;) {
      const message = await transport.receive();
      const status = projectStatus(message, threadId);
      if (status) { receipt.status = status.type; receipt.statusSource = 'passive_notification'; }
      if (message?.id !== id || message.method) continue;
      if (message.error) throw Object.assign(new Error('S0_RPC_ERROR'), { code: 'S0_RPC_ERROR' });
      return message.result;
    }
  }
  try {
    receipt.rpcRequests++;
    transport.send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'ieon_s0_read_only', version: '0.1.0' },
      capabilities: { optOutNotificationMethods: notificationMethods.filter(m => m !== 'thread/status/changed') },
    } });
    await receive(1);
    receipt.initialized = true;
    transport.send({ method: 'initialized', params: {} });
    receipt.rpcRequests++;
    transport.send({ id: 2, method: 'thread/loaded/list', params: { limit: 1000 } });
    const result = await receive(2);
    if (!Array.isArray(result?.data) || result.data.some(id => typeof id !== 'string')) throw new Error('S0_INVALID_RESPONSE');
    receipt.targetLoaded = result.data.includes(threadId);
    receipt.listComplete = !result.nextCursor;
    receipt.outcome = 'metadata_only';
  } catch (error) {
    // 연결이 실패하면 마지막 관찰값을 현재 실행 가능 상태로 사용하지 않는다.
    receipt.status = 'unknown';
    if (receipt.statusSource === 'passive_notification') receipt.statusSource = 'invalidated_after_error';
    receipt.outcome = error?.code === 'PROBE_TIMEOUT' ? 'timeout'
      : error?.code === 'S0_RPC_ERROR' ? 'rpc_error' : 'transport_error';
  } finally {
    transport.close();
  }
  return receipt;
}

export function createProxyTransport({ executable, socket, timeoutMs = 5000 }) {
  const child = spawn(executable, ['app-server', 'proxy', '--sock', socket], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '', failure, waiter, writes = 0;
  const queue = [];
  const deadline = Date.now() + timeoutMs;
  const expectedMethods = ['initialize', 'initialized', 'thread/loaded/list'];
  const fail = () => {
    failure = Object.assign(new Error('S0_PROXY_CLOSED'), { code: 'S0_PROXY_CLOSED' });
    if (waiter) { const pending = waiter; waiter = null; pending.reject(failure); }
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  // stderr에는 경로/진단/원문이 포함될 수 있으므로 저장하거나 출력하지 않는다.
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) { fail(); child.kill(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { fail(); child.kill(); return; }
      // 허용 응답과 상태 알림 이외에는 즉시 버린다. 원본 이벤트 기록 없음.
      if (!(message?.id === 1 || message?.id === 2 || message?.method === 'thread/status/changed')) continue;
      if (waiter) { const pending = waiter; waiter = null; pending.resolve(message); }
      else if (queue.length < 100) queue.push(message);
      else { fail(); child.kill(); return; }
    }
  });
  return {
    send(message) {
      if (message.method !== expectedMethods[writes]) throw new Error('S0_METHOD_DENIED');
      writes++;
      child.stdin.write(JSON.stringify(message) + '\n');
    },
    async receive() {
      if (queue.length) return queue.shift();
      if (failure) throw failure;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error('S0_TIMEOUT'), { code: 'PROBE_TIMEOUT' });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiter = null; reject(Object.assign(new Error('S0_TIMEOUT'), { code: 'PROBE_TIMEOUT' })); }, remaining);
        waiter = {
          resolve(message) { clearTimeout(timer); resolve(message); },
          reject(error) { clearTimeout(timer); reject(error); },
        };
      });
    },
    close() { child.stdin.end(); child.kill(); },
  };
}