// 새 세션 만들기 N2: Claude Code 새 세션을 질문마다 비대화형(claude -p)으로 실행하고 같은 세션 ID로 이어 간다.
// 채널(실행 중 터미널)을 쓰지 않으므로 질문이 없을 때는 프로세스가 없다(=잠든 상태). 사람은 작업 폴더에서
// `claude --resume <ID>`로 같은 세션을 직접 열 수 있다.
// 안전: --restricted(사용자·프로젝트 설정·훅 무시, 파일 도구를 작업 폴더로 제한, bypassPermissions 거부),
// --strict-mcp-config(MCP 없음), --tools·--allowedTools는 프로필 도구만, --permission-prompts none(그 밖은 자동 거부).
// 질문은 표준 입력으로만 넘기고 로그에 남기지 않는다.
import { claudeSessionModel, isForeignModel } from '../claude-sessions.mjs';
import { t as i18nT } from '../../i18n/index.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { claudeBusy } from '../claude-sessions.mjs';
import { randomUUID } from 'node:crypto';
import { EngineError, StoppedError } from '../contracts.mjs';
import { checkNewSession } from '../new-sessions.mjs';
import { claudeAuthEnv } from '../claude-login.mjs';
import { claudeDirArgs } from '../workspaces.mjs';

const TIMEOUT_MS = 300000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RC2: signal(멈춤)이 오면 그 실행만 끝낸다 — 프로세스가 닫힌 뒤 stopped로 알린다.
// SV2: 서버(허브·엔진 칸)에서는 같이 쓰는 Claude 로그인(구독 토큰 또는 API 키)을 실행할 때마다 읽어 넣는다. PC는 그 PC의 로그인 그대로.
export function spawnClaude(args, input, { cwd, timeoutMs = TIMEOUT_MS, signal = null, env = claudeAuthEnv() }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

// 권한 설정에서 막힌 작업(신산님 2026-11-18 "고쳐 주세요", WORK_STATUS 0-205): --permission-prompts none이라 막힌 도구는 그 자리에서 거부되고 차례는 끝까지 간다.
// 예전에는 "권한 확인 대기"로 멈춰 답이 비고 대화가 잠겼다 → 답은 그대로 두고 끝에 무엇이 막혔는지 붙인다(5개까지, 대상은 파일 경로·명령 앞부분).
export function deniedNote(denials = []) {
  if (!denials.length) return '';
  const what = (d) => { const i = d?.tool_input ?? {}; const t = i.file_path ?? i.path ?? i.notebook_path ?? i.url ?? i.command ?? i.pattern ?? '';
    return `- ${String(d?.tool_name ?? i18nT('server.tool.generic'))}${t ? ' ' + String(t).replace(/\s+/g, ' ').slice(0, 120) : ''}`; };
  return i18nT('server.note.claude_denied', { n: denials.length, list: denials.slice(0, 5).map(what).join('\n') }) + (denials.length > 5 ? i18nT('server.note.more', { n: denials.length - 5 }) : '');
}

// SV2 기존 대화(서버 칸에서 사람이 연 Claude 대화를 고른 것)의 도구: 새 세션 기본 프로필(없으면 작업 폴더 안 읽기·쓰기). 명령(Bash)은 열지 않는다.
const DEFAULT_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write'];

// opts: { live, spawnClaude?, newSessions?: { config, created: { has(id), add(id, name) } },
//         allowlist?: [기존 대화 세션 ID], workingDirectories?: {id: 작업 폴더}, busy?(cwd) }
export function claudeCliAdapter(opts) {
  const run = opts.spawnClaude ?? spawnClaude;
  const busy = opts.busy ?? claudeBusy;
  // 새 세션(이어온이 만든 것): 작업 폴더·도구를 이 연결부 설정으로 다시 검사
  const forNew = (sessionRef, newSession) => {
    if (!opts.newSessions) throw new EngineError('new_sessions_not_configured', 503);
    if (!opts.live) throw new EngineError('live_disabled', 503);
    const { config, created } = opts.newSessions;
    let checked;
    try { checked = checkNewSession(config, newSession); } catch (e) { throw new EngineError(e.code, e.http); }
    const pending = sessionRef.startsWith('pending:');
    const id = pending ? randomUUID() : sessionRef;
    if (!pending && !created.has(id)) throw new EngineError('session_not_allowed', 403);
    if (pending) { mkdirSync(checked.workspace, { recursive: true }); created.add(id, newSession.name); }
    return { id, pending, cwd: checked.workspace, tools: checked.profile.claude.allowedTools };
  };
  // 기존 대화(서버 칸 허용 목록에 고른 것): 같은 ID로 그 대화의 작업 폴더에서 --resume. 사람이 그 폴더에서 Claude를 실행 중이면 보내지 않는다.
  const forExisting = (id) => {
    if (!ID.test(String(id)) || !(opts.allowlist ?? []).includes(id)) throw new EngineError('session_not_allowed', 403);
    if (!opts.live) throw new EngineError('live_disabled', 503);
    const cwd = opts.workingDirectories?.[id];
    if (!cwd || !existsSync(cwd)) throw new EngineError('working_directory_missing', 409);
    if (busy(cwd) === 'busy') throw new EngineError('session_in_use', 409);
    const cfg = opts.newSessions?.config;
    const tools = cfg?.permissions.profiles[cfg.permissions.default === 'full' ? 'workspace' : cfg.permissions.default]?.claude.allowedTools ?? DEFAULT_TOOLS;
    return { id, pending: false, cwd, tools };
  };
  return {
    engine: 'claude_cli',
    async run({ sessionRef, question, newSession }, { signal = null } = {}) {
      // A2-b: 이어온 전용 Claude 계정이 기본이면 그 계정으로(로그인 전·없는 계정이면 보내기 전에 거절 — 다른 계정 사용량으로 새지 않게)
      let env = null;
      const ref = newSession && sessionRef.startsWith('pending:') ? null : sessionRef; // 처음 질문 전 새 세션은 엔진 기본
      try { env = opts.accountEnv?.(ref, { existing: !newSession }) ?? null; } catch (e) { throw new EngineError(e.message, e.http ?? 409); }
      // 다른 회사 모델로 만든 세션을 Anthropic 로그인으로 이어 쓰면 그 모델 이름을 그대로 보내 실패한다(2026-11-24 solar-test) — 보내기 전에 이유로 거절
      if (ref && !String(ref).startsWith('pending:') && !env?.ANTHROPIC_BASE_URL && isForeignModel((opts.sessionModel ?? claudeSessionModel)(ref))) throw new EngineError('session_model_mismatch', 409);
      const { id, pending, cwd, tools: list } = newSession ? forNew(sessionRef, newSession) : forExisting(sessionRef);
      const tools = list.join(',');
      // WS1-b: 붙인 작업 공간(개인·공유 폴더) — 지금 있는 폴더만 --add-dir, 공유(읽기만)는 고치기 거부
      const ws = opts.workspaceOf?.(newSession ? `new:${newSession.name}` : sessionRef) ?? null;
      const live = (l) => (l ?? []).filter((d) => existsSync(d));
      const dirArgs = ws ? claudeDirArgs({ personal: ws.personal && existsSync(ws.personal) ? ws.personal : null, write: live(ws.write), read: live(ws.read) }) : [];
      const args = ['-p', '--output-format', 'json', '--restricted', '--strict-mcp-config', '--permission-prompts', 'none',
        '--tools', tools, '--allowedTools', tools, ...dirArgs, ...(pending ? ['--session-id', id] : ['--resume', id])];
      const { code, stdout, stopped } = await run(args, question, { cwd, signal, ...(env ? { env } : {}) });
      if (stopped) throw Object.assign(new StoppedError(), { sessionRef: id }); // 사람이 멈춤 — 세션 ID는 남겨 같은 세션으로 이어 감
      let out;
      try { out = JSON.parse(stdout); } catch { throw Object.assign(new Error('claude_bad_output'), { unknownCode: `claude_exit_${code}`, sessionRef: id }); }
      // 같은 세션이 사람 쪽에서 실행 중이면 claude가 복사본을 만들어 다른 ID로 답한다. 모델은 돌았으므로 결과 불명이다.
      if (out.session_id && out.session_id !== id) throw Object.assign(new Error('session_forked'), { unknownCode: 'session_forked', sessionRef: id });
      // A1: 계정 사용 한도로 거절된 경우는 실행 안 됨이 확실 → 잠그지 않고 usage_limit로 알린다.
      if (out.is_error && /usage[ _]?limit|hit your limit/i.test(String(out.result ?? ''))) throw Object.assign(new EngineError('usage_limit', 429), { sessionRef: id });
      // 2026-11-24: 호환 주소에서 키 거절·연결 오류는 모델이 일하기 전이라 결과 불명 대신 이유로
      if ((out.is_error || out.subtype !== 'success') && env?.ANTHROPIC_BASE_URL) {
        const why = String(out.result ?? '');
        if (/\b401\b|api key is invalid|invalid.{0,10}api.?key|authentication/i.test(why)) throw Object.assign(new EngineError('compat_key_rejected', 409), { sessionRef: id });
        if (/connection error|ENOTFOUND|ECONNREFUSED|fetch failed|getaddrinfo/i.test(why)) throw Object.assign(new EngineError('compat_unreachable', 409), { sessionRef: id });
      }
      if (out.is_error || out.subtype !== 'success') throw Object.assign(new Error('claude_error'), { unknownCode: 'claude_error', sessionRef: id });
      const note = deniedNote(out.permission_denials ?? []);
      const answer = [String(out.result ?? '').trim(), note].filter(Boolean).join('\n\n');
      const u = out.usage ?? {};
      return { receipt: `claude:${id}`, answer, sessionRef: id,
        usage: ID.test(id) && (u.input_tokens !== undefined || u.output_tokens !== undefined)
          ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : null };
    },
  };
}