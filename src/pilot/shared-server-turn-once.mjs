// X2.2 I1: 공유 App Server의 열린 시험 thread에 이어온 질문 1개를 넣고 답을 받는다.
// 사용: node src/pilot/shared-server-turn-once.mjs <threadId> <receiptPath>
// thread가 idle이 아니면 보내지 않는다(reject_busy). override 없음. 도구/파일/MCP/웹 항목이 시작되면 turn/interrupt 후 중단. 재시도 없음.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const ALLOWED = new Set(['01a18790-63c7-73e3-a60b-6ddb60fd5be8']);
const URL_ = 'ws://127.0.0.1:28761';
const QUESTION = '이 대화에서 방금 정한 시험 표식 C가 무엇이었는지 한 단어로 답해 주세요. 그리고 새 시험 표식 D는 "포도"입니다. 도구나 명령은 쓰지 말고 짧게 답해 주세요.';
const MARKER_C = '체리';
const METHODS = new Set(['initialize', 'thread/read', 'thread/resume', 'turn/start', 'turn/interrupt']);
const BLOCKED_ITEMS = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall']);

const [threadId, receiptPath] = process.argv.slice(2);
if (!threadId || !receiptPath) throw new Error('usage: <threadId> <receiptPath>');
if (threadId === EXCLUDED || !ALLOWED.has(threadId)) throw new Error('THREAD_NOT_ALLOWED');

const token = readFileSync(new URL('../../.local/x2/token', import.meta.url), 'utf8').trim();
const clientUserMessageId = randomUUID();
const receipt = {
  threadId, atUtc: new Date().toISOString(), endpoint: URL_, clientUserMessageId,
  methodsSent: [], statusBefore: null, turnStartRequests: 0, modelTurnStarts: 0, retries: 0,
  turnId: null, outcome: null, markerCFound: null, itemTypes: [], blockedItem: null,
  usage: null, errorKind: null, answerStored: false,
};
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

const ws = new WebSocket(URL_, { headers: { Authorization: `Bearer ${token}` } });
let nextId = 1;
const pending = new Map();
let answer = '';
let finish;
const done = new Promise((r) => { finish = r; });
const call = (method, params) => {
  if (!METHODS.has(method)) throw new Error('METHOD_NOT_ALLOWED');
  const id = nextId++;
  receipt.methodsSent.push(method);
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : p.resolve(msg.result);
    return;
  }
  const { method, params } = msg;
  if (!params || params.threadId !== threadId) return;
  if (receipt.turnId && params.turnId && params.turnId !== receipt.turnId) return;
  if (method === 'item/started' || method === 'item/completed') {
    const type = params.item?.type;
    if (type && !receipt.itemTypes.includes(type)) receipt.itemTypes.push(type);
    if (BLOCKED_ITEMS.has(type) && !receipt.blockedItem) {
      receipt.blockedItem = type;
      call('turn/interrupt', { threadId, turnId: receipt.turnId }).catch(() => {});
    }
    if (method === 'item/completed' && type === 'agentMessage') answer = params.item.text ?? answer;
  }
  if (method === 'turn/completed') {
    receipt.usage = params.turn?.usage ?? null;
    receipt.turnStatus = params.turn?.status ?? null;
    finish();
  }
  if (method === 'error') receipt.errorKind = 'server_error_notification';
};
const timer = setTimeout(() => { receipt.errorKind = 'timeout'; finish(); }, 180000);

try {
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws_error')); });
  await call('initialize', { clientInfo: { name: 'ieon-gateway-x2-turn', version: '0.0.1' } });
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
  const read = await call('thread/read', { threadId, includeTurns: false });
  receipt.statusBefore = read.thread?.status?.type ?? null;
  if (receipt.statusBefore !== 'idle') {
    receipt.outcome = 'BUSY_NOT_RUN';
  } else {
    // 이벤트 구독용. override를 넘기지 않는다.
    await call('thread/resume', { threadId, excludeTurns: true });
    receipt.turnStartRequests = 1;
    const started = await call('turn/start', { threadId, clientUserMessageId, input: [{ type: 'text', text: QUESTION, text_elements: [] }] });
    receipt.turnId = started.turn?.id ?? null;
    receipt.modelTurnStarts = 1;
    await done;
    receipt.markerCFound = answer.includes(MARKER_C);
    receipt.outcome = receipt.blockedItem ? 'STOPPED_BLOCKED_ITEM'
      : receipt.errorKind === 'timeout' ? 'UNKNOWN'
      : receipt.turnStatus === 'completed' ? 'COMPLETED' : `TURN_${receipt.turnStatus ?? 'UNKNOWN'}`;
  }
} catch (error) {
  receipt.errorKind = error.code !== undefined ? `rpc_${error.code}` : String(error.message).slice(0, 120);
  receipt.errorMessage = String(error.message).slice(0, 300);
  receipt.outcome = receipt.turnStartRequests ? 'UNKNOWN' : 'FAILED_BEFORE_TURN';
} finally {
  clearTimeout(timer);
  ws.close();
  save();
  console.log(JSON.stringify(receipt, null, 2));
  // 시험용 합성 답변만 확인용으로 출력한다. receipt·로그에는 저장하지 않는다.
  console.log('--- answer (not stored) ---');
  console.log(answer);
  process.exit(0);
}
