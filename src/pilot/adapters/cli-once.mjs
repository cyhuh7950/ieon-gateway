// E1·E2(MORE_ENGINES ME1~ME7): Grok·Antigravity 세션을 질문마다 CLI 한 번 실행으로 이어 쓴다(Codex 번갈아 쓰기와 같은 모양).
// 세션 쪽과 토큰 쪽을 나눈다(신산님 2026-11-13):
//  - 세션 쪽(이 파일): 그 PC에 있는 세션을 같은 ID로 이어 쓰기. 보내기 전에 사용 중(잠금)을 확인해 거부, 읽기 전용(질문만),
//    불러오기 실패·다른 세션으로 바뀜은 새 세션으로 대체하지 않는다(ME4).
//  - 토큰 쪽(accountEnv): 어느 계정·키의 사용량으로 나갈지는 이어온이 정한다. 지금은 PC 기본 로그인만(A3에서 이어온 전용 계정),
//    실행할 때 API 키 환경 변수는 지워 종량제로 새지 않게 한다(ME7) — API 키는 신산님이 명시적으로 고를 때만(accountEnv가 넘김).
// 질문 원문은 로그에 남기지 않는다(오류 출력도 보관하지 않음).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { checkNewSession } from '../new-sessions.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EngineError, StoppedError } from '../contracts.mjs';
import { probeLockAt } from '../lock-probe.mjs';
import { acpTurn } from './acp.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exe = (p) => (process.platform === 'win32' ? `${p}.exe` : p);

// 엔진별 정의. verified: E0에서 실제로 확인한 엔진인지(Grok은 구독 전이라 공식 문서 기준 — 실제 시험 때 맞출 곳은 TO_VERIFY).
export const CLI_ENGINES = Object.freeze({
  agy_cli: {
    name: 'Antigravity', verified: true,
    bin: () => join(homedir(), '.gemini', 'bin', exe('agy')),
    // E0: -p 한 번 실행, JSON 결과(conversation_id·status·response·usage), --conversation 이어 쓰기, plan+샌드박스면 파일 안 생김
    args: (id, q) => ['-p', q, '--output-format', 'json', '--mode', 'plan', '--sandbox', '--print-timeout', '280s', '--conversation', id],
    // E4 새 세션: 처음 질문은 --conversation 없이(새 대화), 다음부터 받은 대화 ID로. 방식은 권한 프로필의 agy.mode, auto(명령까지)만 샌드박스를 풂.
    newArgs: (id, q, mode) => ['-p', q, '--output-format', 'json', '--mode', mode, ...(mode === 'auto' ? [] : ['--sandbox']), '--print-timeout', '280s', ...(id ? ['--conversation', id] : [])],
    // E0: 대화마다 presence 잠금(처리 중이면 잡힘). Antigravity는 동시 실행을 막지 않으므로 이어온이 확인한다.
    lockDir: () => join(homedir(), '.gemini', 'antigravity-cli', 'presence'),
    acpArgs: ['acp'], // E3: 작업 모드(ACP session/resume + 허락 요청 → 승인 카드)
    keyVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH'],
    parse: (j) => ({ sessionId: j?.conversation_id, ok: j?.status === 'SUCCESS', answer: j?.response, status: j?.status, usage: j?.usage }),
    validId: (id) => UUID.test(id),
  },
  grok_cli: {
    name: 'Grok', verified: false,
    bin: () => join(homedir(), '.grok', 'bin', exe('grok')),
    // 공식 문서: -p 한 번 실행·--output-format json·-r <ID> 이어 쓰기. --always-approve·--fork-session은 쓰지 않음.
    // TO_VERIFY(구독 뒤 실측): 결과 JSON 칸 이름, 읽기 전용(권한을 묻지 않는 실행에서 자동 거부되는지·--deny 규칙), 사용 중 잠금 위치.
    args: (id, q) => ['-p', q, '--output-format', 'json', '-r', id],
    lockDir: null, // 사용 중 판별 방법 미확인 — 확인 전에는 "보낼 때 다른 곳에서 열어 두지 않기"(ME5)를 화면에 안내
    keyVars: ['XAI_API_KEY'],
    parse: (j) => ({ sessionId: j?.sessionId ?? j?.session_id, ok: !(j?.is_error || j?.error) && (j?.result ?? j?.response) !== undefined, answer: j?.result ?? j?.response, status: j?.status ?? null, usage: j?.usage }),
    validId: (id) => /^[\w-]{6,80}$/.test(id),
  },
});

// RC2: signal(멈춤)이 오면 그 실행만 끝낸다 — 프로세스가 실제로 닫힌 뒤 stopped로 알린다.
export function runCli(bin, args, { cwd, env, timeoutMs = 300_000, signal = null }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let stopped = false;
    const onStop = () => { stopped = true; child.kill(); };
    if (signal?.aborted) onStop(); else signal?.addEventListener('abort', onStop, { once: true });
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('cli_timeout'), { unknownCode: 'cli_timeout' })); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; }); // 불러오기 실패 판별용으로만 잠깐 보고 버린다
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new EngineError('engine_not_installed', 503) : e); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener?.('abort', onStop); resolve({ code, stdout, stderr, stopped }); });
  });
}

const lastJson = (s) => { const t = String(s).trim(); try { return JSON.parse(t); } catch { /* 여러 줄이면 마지막 줄 */ } try { return JSON.parse(t.split('\n').pop()); } catch { return null; } };
const isLimit = (s) => /usage[ _]?limit|quota|rate[ _]?limit|resource[ _]?exhausted|hit your limit/i.test(String(s ?? ''));
const isNotFound = (s) => /not\s*found|no\s+(such\s+)?(conversation|session)|unknown\s+(conversation|session)|does not exist/i.test(String(s ?? ''));

// opts: { live, engine('agy_cli'|'grok_cli'), allowlist: [세션 ID], workingDirectories?: {id: dir}, bin?, run?, probe?, accountEnv?(id) }
// E3: 작업 모드는 ACP 연결로(에이전트의 허락 요청 → 이어온 승인 카드). ACP를 쓸 수 있는 엔진만(spec.acpArgs) — 지금 Antigravity.
export function cliOnceAdapter(opts) {
  const spec = CLI_ENGINES[opts.engine];
  if (!spec) throw new Error(`unknown_cli_engine:${opts.engine}`);
  const run = opts.run ?? runCli;
  const probe = opts.probe ?? ((id, dir) => probeLockAt(id, dir).outcome);
  const envOf = (id) => { const env = { ...process.env }; for (const k of spec.keyVars) delete env[k]; Object.assign(env, opts.accountEnv?.(id) ?? {}); return env; };
  // E4 새 세션(이어온이 만든 대화만): 작업 폴더·권한은 이 연결부 설정으로 다시 검사(서버 DB만 믿지 않음)
  async function runNew({ sessionRef, question, newSession }, signal) {
    if (!spec.newArgs || !opts.newSessions) throw new EngineError('new_sessions_not_configured', 503);
    if (!opts.live) throw new EngineError('live_disabled', 503);
    const { config, created } = opts.newSessions;
    let checked; try { checked = checkNewSession(config, newSession); } catch (e) { throw new EngineError(e.code, e.http); }
    const pending = String(sessionRef).startsWith('pending:');
    if (!pending && (!spec.validId(String(sessionRef)) || !created.has(sessionRef))) throw new EngineError('session_not_allowed', 403);
    const bin = opts.bin ?? spec.bin();
    if (!opts.run && !existsSync(bin)) throw new EngineError('engine_not_installed', 503);
    if (!pending && spec.lockDir) { const o = probe(sessionRef, opts.lockDir ?? spec.lockDir()); if (o === 'WRITER_LOCK_CONFLICT') throw new EngineError('session_in_use', 409); if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(o)) throw new EngineError('lock_check_failed', 409); }
    if (pending) mkdirSync(checked.workspace, { recursive: true });
    const mode = checked.profile.agy?.mode ?? 'plan';
    // A3: 이어온 Antigravity 계정 — 처음엔 엔진 기본 계정, 그 뒤엔 그 세션을 만든 계정(대화가 그 계정 폴더에 있음). PC 기본이면 지금처럼 한 번 실행(-p)
    let acct = null;
    try { acct = pending ? (opts.agyRun?.(null) ?? null) : (created.account?.(sessionRef) ? opts.agyRun?.(created.account(sessionRef)) ?? null : null); } catch (e) { throw new EngineError(e.message, e.http ?? 409); }
    if (acct) {
      const r = await (opts.acp ?? acpTurn)({ bin, args: spec.acpArgs, env: acct.env, cwd: checked.workspace, geminiDir: acct.geminiDir, authMethod: acct.authMethod, newSession: pending, sessionId: pending ? null : sessionRef,
        question, mode, signal, spawnImpl: opts.spawnImpl });
      const id = String(r.sessionId ?? sessionRef);
      if (!spec.validId(id)) throw Object.assign(new Error('acp_no_session'), { unknownCode: 'acp_no_session' });
      if (pending) created.add(id, newSession.name, acct.accountId);
      return { receipt: `${opts.engine}:${id}`, answer: r.answer, sessionRef: id, usage: null };
    }
    const { code, stdout, stderr, stopped } = await run(bin, spec.newArgs(pending ? null : sessionRef, question, mode), { cwd: checked.workspace, env: envOf(pending ? null : sessionRef), signal });
    if (stopped) throw new StoppedError();
    const j = lastJson(stdout);
    if (!j) { if (code !== 0 && isLimit(stderr)) throw new EngineError('usage_limit', 429); throw Object.assign(new Error('cli_bad_output'), { unknownCode: `cli_exit_${code}` }); }
    const r = spec.parse(j);
    const newId = String(r.sessionId ?? '');
    if (!spec.validId(newId)) throw Object.assign(new Error('cli_no_session'), { unknownCode: 'cli_no_session' });
    if (pending) created.add(newId, newSession.name); // 이어온이 만든 대화로 적어 둠(다음 질문부터 이 ID로만)
    else if (newId !== sessionRef) throw Object.assign(new Error('session_changed'), { unknownCode: 'session_changed', sessionRef });
    if (!r.ok) {
      if (!r.answer && isLimit(`${r.status} ${JSON.stringify(j).slice(0, 500)}`)) throw Object.assign(new EngineError('usage_limit', 429), { sessionRef: newId });
      throw Object.assign(new Error('cli_error'), { unknownCode: `cli_${String(r.status ?? 'error').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30)}`, sessionRef: newId });
    }
    return { receipt: `${opts.engine}:${newId}`, answer: String(r.answer ?? ''), sessionRef: newId, usage: r.usage && typeof r.usage === 'object' ? r.usage : null };
  }
  return {
    engine: opts.engine,
    async run({ sessionRef: id, question, workMode = false, newSession }, { signal = null, approve = null } = {}) {
      if (newSession) return runNew({ sessionRef: id, question, newSession }, signal);
      if (!spec.validId(String(id)) || !(opts.allowlist ?? []).includes(id)) throw new EngineError('session_not_allowed', 403);
      if (!opts.live) throw new EngineError('live_disabled', 503);
      const bin = opts.bin ?? spec.bin();
      if (!opts.run && !existsSync(bin)) throw new EngineError('engine_not_installed', 503);
      // 사용 중(사람이 열어 둠·다른 실행 중)이면 보내지 않는다 — 잠금을 확인할 수 있는 엔진만
      if (spec.lockDir) {
        const o = probe(id, opts.lockDir ?? spec.lockDir());
        if (o === 'WRITER_LOCK_CONFLICT') throw new EngineError('session_in_use', 409);
        if (!['NO_LOCK_FILE', 'NO_WRITER_LOCK'].includes(o)) throw new EngineError('lock_check_failed', 409);
      }
      // 토큰 쪽: 이어온이 정한 계정(지금은 PC 기본 로그인). API 키 변수는 지우고, 계정 쪽이 넘긴 것만 쓴다.
      const env = { ...process.env };
      for (const k of spec.keyVars) delete env[k];
      Object.assign(env, opts.accountEnv?.(id) ?? {});
      if (workMode) {
        if (!spec.acpArgs) throw new EngineError('work_mode_not_supported', 400);
        const r = await (opts.acp ?? acpTurn)({ bin, args: spec.acpArgs, env, cwd: opts.workingDirectories?.[id] ?? process.cwd(), sessionId: id, question, workMode: true, approve, signal, spawnImpl: opts.spawnImpl });
        return { receipt: `${opts.engine}:${id}`, answer: r.answer, usage: null };
      }
      const { code, stdout, stderr, stopped } = await run(bin, spec.args(id, question), { cwd: opts.workingDirectories?.[id] ?? undefined, env, signal });
      if (stopped) throw new StoppedError(); // 사람이 멈춤 — 프로세스가 닫힌 것까지 확인함
      const j = lastJson(stdout);
      if (!j) {
        // 아무 결과도 없이 끝남: 불러오기 실패가 분명하면 실행 안 됨(거부), 그 밖에는 실행됐을 수 있어 결과 불명
        if (code !== 0 && isNotFound(stderr)) throw new EngineError('session_load_failed', 409);
        if (code !== 0 && isLimit(stderr)) throw new EngineError('usage_limit', 429);
        throw Object.assign(new Error('cli_bad_output'), { unknownCode: `cli_exit_${code}` });
      }
      const r = spec.parse(j);
      // 다른 세션으로 답했다면(새 세션·갈라 쓰기) 이어 쓴 것이 아니다 — 모델은 돌았으므로 결과 불명(ME4: 대체하지 않음)
      if (r.sessionId && r.sessionId !== id) throw Object.assign(new Error('session_changed'), { unknownCode: 'session_changed' });
      if (!r.ok) {
        if (!r.answer && isLimit(`${r.status} ${JSON.stringify(j).slice(0, 500)}`)) throw new EngineError('usage_limit', 429);
        throw Object.assign(new Error('cli_error'), { unknownCode: `cli_${String(r.status ?? 'error').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30)}` });
      }
      return { receipt: `${opts.engine}:${id}`, answer: String(r.answer ?? ''), usage: r.usage && typeof r.usage === 'object' ? r.usage : null };
    },
  };
}
