// S2.2 SINSAN 연결부. PC가 서버로 먼저 연결해 작업을 가져가고 결과를 보고한다(PC 수신 포트 없음).
// 사용: node src/pilot/connector.mjs <configPath>
// 실행 전 request_id를 로컬 receipt에 내구 저장하고, 이미 본 요청은 다시 실행하지 않는다.
import { appendFileSync, existsSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EngineError, StoppedError } from './contracts.mjs';
import { accountsDirFor, accountLabel, codexAccountId, codexAccounts, codexHomeOf, desktopCodexHome, PC_DEFAULT, readCodexCompat } from './accounts.mjs';
import { createCodexLogin } from './codex-login.mjs';
import { claudeKind } from './claude-login.mjs';
import { claudeAccountHealth } from './claude-accounts.mjs';
import { agyAccountHealth } from './agy-accounts.mjs';
import { grokAccountHealth } from './grok-accounts.mjs';

// P3: 허브 주소 검사. https·http(규칙 점검 8, 2026-11-18 신산님 — 도메인 없는 서버 설치형도 PC를 붙일 수 있게. http는 암호화가 안 돼 화면에 경고).
// 사용자 정보·쿼리·조각은 거절한다.
export function validateServerUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '')); } catch { throw new Error('bad_server_url'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('bad_server_url');
  if (u.username || u.password || u.search || u.hash) throw new Error('bad_server_url');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// 명령줄: <설정> [--server <허브 주소>] [--token-file <기기 토큰 파일>]. 주어지면 설정 파일 값 대신 쓴다.
export function connectorOptions(config, argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const server = opt('--server');
  return {
    serverUrl: server ? validateServerUrl(server) : config.serverUrl,
    deviceTokenFile: opt('--token-file') ?? config.deviceTokenFile,
    receiptPath: server ? (config.hubReceiptPath ?? config.receiptPath) : config.receiptPath,
  };
}

function receiptLog(path) {
  const seen = new Set(existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).requestId) : []);
  return {
    has: (id) => seen.has(id),
    add(id) {
      appendFileSync(path, JSON.stringify({ requestId: id, at: new Date().toISOString() }) + '\n');
      const fd = openSync(path, 'r+'); fsyncSync(fd); closeSync(fd);
      seen.add(id);
    },
  };
}

// 작업 하나를 가져와 실행·보고한다. 작업이 없으면 false.
// A2: HTTP 헤더에는 한글을 못 실으므로(계정 이름표) ASCII 밖 글자는 JSON \u 표기로 바꿔 보낸다. 서버는 JSON.parse로 그대로 읽는다.
export const healthHeader = (state) => JSON.stringify(state).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// W1: 엔진이 묻는 승인(명령 실행·파일 수정)을 서버에 올리고 사람이 허용·거부할 때까지 기다린다. 15분이 지나면 서버가 거부로 바꾼다.
// 이어온은 "이번만 허용"과 "거부"만 쓴다(항상 허용·자동 승인 없음). 서버에 닿지 못하거나 모르는 답이면 거부.
export function approver({ baseUrl, headers, requestId, pollMs = 2000, maxMs = null, log = () => {} }) {
  // RC1: 허용되면 onAllowed(approvalId)를 부른다(어댑터가 그 항목의 실행 결과를 이 승인에 잇기 위해). 돌려주는 값은 전처럼 accept/decline.
  return async ({ kind, summary, cwd, itemId, onAllowed }) => {
    try {
      const r = await fetch(`${baseUrl}/v1/device/approvals`, { method: 'POST', headers, body: JSON.stringify({ requestId, kind, summary, cwd, itemId }) });
      if (r.status !== 201) return 'decline';
      const { approvalId, ttlMs } = await r.json();
      log({ event: 'approval_wait', kind });
      const end = Date.now() + (maxMs ?? (Number.isFinite(ttlMs) ? ttlMs + 60_000 : 16 * 60_000)); // 규칙 점검 7: 웹에서 정한 승인 시간 + 1분(시험은 maxMs로 줄임)
      while (Date.now() < end) {
        await new Promise((ok) => setTimeout(ok, pollMs));
        const s = await fetch(`${baseUrl}/v1/device/approvals/${approvalId}`, { headers }).then((x) => (x.status === 200 ? x.json() : null)).catch(() => null);
        if (!s || s.status === 'pending') continue;
        log({ event: 'approval_done', kind, status: s.status });
        if (s.status !== 'allowed') return 'decline';
        try { onAllowed?.(approvalId); } catch { /* 결과 연결을 못 해도 허용은 그대로 전달 */ }
        return 'accept';
      }
    } catch { /* 닿지 못하면 거부 */ }
    return 'decline';
  };
}

// RC1: 허용한 항목이 실제로 어떻게 끝났는지 서버에 알린다(완료·실패와 종료 코드만). 못 보내면 서버가 차례 끝에 결과 불명으로 둔다.
export function approvalReporter({ baseUrl, headers, log = () => {} }) {
  return async (approvalId, { outcome, exitCode = null, itemId = null }) => {
    try {
      const r = await fetch(`${baseUrl}/v1/device/approvals/${approvalId}/result`, { method: 'POST', headers, body: JSON.stringify({ outcome, exitCode, itemId }) });
      log({ event: 'approval_result', outcome, http: r.status });
      return r.status === 200;
    } catch { return false; }
  };
}

// RC2: 실행하는 동안 서버에 "이 요청을 멈출까?"를 묻고, 멈추라고 하면 엔진에 멈춤 신호를 보낸다. 신호만 보낼 뿐 결과는 어댑터가 확인한다.
export function stopWatcher({ baseUrl, headers, requestId, pollMs = 2000, log = () => {} }) {
  const controller = new AbortController();
  let timer = null; let closed = false;
  const tick = async () => {
    if (closed) return;
    const r = await fetch(`${baseUrl}/v1/device/jobs/${requestId}/control`, { headers }).then((x) => (x.status === 200 ? x.json() : null)).catch(() => null);
    if (closed) return;
    if (r?.stop === true) { log({ event: 'stop_requested', requestId }); controller.abort(); return; }
    timer = setTimeout(tick, pollMs);
  };
  timer = setTimeout(tick, pollMs);
  return { signal: controller.signal, close() { closed = true; clearTimeout(timer); } };
}

export async function pollOnce({ baseUrl, deviceToken, adapters, receipts, health, log = () => {}, approvalPollMs, stopPollMs, reportTries, reportRetryMs }) {
  const headers = { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' };
  // 엔진 상태(값만, 인증 정보 없음)를 작업 조회에 실어 보낸다. 서버는 이를 보고 꺼진 엔진으로의 질문을 미리 거절한다.
  const state = health ? await health() : null;
  const res = await fetch(`${baseUrl}/v1/device/jobs`, { headers: state ? { ...headers, 'x-ieon-health': healthHeader(state) } : headers });
  if (res.status === 204) return false;
  if (res.status === 429) throw Object.assign(new Error('poll_429'), { retryAfterMs: 1000 * (Number(res.headers.get('retry-after')) || 30) });
  if (res.status !== 200) throw new Error(`poll_${res.status}`);
  const job = await res.json();
  // 규칙 점검 3: 서버가 다시 켜지는 중이면(연결 실패·5xx) 잠시 뒤 다시 보낸다(약 5분까지). 같은 결과를 보내므로 엔진은 다시 돌리지 않는다.
  const report = async (outcome) => {
    for (let i = 0; ; i++) {
      const r = await fetch(`${baseUrl}/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers, body: JSON.stringify(outcome) }).catch(() => null);
      if ((r && r.status < 500) || i >= (reportTries ?? 12) - 1) return r;
      log({ event: 'report_retry', requestId: job.requestId, status: r?.status ?? 0 });
      await new Promise((ok) => setTimeout(ok, Math.min(30_000, (reportRetryMs ?? 2000) * 2 ** i)));
    }
  };

  if (receipts.has(job.requestId)) {
    log({ event: 'duplicate_job', requestId: job.requestId });
    await report({ status: 'unknown', errorCode: 'already_seen' });
    return true;
  }
  const adapter = adapters[job.engine];
  if (!adapter) {
    await report({ status: 'failed', errorCode: 'engine_not_configured', http: 503 });
    return true;
  }
  receipts.add(job.requestId);
  let outcome;
  const watch = stopWatcher({ baseUrl, headers, requestId: job.requestId, log, ...(stopPollMs ? { pollMs: stopPollMs } : {}) });
  // 엔진 실행을 시작한다고 서버에 알린다(화면에 "처리 중"). 기다리지 않고, 실패해도 실행은 계속(예전 서버는 404).
  fetch(`${baseUrl}/v1/device/jobs/${job.requestId}/running`, { method: 'POST', headers, body: '{}' }).catch(() => {});
  try {
    const result = await adapter.run({ engine: job.engine, sessionRef: job.sessionRef, question: job.question, requestId: job.requestId,
      connectMode: job.connectMode, newSession: job.newSession, workMode: job.workMode === true },
      { approve: approver({ baseUrl, headers, requestId: job.requestId, log, ...(approvalPollMs ? { pollMs: approvalPollMs } : {}) }),
        approvalResult: approvalReporter({ baseUrl, headers, log }), signal: watch.signal });
    outcome = result.approvalRequired ? { status: 'approval_required' }
      : { status: 'completed', receipt: result.receipt ?? null, answer: result.answer ?? null, usage: result.usage ?? null };
    if (result.sessionRef) outcome.sessionRef = result.sessionRef;
  } catch (error) {
    // RC2: 엔진 차례가 실제로 멈춘 것을 어댑터가 확인한 경우만 중지됨. 멈춤 신호를 보냈는데 확인하지 못하면 결과 불명.
    outcome = error instanceof StoppedError ? { status: 'cancelled', errorCode: 'stopped_by_user' }
      : error instanceof EngineError
      ? { status: 'failed', errorCode: error.code, http: error.http }
      : { status: 'unknown', errorCode: watch.signal.aborted ? 'stop_unconfirmed' : (error.unknownCode ?? 'result_unknown') };
    // 새 세션이 실행 도중 실패해도 이미 만들어진 엔진 세션 ID는 서버에 알린다.
    if (error.sessionRef) outcome.sessionRef = error.sessionRef;
  } finally {
    watch.close();
  }
  log({ event: 'job_done', requestId: job.requestId, status: outcome.status, errorCode: outcome.errorCode, usage: outcome.usage });
  await report(outcome);
  return true;
}

export async function runConnector({ pollMs = 700, signal, ...opts }) { // 2026-11-23: 2초 → 0.7초(질문 대기 줄이기, 허브 한도 1분 240번 안)
  let announced = false; // RC4: 켜졌음을 서버에 한 번 알린다(이 프로세스가 처리하던 질문은 없으므로 서버가 '처리 중'을 결과 불명으로 정리)
  while (!signal?.aborted) {
    try {
      if (!announced) {
        const r = await fetch(`${opts.baseUrl}/v1/device/restarted`, { method: 'POST', headers: { authorization: `Bearer ${opts.deviceToken}`, 'content-type': 'application/json' }, body: '{}' });
        if (r.ok || r.status === 404) announced = true; // 404: 예전 서버(이 기능 없음)
        if (r.ok) { const b = await r.json().catch(() => ({})); if (b.unknown) opts.log?.({ event: 'restarted_unknown', count: b.unknown }); }
      }
      if (!(await pollOnce(opts))) await new Promise((r) => setTimeout(r, pollMs));
    } catch (error) {
      opts.log?.({ event: 'poll_error', error: String(error.cause?.code ?? error.message).slice(0, 80) });
      await new Promise((r) => setTimeout(r, error.retryAfterMs ?? pollMs * 2));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (await import('./parent-watch.mjs')).watchParent(); // W6: 서버가 띄운 경우, 서버가 사라지면 함께 끝난다
  try { (await import('./device-settings.mjs')).migrateWarmDefault(process.argv[2]); } catch { /* 설정 파일을 못 쓰면 그대로 */ }
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  config.accountsDir = accountsDirFor(process.argv[2], config); // A2: 이어온 전용 계정 폴더 뿌리
  config.kindCache = codexKindCache(config); // SV3: 계정 종류(구독/API) 자동 인식
  // 허브 컨테이너(감독 프로세스가 다시 띄움)에서는 설정 파일이 바뀌면 끝나서 새 설정으로 다시 시작한다(허브 웹의 실행 스위치).
  if (process.env.IEON_EXIT_ON_CONFIG_CHANGE === '1') {
    const { watchFile } = await import('node:fs');
    watchFile(process.argv[2], { interval: 2000 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) process.exit(0); });
  }
  const o = connectorOptions(config, process.argv.slice(3));
  const { buildAdapters } = await import('./adapters/index.mjs');
  process.stderr.write(JSON.stringify({ ch: 'connector', event: 'start', server: o.serverUrl }) + '\n');
  const adapters = await buildAdapters(config);
  (await import('./lock-probe.mjs')).prewarmLockWorker(); // 잠금 검사기 미리 띄우기(첫 질문도 빠르게)
  // 빠른 응답(미리 띄워 두기): 이 PC에는 연결부가 둘(이 PC 화면용·허브용) 돌 수 있어 질문을 실제로 받는 쪽만 띄운다(같은 대화를 Codex 둘이 잡지 않게).
  if (warmHere(process.argv[2], o.serverUrl)) adapters.codex_thread?.warmup?.((e) => process.stderr.write(JSON.stringify({ ch: 'connector', ...e }) + '\n'));
  await runConnector({
    baseUrl: o.serverUrl,
    deviceToken: readFileSync(o.deviceTokenFile, 'utf8').trim(),
    adapters,
    health: () => engineHealth(config),
    receipts: receiptLog(o.receiptPath),
    log: (e) => process.stderr.write(JSON.stringify({ ch: 'connector', ...e }) + '\n'),
  });
}

// 이 연결부가 질문을 받는 쪽인가: 사용 방식이 "내 허브에 연결"이면 허브 주소 연결부, 아니면 이 PC(127.0.0.1) 연결부.
// 사용 방식 파일이 없으면(허브·엔진 칸·예전 설치) 그대로 띄운다.
export function warmHere(configPath, serverUrl) {
  let mode = null;
  try { mode = JSON.parse(readFileSync(join(dirname(configPath), '..', 'mode.json'), 'utf8')).mode ?? null; } catch { mode = null; }
  if (!mode) return true;
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(String(serverUrl));
  return mode === 'hub' ? !local : local;
}

// 공유 App Server(readyz)와 이어온 채널(/v1/health)이 살아 있는지만 본다. 실패는 down으로 둔다.
export async function engineHealth(config) {
  const probe = async (url, headers) => {
    try { return (await fetch(url, { headers, signal: AbortSignal.timeout(1500) })).ok ? 'up' : 'down'; } catch { return 'down'; }
  };
  const shared = config.codex?.shared?.endpoint;
  const channel = config.claude?.baseUrl;
  return {
    codexShared: shared ? await probe(shared.replace(/^ws/, 'http') + '/readyz') : 'not_configured',
    claudeChannel: channel
      ? await probe(`${channel}/v1/health`, { authorization: `Bearer ${readFileSync(config.claude.tokenFile, 'utf8').trim()}` })
      : 'not_configured',
    // A2(EA10): 대화마다 어느 이어온 전용 계정으로 나가는지 서버(허브 포함) 화면에 보이게 이름표만 알린다. PC 기본은 빼고 보낸다.
    ...codexAccountHealth(config),
    // SV2: 서버(허브·칸)가 같이 쓰는 Claude 로그인의 종류(구독/API). PC는 null(그 PC의 로그인)
    claudeKind: claudeKind(),
    // A2-b: PC의 이어온 전용 Claude 계정(대화별·기본) 이름표·종류
    ...(claudeKind() ? {} : claudeAccountHealth(config, config.accountsDir)),
    ...agyAccountHealth(config), // A3: Antigravity 새 세션의 이어온 계정 이름표
    ...grokAccountHealth(config), // G1: Grok 새 세션의 이어온 계정 이름표
    // 엔진 칸(컨테이너가 경계 — 새 세션이 명령까지 할 수 있는 곳). 허브가 새 세션 기본 위치를 고를 때 씀
    boundary: process.env.IEON_CONTAINER_BOUNDARY === '1',
  };
}

// SV3: 계정 종류를 Codex에 직접 물어 자동으로 안다(공식 `codex login status` — "ChatGPT"면 구독, "API key"면 API). 사용자가 적을 필요 없음.
// 몇 초 걸리므로 5분마다 한 번만 묻고 결과를 둔다(작업 조회는 2초마다라 그때마다 묻지 않음). 모르면 null.
// 함수 선언으로 둔다 — 연결부 시작 코드(이 파일 위쪽)가 모듈을 다 읽기 전에 부르므로 const면 '초기화 전 접근' 오류(2026-11-17 배포에서 발견)
export function kindOfMethod(m) { return m === 'api_key' ? 'api' : m === 'chatgpt' ? 'subscription' : null; }
export function codexKindCache(config, { statusOf = (env) => createCodexLogin({ env }).status(), everyMs = 5 * 60_000 } = {}) {
  let kinds = { default: null, byAccount: {} }; let at = 0; let busy = false;
  const refresh = async () => {
    busy = true;
    try {
      const next = { default: kindOfMethod((await statusOf({ ...process.env }))?.method), byAccount: {} };
      for (const a of codexAccounts(config)) {
        if (readCodexCompat(codexHomeOf(config.accountsDir, a.id))) { next.byAccount[a.id] = 'compat'; continue; } // A2-c: 호환 주소(로그인 상태를 묻지 않음)
        try { next.byAccount[a.id] = kindOfMethod((await statusOf({ ...process.env, CODEX_HOME: codexHomeOf(config.accountsDir, a.id), CODEX_SQLITE_HOME: desktopCodexHome() }))?.method); } catch { next.byAccount[a.id] = null; }
      }
      kinds = next; at = Date.now();
    } finally { busy = false; }
  };
  return {
    refresh,
    get() { if (!busy && Date.now() - at > everyMs) refresh().catch(() => {}); return kinds; },
    // 대화(또는 새 세션=기본)가 쓰는 계정의 종류
    kindFor(threadId) { const id = codexAccountId(config, threadId, config.accountsDir); return id === PC_DEFAULT ? kinds.default : (kinds.byAccount[id] ?? null); },
  };
}

export function codexAccountHealth(config) {
  const out = {};
  for (const t of config.codex?.allowlist ?? []) {
    if (config.codex?.modes?.[t] === 'shared_server') continue; // 공유 서버 방식은 그 서버의 로그인
    const label = accountLabel(config, codexAccountId(config, t, config.accountsDir));
    if (label) out[t] = label;
  }
  const kc = config.kindCache;
  const kinds = {};
  if (kc) { kc.get(); for (const t of config.codex?.allowlist ?? []) if (config.codex?.modes?.[t] !== 'shared_server') { const k = kc.kindFor(t); if (k) kinds[t] = k; } }
  // SV3-b: 대화별 계정 ID(사용량·한도를 계정마다 — 이름표는 바뀔 수 있어 ID로)
  const ids = {};
  for (const t of config.codex?.allowlist ?? []) if (config.codex?.modes?.[t] !== 'shared_server') ids[t] = codexAccountId(config, t, config.accountsDir);
  return { codexAccounts: out, codexDefault: accountLabel(config, codexAccountId(config, null)), codexAccountIds: ids, codexDefaultId: codexAccountId(config, null), ...(kc ? { codexKinds: kinds, codexKind: kc.kindFor(null) } : {}) };
}

export { receiptLog };
