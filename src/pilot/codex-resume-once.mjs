// X1 I1: 승인된 시험 thread를 공식 Codex SDK로 1회 재개해 질문 1개를 보낸다.
// 사용: node src/pilot/codex-resume-once.mjs <threadId> <receiptPath>
// 도구 실행·파일 변경·외부 호출 항목이 시작되면 즉시 중단한다. 재시도하지 않는다.
import { Codex } from '@openai/codex-sdk';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const ALLOWED = new Set(['01a18790-63c7-73e3-a60b-6ddb60fd5be8']);
const QUESTION = '이 대화에서 앞서 정한 시험 표식이 무엇이었는지 한 단어로 답해 주세요. 그리고 새 시험 표식은 "바나나"입니다. 도구나 명령은 쓰지 말고 짧게 답해 주세요.';
const MARKER_A = '사과';
const BLOCKED_ITEMS = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);

const [threadId, receiptPath] = process.argv.slice(2);
if (!threadId || !receiptPath) throw new Error('usage: <threadId> <receiptPath>');
if (threadId === EXCLUDED || !ALLOWED.has(threadId)) throw new Error('THREAD_NOT_ALLOWED');

const receipt = {
  threadId, atUtc: new Date().toISOString(), sdkVersion: '0.165.0',
  precheck: null, resumeRequests: 0, modelTurnStarts: 0, retries: 0,
  outcome: null, returnedThreadId: null, sameThread: null, markerAFound: null,
  itemTypes: [], blockedItem: null, usage: null, errorKind: null, answerStored: false,
};
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

// 사전 확인: Desktop이 thread를 쥐고 있으면 재개하지 않는다.
const probe = fileURLToPath(new URL('./lock-probe.ps1', import.meta.url));
receipt.precheck = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', probe, '-ThreadId', threadId], { encoding: 'utf8' })).outcome;
if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(receipt.precheck)) {
  receipt.outcome = 'BUSY_NOT_RUN';
  save();
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(2);
}

const controller = new AbortController();
let answer = '';
try {
  // ThreadOptions를 넘기지 않는다: 원래 thread의 model·sandbox·승인 설정을 바꾸지 않기 위해서다.
  const thread = new Codex().resumeThread(threadId);
  receipt.resumeRequests = 1;
  const { events } = await thread.runStreamed(QUESTION, { signal: controller.signal });
  receipt.modelTurnStarts = 1;
  for await (const event of events) {
    if (event.type === 'thread.started') receipt.returnedThreadId = event.thread_id;
    if (event.type === 'item.started' || event.type === 'item.completed') {
      const type = event.item.type;
      if (!receipt.itemTypes.includes(type)) receipt.itemTypes.push(type);
      if (BLOCKED_ITEMS.has(type)) { receipt.blockedItem = type; controller.abort(); break; }
      if (event.type === 'item.completed' && type === 'agent_message') answer = event.item.text;
    }
    if (event.type === 'turn.completed') receipt.usage = event.usage;
    if (event.type === 'turn.failed') receipt.errorKind = 'turn_failed';
  }
  receipt.returnedThreadId ??= thread.id;
  receipt.sameThread = receipt.returnedThreadId === threadId;
  receipt.markerAFound = answer.includes(MARKER_A);
  receipt.outcome = receipt.blockedItem ? 'STOPPED_BLOCKED_ITEM'
    : receipt.errorKind ? 'FAILED' : 'COMPLETED';
} catch (error) {
  receipt.errorKind = error.name === 'AbortError' ? 'aborted' : 'error';
  receipt.errorMessage = String(error.message).slice(0, 300);
  receipt.outcome = receipt.modelTurnStarts ? 'UNKNOWN' : 'FAILED_BEFORE_TURN';
}
save();
console.log(JSON.stringify(receipt, null, 2));
// 시험용 합성 답변만 확인용으로 터미널에 출력한다. receipt·로그에는 저장하지 않는다.
console.log('--- answer (not stored) ---');
console.log(answer);
