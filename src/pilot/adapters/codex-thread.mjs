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
import { EngineError } from '../contracts.mjs';

const EXCLUDED = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const BLOCKED_SDK = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);
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
  const turn = await streamTurn(thread, question, { cwd: deps.workingDirectory, blocked: BLOCKED_SDK });
  if (turn.blocked) return { approvalRequired: true };
  if (limitHit(turn)) throw new EngineError('usage_limit', 429);
  if (turn.failed || (turn.returned ?? thread.id) !== threadId) throw new Error('turn_failed_or_thread_mismatch');
  return { receipt: `codex:${threadId}`, answer: turn.answer };
}

// SDK turn 하나를 끝까지 읽는다. blocked에 든 item이 시작되면 그 자리에서 멈춘다.
// cwd를 주면 codex 프로세스가 시작되는 동안만 현재 폴더를 바꾼다(resume은 --cd가 os error 2로 실패한다).
async function streamTurn(thread, question, { cwd, blocked: blockedTypes }) {
  const controller = new AbortController();
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
  let failed = false;
  let failMessage = null; // 실패 이유(한도 판별용, 기록하지 않음)
  let worked = false; // 사용자 메시지 말고 모델이 만든 항목이 하나라도 있었는지
  const all = (async function* () { if (!first.done) yield first.value; yield* rest; })();
  for await (const event of all) {
    if (event.type === 'thread.started') returned = event.thread_id;
    if (event.type === 'item.started' || event.type === 'item.completed') {
      if (blockedTypes.has(event.item.type)) { blocked = event.item.type; controller.abort(); break; }
      if (event.type === 'item.completed' && event.item.type === 'agent_message') answer = event.item.text;
      if (!['user_message', 'error'].includes(event.item.type)) worked = true;
    }
    if (event.type === 'turn.failed') { failed = true; failMessage = event.error?.message ?? failMessage; }
    if (event.type === 'error') failMessage = event.message ?? failMessage;
  }
  return { answer, returned, blocked, failed, failMessage, worked };
}

// 새 세션(설계 NEW_SESSIONS N1). 서버가 보낸 프로필·작업 폴더를 연결부 설정으로 다시 검사한다.
// full은 이 PC의 설정 파일(sessionOverrides·allowFullFromChat)이 허용할 때만 쓴다.
function newSessionPlan(ns, cfg) {
  let checked;
  try { checked = checkNewSession(cfg, ns); } catch (e) { throw new EngineError(e.code, e.http); }
  const { profile, workspace } = checked;
  const { sandbox, network } = profile.codex;
  const blocked = new Set(['mcp_tool_call', 'dynamic_tool_call']);
  if (sandbox === 'read-only') blocked.add('file_change');
  // 명령 실행·웹 검색은 네트워크까지 연 프로필(full)에서만 허용한다. workspace는 파일 변경까지만.
  if (!network) { blocked.add('command_execution'); blocked.add('web_search'); }
  return {
    workspace, blocked,
    options: { sandboxMode: sandbox, approvalPolicy: 'never', networkAccessEnabled: network,
      webSearchMode: network ? 'live' : 'disabled', skipGitRepoCheck: true },
  };
}

async function runNewSession({ sessionRef, question, newSession }, deps, { config, created }) {
  const plan = newSessionPlan(newSession, config);
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
  const turn = await streamTurn(thread, question, { cwd, blocked: plan.blocked });
  const threadId = pending ? (turn.returned ?? thread.id) : sessionRef;
  if (pending && threadId) created.add(threadId, newSession.name);
  // 멈추거나 실패해도 이미 만들어진 대화 ID는 서버에 남겨 같은 세션으로 이어 가게 한다.
  if (turn.blocked) return { approvalRequired: true, sessionRef: threadId };
  if (limitHit(turn)) throw Object.assign(new EngineError('usage_limit', 429), { sessionRef: threadId });
  if (turn.failed || !threadId || (turn.returned ?? thread.id) !== threadId) {
    throw Object.assign(new Error('turn_failed_or_thread_mismatch'), { sessionRef: threadId });
  }
  return { receipt: `codex:${threadId}`, answer: turn.answer, sessionRef: threadId };
}

// W1: 공유 서버가 보내는 승인 요청을 이어온 승인 카드로. 작업 모드가 아니면(approve 없음) 바로 거부 — 답하지 않아 차례가 멈추지 않게(W0 F5).
const APPROVAL_KIND = { 'item/commandExecution/requestApproval': 'command', 'item/fileChange/requestApproval': 'file', 'item/permissions/requestApproval': 'permissions' };
export const approvalSummary = (method, params = {}) => {
  if (method === 'item/commandExecution/requestApproval') return String(params.command ?? '').slice(0, 300);
  if (method === 'item/fileChange/requestApproval') return String(params.reason ?? (params.grantRoot ? '작업 폴더 밖 쓰기 요청' : '파일 수정')).slice(0, 300);
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

async function runShared(threadId, question, { endpoint, token, approve = null }) {
  const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const pending = new Map();
  let nextId = 1;
  let turnId = null;
  let answer = '';
  let blocked = false;
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
    const status2 = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 180000))]);
    if (blocked) return { approvalRequired: true };
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

export async function appServerTurn(transport, { threadId, question, cwd, approve, approvalResult = null, checkIdle = false, timeoutMs = 30 * 60_000 }) {
  const allowed = []; // 이번 차례에 허용한 승인: { approvalId, itemId, kind, reported }
  const track = (a) => {
    allowed.push(a);
    // 권한 추가는 실행 항목이 따로 없다 — 허용을 전달한 것이 곧 결과
    if (a.kind === 'permissions') { a.reported = true; approvalResult?.(a.approvalId, { outcome: 'completed', itemId: a.itemId })?.catch?.(() => {}); }
  };
  const pending = new Map(); let nextId = 1; let turnId = null; let answer = ''; let userMessages = 0; let turnError = null; let worked = false;
  const usage = {}; let finish; const done = new Promise((r) => { finish = r; });
  const call = (method, params) => { const id = nextId++; transport.send({ jsonrpc: '2.0', id, method, params }); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); };
  transport.onMessage((msg) => {
    if (msg.id !== undefined && !msg.method && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); return msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    if (msg.id !== undefined && msg.method) { answerServerRequest(msg, threadId, approve, track).then((r) => transport.send(r)).catch(() => {}); return; }
    const params = msg.params;
    if (!params || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) return;
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
    await call('thread/resume', { threadId, excludeTurns: true, cwd, sandbox: 'workspace-write', ...WORK_POLICY });
    const started = await call('turn/start', { threadId, cwd, clientUserMessageId: randomUUID(), ...WORK_POLICY,
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
      input: [{ type: 'text', text: question, text_elements: [] }] });
    turnId = started.turn?.id ?? null;
    let timer; // 차례가 끝나면 시간 제한 타이머를 지운다(남으면 30분 동안 쌓임)
    const status = await Promise.race([done, new Promise((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); })]).finally(() => clearTimeout(timer));
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
  return appServerTurn(transport, { threadId, question, cwd, approve: deps.approve, approvalResult: deps.approvalResult, timeoutMs: deps.workTimeoutMs });
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
    async run({ sessionRef: threadId, question, connectMode, newSession, workMode = false }, { approve = null, approvalResult = null } = {}) {
      if (newSession) {
        if (!opts.newSessions) throw new EngineError('new_sessions_not_configured', 503);
        if (!opts.live) throw new EngineError('live_disabled', 503);
        return runNewSession({ sessionRef: threadId, question, newSession }, { ...deps, env: accountEnv(opts, null) }, opts.newSessions);
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
          return appServerTurn(tr, { threadId, question, cwd, approve, approvalResult, checkIdle: true, timeoutMs: opts.workTimeoutMs });
        }
        // 작업 모드가 아니면 승인 요청이 와도 바로 거부(지금처럼 읽기 전용)
        return runShared(threadId, question, { endpoint: opts.shared.endpoint, token, approve: null });
      }
      if (workMode) return runAlternateWork(threadId, question, { ...deps, env: accountEnv(opts, threadId), workingDirectory: opts.workingDirectories?.[threadId], approve, approvalResult, appServer: opts.appServer, workTimeoutMs: opts.workTimeoutMs });
      return runAlternate(threadId, question, { ...deps, env: accountEnv(opts, threadId), workingDirectory: opts.workingDirectories?.[threadId] });
    },
  };
}