// 새 세션 만들기 N2: Claude Code 새 세션을 질문마다 비대화형(claude -p)으로 실행하고 같은 세션 ID로 이어 간다.
// 채널(실행 중 터미널)을 쓰지 않으므로 질문이 없을 때는 프로세스가 없다(=잠든 상태). 사람은 작업 폴더에서
// `claude --resume <ID>`로 같은 세션을 직접 열 수 있다.
// 안전: --restricted(사용자·프로젝트 설정·훅 무시, 파일 도구를 작업 폴더로 제한, bypassPermissions 거부),
// --strict-mcp-config(MCP 없음), --tools·--allowedTools는 프로필 도구만, --permission-prompts none(그 밖은 자동 거부).
// 질문은 표준 입력으로만 넘기고 로그에 남기지 않는다.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EngineError, StoppedError } from '../contracts.mjs';
import { checkNewSession } from '../new-sessions.mjs';

const TIMEOUT_MS = 300000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RC2: signal(멈춤)이 오면 그 실행만 끝낸다 — 프로세스가 닫힌 뒤 stopped로 알린다.
export function spawnClaude(args, input, { cwd, timeoutMs = TIMEOUT_MS, signal = null }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stopped = false;
    const onStop = () => { stopped = true; child.kill(); };
    if (signal?.aborted) onStop(); else signal?.addEventListener('abort', onStop, { once: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude_timeout')); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.resume(); // 오류 원문(질문이 섞일 수 있음)은 보관하지 않는다.
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new EngineError('claude_not_installed', 503) : e); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener?.('abort', onStop); resolve({ code, stdout, stopped }); });
    child.stdin.end(input);
  });
}

// opts: { live, spawnClaude?, newSessions?: { config, created: { has(id), add(id, name) } } }
export function claudeCliAdapter(opts) {
  const run = opts.spawnClaude ?? spawnClaude;
  return {
    engine: 'claude_cli',
    async run({ sessionRef, question, newSession }, { signal = null } = {}) {
      if (!newSession || !opts.newSessions) throw new EngineError('new_sessions_not_configured', 503);
      if (!opts.live) throw new EngineError('live_disabled', 503);
      const { config, created } = opts.newSessions;
      let checked;
      try { checked = checkNewSession(config, newSession); } catch (e) { throw new EngineError(e.code, e.http); }
      const tools = checked.profile.claude.allowedTools.join(',');
      const pending = sessionRef.startsWith('pending:');
      const id = pending ? randomUUID() : sessionRef;
      if (!pending && !created.has(id)) throw new EngineError('session_not_allowed', 403);
      if (pending) mkdirSync(checked.workspace, { recursive: true });
      const args = ['-p', '--output-format', 'json', '--restricted', '--strict-mcp-config', '--permission-prompts', 'none',
        '--tools', tools, '--allowedTools', tools, ...(pending ? ['--session-id', id] : ['--resume', id])];
      if (pending) created.add(id, newSession.name);
      const { code, stdout, stopped } = await run(args, question, { cwd: checked.workspace, signal });
      if (stopped) throw Object.assign(new StoppedError(), { sessionRef: id }); // 사람이 멈춤 — 세션 ID는 남겨 같은 세션으로 이어 감
      let out;
      try { out = JSON.parse(stdout); } catch { throw Object.assign(new Error('claude_bad_output'), { unknownCode: `claude_exit_${code}`, sessionRef: id }); }
      // 같은 세션이 사람 쪽에서 실행 중이면 claude가 복사본을 만들어 다른 ID로 답한다. 모델은 돌았으므로 결과 불명이다.
      if (out.session_id && out.session_id !== id) throw Object.assign(new Error('session_forked'), { unknownCode: 'session_forked', sessionRef: id });
      // A1: 계정 사용 한도로 거절된 경우는 실행 안 됨이 확실 → 잠그지 않고 usage_limit로 알린다.
      if (out.is_error && /usage[ _]?limit|hit your limit/i.test(String(out.result ?? ''))) throw Object.assign(new EngineError('usage_limit', 429), { sessionRef: id });
      if (out.is_error || out.subtype !== 'success') throw Object.assign(new Error('claude_error'), { unknownCode: 'claude_error', sessionRef: id });
      if (out.permission_denials?.length) return { approvalRequired: true, sessionRef: id };
      const u = out.usage ?? {};
      return { receipt: `claude:${id}`, answer: out.result ?? '', sessionRef: id,
        usage: ID.test(id) && (u.input_tokens !== undefined || u.output_tokens !== undefined)
          ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : null };
    },
  };
}