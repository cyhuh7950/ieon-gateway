// S2.3 Codex thread 어댑터. 세션별 connect_mode로 두 방식을 고른다.
// - alternate: 잠금 사전 확인 → SDK resumeThread → runStreamed (X1에서 확인한 방식)
// - shared_server: 공유 App Server에 붙어 thread가 idle일 때만 turn/start (X2에서 확인한 방식)
// 기본은 live 실행 차단이다. allowlist 밖 thread·업무 대화는 거부한다. override를 넘기지 않는다.
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkNewSession } from '../new-sessions.mjs';
import { lockOutcome } from '../lock-probe.mjs';
import { randomUUID } from 'node:crypto';
import { EngineError, StoppedError } from '../contracts.mjs';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
// 규칙 점검 1(2026-11-18 신산님): 기존 대화는 읽기 전용 샌드박스(쓰기·네트워크 막힘)에서 명령·파일 읽기를 그대로 하게 두고,
// 샌드박스 밖에서 도는 도구(MCP·동적 도구)만 그 자리에서 멈춘다. 멈추거나 막힌 것은 답 끝에 알리고 정상 완료(전에는 잠김).
const BLOCKED_SDK = new Set(['mcp_tool_call', 'dynamic_tool_call']);
const BLOCKED_APP = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall']);
// Windows는 lock-probe.ps1, Linux는 /proc/locks 읽기(src/pilot/lock-probe.mjs).
export const lockProbe = (threadId) => lockOutcome(threadId);

// A1(ENGINE_ACCOUNTS EA4): 계정의 사용 한도에 걸려 답을 만들기 전에 끝난 경우. 모델이 일을 시작하지 않았으므로 "실행 안 됨"이
// 확실하다 → 결과 불명으로 잠그지 않고 usage_limit(실패)로 알린다(다시 보내기는 사용자가 누를 때만).
export const isUsageLimit = (m) => /usage[ _]?limit|hit your limit|usageLimitExceeded/i.test(String(m ?? ''));
const limitHit = (turn) => turn.failed && isUsageLimit(turn.failMessage) && !turn.answer && !turn.worked;

async function runAlternate(threadId, question, deps) {
  const outcome = deps.probe(threadId);
  if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(outcome)) {
    throw new EngineError(outcome === 'WRITER_LOCK_CONFLICT' ? 'desktop_holds_thread' : 'lock_check_failed', 409);
  }
  const { Codex } = await deps.loadSdk();
  const codexOpts = deps.env ? { env: deps.env } : undefined; // A2: 고른 이어온 전용 계정(없으면 PC 기본 로그인)
  // ThreadOptions를 비우면 SDK(codex exec)가 사용자 config.toml의 sandbox_mode(이 PC는 danger-full-access)와
  // approval never로 실행한다(2026-10-30 rollout 확인). 외부 질문은 항상 읽기 전용·승인 없음·웹/네트워크 차단으로 고정하고,
  // SDK 옵션은 이번 실행에만 적용되고 Desktop은 다음 turn에 자기 설정을 다시 쓴다(rollout 확인).
  // workingDirectory(--cd)는 exec resume에서 os error 2로 실패하므로 넘기지 않고, codex 프로세스가 시작될 때의
  // 현재 폴더를 원래 대화 폴더로 잠시 바꾼다. 연결부는 한 번에 한 작업만 실행한다.
  const thread = new Codex(codexOpts).resumeThread(threadId, {
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    skipGitRepoCheck: true,
  });
  const turn = await streamTurn(thread, question, { cwd: deps.workingDirectory, blocked: BLOCKED_SDK, stop: deps.signal });
  if (turn.stopped) throw new StoppedError();
  if (limitHit(turn)) throw new EngineError('usage_limit', 429);
  if ((turn.failed && !turn.blocked) || (turn.returned ?? thread.id) !== threadId) throw new Error('turn_failed_or_thread_mismatch');
  return { receipt: `codex:${threadId}`, answer: withNote(turn.answer, blockedNote(turn)) };
}

// 답 끝에 붙이는 알림: 그 자리에서 멈춘 도구, 샌드박스에서 막혀 실패한 파일 수정
const TOOL_WORD = { mcp_tool_call: 'MCP 도구', dynamic_tool_call: '외부 도구', commandExecution: '명령', fileChange: '파일 수정', mcpToolCall: 'MCP 도구', webSearch: '웹 검색', dynamicToolCall: '외부 도구' };
export function blockedNote(turn) {
  const lines = [];
  if (turn.blocked) lines.push(`- ${TOOL_WORD[turn.blocked] ?? turn.blocked}${turn.blockedWhat ? ' ' + turn.blockedWhat : ''} — 이 대화에서 쓸 수 없어 그 자리에서 멈춤(답이 덜 끝났을 수 있어요)`);
  for (const p of (turn.deniedFiles ?? []).slice(0, 5)) lines.push(`- 파일 수정 ${p} — 권한 설정에서 막힘`);
  if ((turn.deniedFiles ?? []).length > 5) lines.push(`- 외 ${turn.deniedFiles.length - 5}개`);
  return lines.length ? `[이어온] 실행되지 않은 작업:\n${lines.join('\n')}` : '';
}
const withNote = (answer, note) => [String(answer ?? '').trim(), note].filter(Boolean).join('\n\n');

// SDK turn 하나를 끝까지 읽는다. blocked에 든 item이 시작되면 그 자리에서 멈춘다.
// cwd를 주면 codex 프로세스가 시작되는 동안만 현재 폴더를 바꾼다(resume은 --cd가 os error 2로 실패한다).
// RC2: stop(멈춤 신호)이 오면 SDK 실행을 끊는다(codex 프로세스 종료) — 끝까지 읽기를 마치면 stopped로 알린다.
async function streamTurn(thread, question, { cwd, blocked: blockedTypes, stop }) {
  const controller = new AbortController();
  let stopped = false;
  const onStop = () => { stopped = true; controller.abort(); };
  if (stop?.aborted) onStop(); else stop?.addEventListener('abort', onStop, { once: true });
  const { events } = await thread.runStreamed(question, { signal: controller.signal });
  const iterator = events[Symbol.asyncIterator]();
  const previousCwd = process.cwd();
  let first;
  try {
    if (cwd) process.chdir(cwd);
    first = await iterator.next(); // SDK는 첫 이벤트를 기다릴 때 codex 프로세스를 띄운다.
  } finally {
    process.chdir(previousCwd);
  }
  const rest = { [Symbol.asyncIterator]: () => iterator };
  let answer = '';
  let returned = null;
  let blocked = null;
  let blockedWhat = null;
  const deniedFiles = [];
  let failed = false;
  let failMessage = null; // 실패 이유(한도 판별용, 기록하지 않음)
  let worked = false; // 사용자 메시지 말고 모델이 만든 항목이 하나라도 있었는지
  const all = (async function* () { if (!first.done) yield first.value; yield* rest; })();
  try {
  for await (const event of all) {
    if (event.type === 'thread.started') returned = event.thread_id;
    if (event.type === 'item.started' || event.type === 'item.completed') {
      if (blockedTypes.has(event.item.type)) { blocked = event.item.type; blockedWhat = event.item.tool ?? event.item.name ?? null; controller.abort(); break; }
      if (event.type === 'item.completed' && event.item.type === 'file_change' && event.item.status === 'failed') {
        for (const c of event.item.changes ?? []) if (c?.path && !deniedFiles.includes(c.path)) deniedFiles.push(String(c.path).replaceAll('\\', '/'));
      }
      if (event.type === 'item.completed' && event.item.type === 'agent_message') answer = event.item.text;
      if (!['user_message', 'error'].includes(event.item.type)) worked = true;
    }
    if (event.type === 'turn.failed') { failed = true; failMessage = event.error?.message ?? failMessage; }
    if (event.type === 'error') failMessage = event.message ?? failMessage;
  }
  } catch (e) {
    if (!stopped && !blocked) throw e; // 멈춤·막힘으로 끊은 것만 정상 종료로 본다
  } finally {
    stop?.removeEventListener?.('abort', onStop);
  }
  return { answer, returned, blocked, blockedWhat, deniedFiles, failed, failMessage, worked, stopped: stopped && !blocked };
}

// 새 세션(설계 NEW_SESSIONS N1). 서버가 보낸 프로필·작업 폴더를 연결부 설정으로 다시 검사한다.
// full은 이 PC의 설정 파일(sessionOverrides·allowFullFromChat)이 허용할 때만 쓴다.
function newSessionPlan(ns, cfg) {
  let checked;
  try { checked = checkNewSession(cfg, ns); } catch (e) { throw new EngineError(e.code, e.http); }
  const { profile, workspace } = checked;
  const { sandbox, network } = profile.codex;
  // 규칙 점검 2(2026-11-18 신산님): 명령은 샌드박스 안에서 허용(workspace = 작업 폴더 안만 쓰기, read_only = 쓰기 없음, 네트워크는 full만).
  // 샌드박스 밖 도구(MCP·동적 도구)만 멈추고, 멈춘 것·막힌 것은 답 끝에 알린다(잠그지 않음).
  const blocked = new Set(['mcp_tool_call', 'dynamic_tool_call']);
  return {
    workspace, blocked,
    options: { sandboxMode: sandbox, approvalPolicy: 'never', networkAccessEnabled: network,
      webSearchMode: network ? 'live' : 'disabled', skipGitRepoCheck: true },
  };
}

async function runNewSession({ sessionRef, question, newSession }, deps, { config, created }) {
  const plan = newSessionPlan(newSession, config);
  if (deps.extraDirs?.length && plan.options.sandboxMode === 'workspace-write') plan.options.additionalDirectories = deps.extraDirs; // WS1-b: 공유(쓰기) 폴더
  const { Codex } = await deps.loadSdk();
  const codexOpts = deps.env ? { env: deps.env } : undefined;
  let thread;
  let cwd;
  const pending = sessionRef.startsWith('pending:');
  if (pending) {
    mkdirSync(plan.workspace, { recursive: true });
    thread = new Codex(codexOpts).startThread({ ...plan.options, workingDirectory: plan.workspace });
  } else {
    // 서버 DB만 믿지 않는다. 이 연결부가 직접 만든 대화만 새 세션으로 재개한다.
    if (sessionRef === EXCLUDED || !created.has(sessionRef)) throw new EngineError('thread_not_allowed', 403);
    const outcome = deps.probe(sessionRef);
    if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(outcome)) {
      throw new EngineError(outcome === 'WRITER_LOCK_CONFLICT' ? 'desktop_holds_thread' : 'lock_check_failed', 409);
    }
    thread = new Codex(codexOpts).resumeThread(sessionRef, plan.options);
    cwd = plan.workspace;
  }
  const turn = await streamTurn(thread, question, { cwd, blocked: plan.blocked, stop: deps.signal });
  const threadId = pending ? (turn.returned ?? thread.id) : sessionRef;
  if (pending && threadId) created.add(threadId, newSession.name);
  if (turn.stopped) throw Object.assign(new StoppedError(), { sessionRef: threadId });
  // 멈추거나 실패해도 이미 만들어진 대화 ID는 서버에 남겨 같은 세션으로 이어 가게 한다.
  if (limitHit(turn)) throw Object.assign(new EngineError('usage_limit', 429), { sessionRef: threadId });
  if ((turn.failed && !turn.blocked) || !threadId || (turn.returned ?? thread.id) !== threadId) {
    throw Object.assign(new Error('turn_failed_or_thread_mismatch'), { sessionRef: threadId });
  }
  return { receipt: `codex:${threadId}`, answer: withNote(turn.answer, blockedNote(turn)), sessionRef: threadId };
}

// W1: 공유 서버가 보내는 승인 요청을 이어온 승인 카드로. 작업 모드가 아니면(approve 없음) 바로 거부 — 답하지 않아 차례가 멈추지 않게(W0 F5).
const APPROVAL_KIND = { 'item/commandExecution/requestApproval': 'command', 'item/fileChange/requestApproval': 'file', 'item/permissions/requestApproval': 'permissions' };
// 파일 수정 승인에 어느 파일인지(2026-11-18 실측: app-server 승인 요청에는 경로가 없어 카드가 "파일 수정"뿐 → 같은 차례의 fileChange 항목 경로를 붙임).
// roots(작업 폴더·공유 쓰기 폴더)를 알면 그 밖의 파일에 "작업 폴더 밖"을 표시한다. 3개까지 보이고 나머지는 개수만.
const normPath = (p) => String(p).replaceAll('\\', '/').replace(/\/+$/, '');
const inRoot = (p, root) => { const a = normPath(p).toLowerCase(); const b = normPath(root).toLowerCase(); return a === b || a.startsWith(b + '/'); };
export function fileChangeSummary(paths = [], roots = []) {
  const list = [...new Set(paths.filter((p) => typeof p === 'string' && p))];
  if (!list.length) return null;
  const mark = (p) => (roots.length && !roots.some((r) => r && inRoot(p, r)) ? `${normPath(p)} (작업 폴더 밖)` : normPath(p));
  const outside = roots.length ? list.filter((p) => !roots.some((r) => r && inRoot(p, r))).length : 0;
  const head = `파일 수정 ${list.length}개${outside ? ` — 작업 폴더 밖 ${outside}개` : ''}: `;
  return (head + list.slice(0, 3).map(mark).join(', ') + (list.length > 3 ? ` 외 ${list.length - 3}개` : '')).slice(0, 300);
}
export const approvalSummary = (method, params = {}) => {
  if (method === 'item/commandExecution/requestApproval') return String(params.command ?? '').slice(0, 300);
  if (method === 'item/fileChange/requestApproval') {
    const files = fileChangeSummary(params.changes ?? [], params.roots ?? []);
    const base = params.reason ?? (params.grantRoot ? `작업 폴더 밖 쓰기 요청: ${normPath(params.grantRoot)}` : null);
    return String([base, files].filter(Boolean).join(' · ') || '파일 수정(어느 파일인지 엔진이 알려 주지 않음)').slice(0, 300);
  }
  return String(params.reason ?? '권한 요청').slice(0, 300);
};

// 서버 요청 하나에 대한 답(JSON-RPC 응답 객체). 시험에서 바로 부른다.
// RC1: 허용되면 track({ approvalId, itemId, kind })으로 알려, 그 항목이 끝났을 때 실행 결과를 같은 승인에 잇는다.
export async function answerServerRequest(msg, threadId, approve, track = null) {
  const kind = APPROVAL_KIND[msg.method];
  if (!kind) return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported by ieon' } };
  const itemId = typeof msg.params?.itemId === 'string' ? msg.params.itemId : null;
  const d = approve && msg.params?.threadId === threadId
    ? await approve({ kind, summary: approvalSummary(msg.method, msg.params), cwd: msg.params?.cwd ?? null, itemId,
      onAllowed: (approvalId) => track?.({ approvalId, itemId, kind }) }).catch(() => 'decline')
    : 'decline';
  return { jsonrpc: '2.0', id: msg.id, result: { decision: d === 'accept' ? 'accept' : 'decline' } };
}

async function runShared(threadId, question, { endpoint, token, approve = null, signal = null }) {
  const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const pending = new Map();
  let nextId = 1;
  let turnId = null;
  let answer = '';
  let blocked = false;
  let blockedItem = null; // 끊은 항목(답 끝 알림용)
  let userMessages = 0;
  let turnError = null; // turn/completed의 실패 이유(한도 판별용)
  const usage = {};
  let finish;
  const done = new Promise((r) => { finish = r; });
  const call = (method, params) => {
    const id = nextId++;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    // 서버 → 이어온 요청(승인 등). 이 thread의 것만 사람에게 묻고, 나머지·작업 모드 아님은 거부/지원 안 함으로 답한다.
    if (msg.id !== undefined && msg.method) { answerServerRequest(msg, threadId, approve).then((r) => ws.send(JSON.stringify(r))).catch(() => {}); return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      return msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    const params = msg.params;
    if (!params || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) return;
    if (msg.method === 'item/started' || msg.method === 'item/completed') {
      if (BLOCKED_APP.has(params.item?.type) && !blocked) {
        blocked = true;
        const it = params.item;
        blockedItem = { type: it.type, what: it.type === 'commandExecution' ? String(it.command ?? '').slice(0, 120) : it.type === 'fileChange' ? (it.changes ?? []).map((c) => c?.path).filter(Boolean).slice(0, 3).join(', ') : (it.tool ?? null) };
        call('turn/interrupt', { threadId, turnId }).catch(() => {});
      }
      if (msg.method === 'item/completed' && params.item?.type === 'agentMessage') answer = params.item.text ?? answer;
      // 이 turn에 우리 질문 외의 사용자 메시지가 들어오면(TUI에서 Enter = steer) 답이 섞였을 수 있다.
      if (msg.method === 'item/started' && params.item?.type === 'userMessage') userMessages += 1;
    }
    // 사용량: 이 turn의 모델 호출마다 오는 last 값을 더한다(total은 thread 누적값이라 쓰지 않는다).
    if (msg.method === 'thread/tokenUsage/updated' && turnId && params.turnId === turnId) {
      const last = params.tokenUsage?.last ?? {};
      for (const k of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens']) usage[k] = (usage[k] ?? 0) + (last[k] ?? 0);
    }
    if (msg.method === 'turn/completed') { turnError = params.turn?.error ?? null; finish(params.turn?.status ?? null); }
  };
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new EngineError('shared_server_down', 503)); });
    await call('initialize', { clientInfo: { name: 'ieon-connector', version: '0.1.0' } });
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
    const read = await call('thread/read', { threadId, includeTurns: false });
    const status = read.thread?.status?.type;
    // reject_busy: 사람이 쓰는 중이면 합류(steer)하지 않고 거부한다.
    if (status !== 'idle') throw new EngineError(status === 'notLoaded' ? 'thread_not_open' : 'thread_busy', 409);
    await call('thread/resume', { threadId, excludeTurns: true });
    const started = await call('turn/start', { threadId, clientUserMessageId: randomUUID(), input: [{ type: 'text', text: question, text_elements: [] }] });
    turnId = started.turn?.id ?? null;
    // RC2: 멈춤 신호 → 그 차례만 끊기(turn/interrupt). 엔진이 interrupted로 끝냈다고 알려 와야 중지됨.
    const interrupt = () => { if (turnId) call('turn/interrupt', { threadId, turnId }).catch(() => {}); };
    if (signal?.aborted) interrupt(); else signal?.addEventListener('abort', interrupt, { once: true });
    const status2 = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 180000))]).finally(() => signal?.removeEventListener?.('abort', interrupt));
    if (status2 === 'interrupted' && signal?.aborted && !blocked) throw new StoppedError();
    // 규칙 점검 1: 질문 모드에서 엔진이 도구를 쓰려 하면 그 차례를 끊고, 잠그지 않고 답 끝에 알린다(시작됐을 수 있음).
    if (blocked) {
      const note = `[이어온] 질문 모드라 실행하려던 작업을 끊었어요:\n- ${TOOL_WORD[blockedItem?.type] ?? '도구'}${blockedItem?.what ? ' ' + blockedItem.what : ''} — 끊기 전에 시작됐을 수 있어요(원래 세션에서 확인). 실행이 필요하면 작업 모드로 보내세요.`;
      return { receipt: `codex:${threadId}:${turnId}`, answer: withNote(answer, note), usage: Object.keys(usage).length ? usage : null };
    }
    if (status2 === 'failed' && !answer && isUsageLimit(JSON.stringify(turnError))) throw new EngineError('usage_limit', 429);
    if (status2 !== 'completed') throw new Error(`turn_${status2}`);
    // 2026-10-30 실측: 이어온 turn 중 TUI 입력이 합류해 답이 사람 입력에 대한 답("확인")으로 바뀌었다.
    // 모델은 실행됐으므로 실패가 아니라 결과 불명으로 넘기고, 섞였을 수 있는 답은 이어온 답으로 내보내지 않는다.
    if (userMessages > 1) throw Object.assign(new Error('turn_joined_by_other_input'), { unknownCode: 'turn_joined_by_other_input' });
    return { receipt: `codex:${threadId}:${turnId}`, answer, usage: Object.keys(usage).length ? usage : null };
  } finally {
    ws.close();
  }
}

// A2: 계정이 없거나 로그인 전이면 모델을 부르기 전에 거절(어느 계정인지 모르는 채로 다른 계정 사용량을 쓰지 않게).
function accountEnv(opts, threadId) {
  if (!opts.accountEnv) return null;
  try { return opts.accountEnv(threadId); } catch (e) { throw new EngineError(e.message, e.http ?? 409); }
}

// --- W2 작업 모드(WORK_AND_VOICE A1·WV1): Codex app-server 차례 하나 — 승인 카드로 묻고(이 thread만, 이번 한 번만), 쓰기는 작업 폴더 안,
// 인터넷 막음, 승인 판단은 늘 사람(approvalsReviewer: user). 자동 승인(never·acceptForSession·auto_review) 없음.
// transport: { send(obj), onMessage(fn), close() } — 동시 사용은 공유 서버(WebSocket), 번갈아 쓰기는 질문할 때만 띄운 app-server(stdio).
export const WORK_POLICY = Object.freeze({ approvalPolicy: 'untrusted', approvalsReviewer: 'user' });
// SV1: 엔진 칸 컨테이너 안에서만 켜지는 표시(엔진 칸 compose가 넣음). PC·허브 자체에서는 꺼져 있다.
export const containerBoundary = (env = process.env) => env.IEON_CONTAINER_BOUNDARY === '1';

// RC1: 끝난 엔진 항목(명령 실행·파일 수정)을 실행 결과로. 승인 없이 지나간 항목·거부된 항목·진행 중은 null(보고하지 않음).
// 종료 코드가 0이 아니면 실패로 본다(엔진이 completed라고 해도 명령은 실패한 것).
const ITEM_KIND = { commandExecution: 'command', fileChange: 'file' };
export function itemOutcome(item) {
  const kind = ITEM_KIND[item?.type];
  if (!kind || typeof item.id !== 'string') return null;
  const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
  if (item.status === 'failed') return { kind, itemId: item.id, outcome: 'failed', exitCode };
  if (item.status === 'completed') return { kind, itemId: item.id, outcome: exitCode !== null && exitCode !== 0 ? 'failed' : 'completed', exitCode };
  return null;
}
// 허용한 승인 목록에서 그 항목의 승인을 찾는다 — 항목 ID가 정확히 같은 것만(순서로 짐작하지 않는다).
export function matchAllowed(allowed, done) {
  return allowed.find((a) => !a.reported && a.itemId && a.itemId === done.itemId && a.kind === done.kind) ?? null;
}

export async function appServerTurn(transport, { threadId, question, cwd, extraRoots = [], approve, approvalResult = null, checkIdle = false, timeoutMs = 30 * 60_000, signal = null }) {
  const allowed = []; // 이번 차례에 허용한 승인: { approvalId, itemId, kind, reported }
  const track = (a) => {
    allowed.push(a);
    // 권한 추가는 실행 항목이 따로 없다 — 허용을 전달한 것이 곧 결과
    if (a.kind === 'permissions') { a.reported = true; approvalResult?.(a.approvalId, { outcome: 'completed', itemId: a.itemId })?.catch?.(() => {}); }
  };
  const pending = new Map(); let nextId = 1; let turnId = null; let answer = ''; let userMessages = 0; let turnError = null; let worked = false;
  const usage = {}; let finish; const done = new Promise((r) => { finish = r; });
  const files = new Map(); // fileChange 항목 ID → 고치려는 파일 경로(승인 카드에 보이기)
  const roots = [cwd, ...(extraRoots ?? [])].filter(Boolean);
  const call = (method, params) => { const id = nextId++; transport.send({ jsonrpc: '2.0', id, method, params }); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); };
  // 규칙 점검 7: 승인 카드를 기다리는 동안은 차례 시간 제한을 멈추고, 답이 오면 다시 잰다(승인 시간을 길게 해도 차례가 먼저 끝나지 않게).
  let timer = null; let timeUp; const timeout = new Promise((r) => { timeUp = r; }); let waiting = 0; let running = false;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => timeUp('timeout'), timeoutMs); };
  const approveT = approve && (async (x) => { waiting += 1; clearTimeout(timer); try { return await approve(x); } finally { waiting -= 1; if (!waiting && running) arm(); } });
  transport.onMessage((msg) => {
    if (msg.id !== undefined && !msg.method && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); return msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    if (msg.id !== undefined && msg.method) {
      const req = msg.method === 'item/fileChange/requestApproval' ? { ...msg, params: { ...msg.params, changes: files.get(msg.params?.itemId) ?? [], roots } } : msg;
      answerServerRequest(req, threadId, approveT, track).then((r) => transport.send(r)).catch(() => {}); return;
    }
    const params = msg.params;
    if (!params || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) return;
    if (['item/started', 'item/completed'].includes(msg.method) && params.item?.type === 'fileChange') files.set(params.item.id, (params.item.changes ?? []).map((c) => c?.path));
    if (msg.method === 'item/fileChange/patchUpdated' && params.itemId) files.set(params.itemId, (params.changes ?? []).map((c) => c?.path));
    if (msg.method === 'item/started' && params.item?.type === 'userMessage') userMessages += 1;
    if (msg.method === 'item/started' && ['commandExecution', 'fileChange'].includes(params.item?.type)) worked = true;
    if (msg.method === 'item/completed') {
      const done = itemOutcome(params.item);
      const a = done && matchAllowed(allowed, done);
      if (a) { a.reported = true; approvalResult?.(a.approvalId, { outcome: done.outcome, exitCode: done.exitCode, itemId: done.itemId })?.catch?.(() => {}); }
    }
    if (msg.method === 'item/completed' && params.item?.type === 'agentMessage') answer = params.item.text ?? answer;
    if (msg.method === 'thread/tokenUsage/updated' && turnId && params.turnId === turnId) {
      const last = params.tokenUsage?.last ?? {};
      for (const k of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens']) usage[k] = (usage[k] ?? 0) + (last[k] ?? 0);
    }
    if (msg.method === 'turn/completed') { turnError = params.turn?.error ?? null; finish(params.turn?.status ?? null); }
  });
  try {
    await call('initialize', { clientInfo: { name: 'ieon-connector', version: '0.1.0' } });
    transport.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    if (checkIdle) {
      const read = await call('thread/read', { threadId, includeTurns: false });
      const status = read.thread?.status?.type;
      if (status !== 'idle') throw new EngineError(status === 'notLoaded' ? 'thread_not_open' : 'thread_busy', 409);
    }
    // SV1 엔진 칸(IEON_CONTAINER_BOUNDARY=1): 컨테이너가 경계 — 엔진 샌드박스(bwrap)가 Docker 안에서 안 되므로 끄되, 명령·파일 수정은 여전히 승인 카드로 묻는다
    const boundary = containerBoundary();
    await call('thread/resume', { threadId, excludeTurns: true, cwd, sandbox: boundary ? 'danger-full-access' : 'workspace-write', ...WORK_POLICY });
    const started = await call('turn/start', { threadId, cwd, clientUserMessageId: randomUUID(), ...WORK_POLICY,
      sandboxPolicy: boundary ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite', writableRoots: [cwd, ...(extraRoots ?? [])], networkAccess: false },
      input: [{ type: 'text', text: question, text_elements: [] }] });
    turnId = started.turn?.id ?? null;
    // RC2: 멈춤 신호가 오면 그 차례를 끊는다(turn/interrupt). 엔진이 interrupted로 끝냈다고 알려 와야 중지됨.
    const interrupt = () => { if (turnId) call('turn/interrupt', { threadId, turnId }).catch(() => {}); };
    if (signal?.aborted) interrupt(); else signal?.addEventListener('abort', interrupt, { once: true });
    running = true; if (!waiting) arm(); // 차례가 끝나면 시간 제한 타이머를 지운다(남으면 30분 동안 쌓임)
    const status = await Promise.race([done, timeout]).finally(() => { running = false; clearTimeout(timer); signal?.removeEventListener?.('abort', interrupt); });
    if (status === 'interrupted' && signal?.aborted) throw new StoppedError();
    if (status === 'failed' && !answer && !worked && isUsageLimit(JSON.stringify(turnError))) throw new EngineError('usage_limit', 429);
    if (status !== 'completed') throw new Error(`turn_${status}`);
    if (userMessages > 1) throw Object.assign(new Error('turn_joined_by_other_input'), { unknownCode: 'turn_joined_by_other_input' });
    return { receipt: `codex:${threadId}:${turnId}`, answer, usage: Object.keys(usage).length ? usage : null };
  } finally { transport.close(); }
}

// 번갈아 쓰기의 작업 모드: Desktop 잠금 판별 → 질문할 때만 app-server(stdio, 포트 없음)를 띄워 차례 하나 → 닫음.
const require0 = createRequire(import.meta.url);
export function stdioAppServer({ env, cwd, spawnImpl = spawn }) {
  const child = spawnImpl(process.execPath, [require0.resolve('@openai/codex/bin/codex.js'), 'app-server'], { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buf = ''; let handler = () => {};
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; try { handler(JSON.parse(line)); } catch { /* 형식이 틀린 줄은 무시 */ } } });
  return { send: (m) => child.stdin.write(JSON.stringify(m) + '\n'), onMessage: (fn) => { handler = fn; }, close: () => child.kill() };
}
// WS1-a: 공유(쓰기) 폴더 중 지금 있는 것만 writableRoots에 더한다(없어진 폴더는 빼고 — 작업 폴더 밖으로 넓히지 않음)
function liveRoots(list) { return (list ?? []).filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } }); }
function workDir(dir) {
  if (!dir) throw new EngineError('work_dir_required', 409); // 작업 모드는 작업 폴더가 정해진 대화만(쓰기를 그 안으로)
  try { if (!statSync(dir).isDirectory()) throw new Error(); } catch { throw new EngineError('work_dir_missing', 409); }
  return dir;
}
async function runAlternateWork(threadId, question, deps) {
  const cwd = workDir(deps.workingDirectory);
  const outcome = deps.probe(threadId);
  if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(outcome)) throw new EngineError(outcome === 'WRITER_LOCK_CONFLICT' ? 'desktop_holds_thread' : 'lock_check_failed', 409);
  const transport = (deps.appServer ?? stdioAppServer)({ env: deps.env, cwd });
  return appServerTurn(transport, { threadId, question, cwd, extraRoots: deps.extraRoots, approve: deps.approve, approvalResult: deps.approvalResult, timeoutMs: deps.workTimeoutMs, signal: deps.signal });
}
function wsTransport(endpoint, token, WS = globalThis.WebSocket) {
  const ws = new WS(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  let handler = () => {}; const queue = [];
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new EngineError('shared_server_down', 503)); });
  ws.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch { /* 무시 */ } };
  opened.then(() => { for (const m of queue.splice(0)) ws.send(m); }).catch(() => {});
  return { opened, send: (m) => { const s = JSON.stringify(m); ws.readyState === 1 ? ws.send(s) : queue.push(s); }, onMessage: (fn) => { handler = fn; }, close: () => ws.close() };
}

// opts: { live, allowlist, modes: {threadId: 'alternate'|'shared_server'}, shared: {endpoint, tokenFile}, probe?, loadSdk?,
//         newSessions?: { config(loadNewSessionsConfig 결과), created: { has(id), add(id, name) } },
//         accountEnv?: (threadId|null) => env|null — A2 이어온 전용 계정. null이면 PC 기본 로그인. 공유 서버 방식은 그 서버의 로그인이라 쓰지 않는다 }
export function codexThreadAdapter(opts) {
  const deps = { probe: opts.probe ?? lockProbe, loadSdk: opts.loadSdk ?? (() => import('@openai/codex-sdk')) };
  return {
    engine: 'codex_thread',
    async run({ sessionRef: threadId, question, connectMode, newSession, workMode = false }, { approve = null, approvalResult = null, signal = null } = {}) {
      if (newSession) {
        if (!opts.newSessions) throw new EngineError('new_sessions_not_configured', 503);
        if (!opts.live) throw new EngineError('live_disabled', 503);
        return runNewSession({ sessionRef: threadId, question, newSession }, { ...deps, env: accountEnv(opts, null), signal, extraDirs: liveRoots(opts.newSessionDirs?.(newSession.name)) }, opts.newSessions);
      }
      if (threadId === EXCLUDED || !opts.allowlist.includes(threadId)) throw new EngineError('thread_not_allowed', 403);
      if (!opts.live) throw new EngineError('live_disabled', 503);
      // 서버가 보낸 세션 설정이 우선이고, 없으면 연결부 설정·기본값(alternate) 순으로 쓴다.
      const mode = connectMode ?? opts.modes?.[threadId] ?? 'alternate';
      if (mode === 'shared_server') {
        if (!opts.shared?.endpoint || !opts.shared?.tokenFile) throw new EngineError('shared_server_not_configured', 503);
        const token = readFileSync(opts.shared.tokenFile, 'utf8').trim();
        if (workMode) { // W2: 작업 모드 — 같은 공유 서버에서 승인 카드로
          const cwd = workDir(opts.workingDirectories?.[threadId]);
          const tr = (opts.wsTransport ?? wsTransport)(opts.shared.endpoint, token);
          await tr.opened;
          return appServerTurn(tr, { threadId, question, cwd, extraRoots: liveRoots(opts.writableExtra?.[threadId]), approve, approvalResult, checkIdle: true, timeoutMs: opts.workTimeoutMs, signal });
        }
        // 작업 모드가 아니면 승인 요청이 와도 바로 거부(지금처럼 읽기 전용)
        return runShared(threadId, question, { endpoint: opts.shared.endpoint, token, approve: null, signal });
      }
      if (workMode) return runAlternateWork(threadId, question, { ...deps, env: accountEnv(opts, threadId), workingDirectory: opts.workingDirectories?.[threadId], extraRoots: liveRoots(opts.writableExtra?.[threadId]), approve, approvalResult, appServer: opts.appServer, workTimeoutMs: opts.workTimeoutMs, signal });
      return runAlternate(threadId, question, { ...deps, env: accountEnv(opts, threadId), workingDirectory: opts.workingDirectories?.[threadId], signal });
    },
  };
}