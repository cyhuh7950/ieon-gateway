// S2.2 SINSAN 연결부. PC가 서버로 먼저 연결해 작업을 가져가고 결과를 보고한다(PC 수신 포트 없음).
// 사용: node src/pilot/connector.mjs <configPath>
// 실행 전 request_id를 로컬 receipt에 내구 저장하고, 이미 본 요청은 다시 실행하지 않는다.
import { appendFileSync, existsSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EngineError } from './contracts.mjs';

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
export async function pollOnce({ baseUrl, deviceToken, adapters, receipts, health, log = () => {} }) {
  const headers = { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' };
  // 엔진 상태(값만, 인증 정보 없음)를 작업 조회에 실어 보낸다. 서버는 이를 보고 꺼진 엔진으로의 질문을 미리 거절한다.
  const state = health ? await health() : null;
  const res = await fetch(`${baseUrl}/v1/device/jobs`, { headers: state ? { ...headers, 'x-ieon-health': JSON.stringify(state) } : headers });
  if (res.status === 204) return false;
  if (res.status !== 200) throw new Error(`poll_${res.status}`);
  const job = await res.json();
  const report = (outcome) => fetch(`${baseUrl}/v1/device/jobs/${job.requestId}/result`, {
    method: 'POST', headers, body: JSON.stringify(outcome),
  });

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
  try {
    const result = await adapter.run({ engine: job.engine, sessionRef: job.sessionRef, question: job.question, requestId: job.requestId,
      connectMode: job.connectMode, newSession: job.newSession });
    outcome = result.approvalRequired ? { status: 'approval_required' }
      : { status: 'completed', receipt: result.receipt ?? null, answer: result.answer ?? null, usage: result.usage ?? null };
    if (result.sessionRef) outcome.sessionRef = result.sessionRef;
  } catch (error) {
    outcome = error instanceof EngineError
      ? { status: 'failed', errorCode: error.code, http: error.http }
      : { status: 'unknown', errorCode: error.unknownCode ?? 'result_unknown' };
    // 새 세션이 실행 도중 실패해도 이미 만들어진 엔진 세션 ID는 서버에 알린다.
    if (error.sessionRef) outcome.sessionRef = error.sessionRef;
  }
  log({ event: 'job_done', requestId: job.requestId, status: outcome.status, errorCode: outcome.errorCode, usage: outcome.usage });
  await report(outcome);
  return true;
}

export async function runConnector({ pollMs = 2000, signal, ...opts }) {
  while (!signal?.aborted) {
    try {
      if (!(await pollOnce(opts))) await new Promise((r) => setTimeout(r, pollMs));
    } catch (error) {
      opts.log?.({ event: 'poll_error', error: String(error.cause?.code ?? error.message).slice(0, 80) });
      await new Promise((r) => setTimeout(r, pollMs * 2));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { buildAdapters } = await import('./adapters/index.mjs');
  await runConnector({
    baseUrl: config.serverUrl,
    deviceToken: readFileSync(config.deviceTokenFile, 'utf8').trim(),
    adapters: await buildAdapters(config),
    health: () => engineHealth(config),
    receipts: receiptLog(config.receiptPath),
    log: (e) => process.stderr.write(JSON.stringify({ ch: 'connector', ...e }) + '\n'),
  });
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
  };
}

export { receiptLog };
