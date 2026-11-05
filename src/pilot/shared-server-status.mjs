// X2.1: 공유 App Server에 붙어 상태만 조회한다(모델 0). turn/start·queue·thread/resume는 보내지 않는다.
// 사용: node src/pilot/shared-server-status.mjs <threadId> <receiptPath>
// 토큰은 .local/x2/token에서 읽고 출력·저장하지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const ALLOWED = new Set(['01a18790-63c7-73e3-a60b-6ddb60fd5be8']);
const URL_ = 'ws://127.0.0.1:28761';
const READ_ONLY = ['initialize', 'thread/loaded/list'];

const [threadId, receiptPath] = process.argv.slice(2);
if (!threadId || !receiptPath) throw new Error('usage: <threadId> <receiptPath>');
if (threadId === EXCLUDED || !ALLOWED.has(threadId)) throw new Error('THREAD_NOT_ALLOWED');

const token = readFileSync(new URL('../../.local/x2/token', import.meta.url), 'utf8').trim();
const receipt = {
  threadId, atUtc: new Date().toISOString(), endpoint: URL_, methodsSent: [],
  connected: false, initialized: false, loadedThreadCount: null, targetLoaded: null,
  modelTurnStarts: 0, errorKind: null,
};
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

const ws = new WebSocket(URL_, { headers: { Authorization: `Bearer ${token}` } });
let nextId = 1;
const pending = new Map();
const call = (method, params) => {
  if (!READ_ONLY.includes(method)) throw new Error('METHOD_NOT_ALLOWED');
  const id = nextId++;
  receipt.methodsSent.push(method);
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  const p = msg.id !== undefined && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : p.resolve(msg.result);
};
const timer = setTimeout(() => { receipt.errorKind = 'timeout'; save(); process.exit(3); }, 15000);

try {
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws_error')); });
  receipt.connected = true;
  await call('initialize', { clientInfo: { name: 'ieon-gateway-x2-status', version: '0.0.1' } });
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
  receipt.initialized = true;
  const loaded = await call('thread/loaded/list', {});
  const ids = loaded?.data ?? loaded?.threadIds ?? [];
  receipt.loadedThreadCount = ids.length;
  receipt.targetLoaded = ids.includes(threadId);
  receipt.loadedResultKeys = Object.keys(loaded ?? {});
} catch (error) {
  receipt.errorKind = error.code !== undefined ? `rpc_${error.code}` : String(error.message).slice(0, 120);
} finally {
  clearTimeout(timer);
  ws.close();
  save();
  console.log(JSON.stringify(receipt, null, 2));
}
