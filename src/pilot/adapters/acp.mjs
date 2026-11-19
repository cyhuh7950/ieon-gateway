// E3(신산님 2026-11-19 "9번까지 차례로", 설계 MORE_ENGINES 방식 B): ACP(Agent Client Protocol) 연결로 한 차례 보내기.
// Antigravity(`agy acp`, 1.5.8 initialize 응답: loadSession·session resume/load/list 지원 — 2026-11-19 실측, 모델 0)에
// session/resume으로 같은 대화를 이어 붙고(지난 내용을 다시 보내지 않음), session/prompt 한 번 보낸 뒤 프로세스를 닫는다.
// 질문마다 붙었다 떨어진다 — 계속 붙어 있으면 사람이 Antigravity에서 그 대화를 열 때 "사용 중"이 되므로(presence 잠금).
// 작업 모드: 에이전트의 session/request_permission을 이어온 승인 카드로(사람이 허용할 때만 allow_once). 질문만이면 늘 거부.
// 불러오기에 실패해도 새 세션으로 대체하지 않는다(ME4). 결과가 없으면(끊김·시간 초과) 결과 불명 — 자동 재전송 없음.
import { spawn } from 'node:child_process';
import { EngineError, StoppedError } from '../contracts.mjs';

const isLimit = (s) => /usage[ _]?limit|quota|rate[ _]?limit|resource[ _]?exhausted|hit your limit/i.test(String(s ?? ''));
const isNotFound = (s) => /not\s*found|no\s+(such\s+)?(conversation|session)|unknown\s+(conversation|session)|does not exist/i.test(String(s ?? ''));
// ACP 도구 종류 → 이어온 승인 카드 종류
const KIND = { edit: 'file', delete: 'file', move: 'file', execute: 'command', fetch: 'permissions' };

export function acpTurn({ bin, args = ['acp'], env, cwd, sessionId, question, workMode = false, approve = null, signal = null, timeoutMs = 30 * 60_000, spawnImpl = spawn, log = () => {} }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch { reject(new EngineError('engine_not_installed', 503)); return; }
    let buf = ''; let nextId = 1; let done = false; let prompted = false; let stopped = false;
    const pending = new Map(); // id → { resolve, reject }
    const text = [];
    const denied = []; // 거부한 허락 요청(답 끝에 알림 — 거부 뒤 에이전트가 말없이 끝나도 사람이 무슨 일인지 알게)
    const finish = (err, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { child.stdin.end(); } catch { /* 닫힘 */ }
      try { child.kill(); } catch { /* 끝남 */ }
      signal?.removeEventListener?.('abort', onAbort);
      if (err) reject(err); else resolve(value);
    };
    const send = (m) => { try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); } catch { /* 닫힘 */ } };
    const call = (method, params) => new Promise((ok, bad) => { const id = nextId++; pending.set(id, { ok, bad }); send({ id, method, params }); });
    const reply = (id, result) => send({ id, result });
    const timer = setTimeout(() => finish(Object.assign(new Error('acp_timeout'), { unknownCode: prompted ? 'acp_timeout' : 'acp_timeout_before_prompt' })), timeoutMs);
    const onAbort = () => { stopped = true; if (prompted) send({ method: 'session/cancel', params: { sessionId } }); else finish(new StoppedError()); };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });

    const onRequest = async (m) => {
      if (m.method === 'session/request_permission') {
        const opts = Array.isArray(m.params?.options) ? m.params.options : [];
        const pick = (kinds) => opts.find((o) => kinds.includes(o.kind))?.optionId;
        const reject1 = pick(['reject_once', 'reject_always']);
        const tc = m.params?.toolCall ?? {};
        let decision = 'decline';
        if (workMode && approve) {
          const summary = String(tc.title ?? tc.kind ?? '도구 사용').replace(/\s+/g, ' ').slice(0, 300);
          decision = await approve({ kind: KIND[tc.kind] ?? 'permissions', summary, cwd, itemId: tc.toolCallId ? String(tc.toolCallId).slice(0, 80) : null }).catch(() => 'decline');
        }
        const allow1 = pick(['allow_once']);
        log({ event: 'acp_permission', decision });
        if (decision !== 'accept') denied.push(String(tc.title ?? tc.kind ?? '도구 사용').replace(/\s+/g, ' ').slice(0, 120));
        if (decision === 'accept' && allow1) return reply(m.id, { outcome: { outcome: 'selected', optionId: allow1 } });
        return reply(m.id, reject1 ? { outcome: { outcome: 'selected', optionId: reject1 } } : { outcome: { outcome: 'cancelled' } });
      }
      // 파일·터미널을 이어온이 대신 열어 주지 않는다(initialize에서 안 한다고 알림)
      send({ id: m.id, error: { code: -32601, message: 'not supported' } });
    };
    const onLine = (line) => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && m.method) { onRequest(m); return; } // 에이전트 → 이어온 요청
      if (m.id !== undefined) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); if (m.error) p.bad(m.error); else p.ok(m.result); return; }
      if (m.method === 'session/update' && prompted) {
        const u = m.params?.update;
        // 답 글: 조각(agent_message_chunk) 또는 통째(agent_message), content는 하나 또는 여러 개(2026-11-19 실측에서 거부 뒤 답이 빈칸이라 두 모양 다 받음)
        if (u && ['agent_message_chunk', 'agent_message'].includes(u.sessionUpdate)) for (const c of [u.content].flat()) if (c?.type === 'text') text.push(String(c.text ?? ''));
      }
    };
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); } });
    child.stderr?.resume();
    child.on('error', (e) => finish(e.code === 'ENOENT' ? new EngineError('engine_not_installed', 503) : e));
    child.on('close', () => finish(stopped ? new StoppedError() : Object.assign(new Error('acp_closed'), { unknownCode: prompted ? 'acp_closed' : 'acp_closed_before_prompt' })));

    (async () => {
      const init = await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      const caps = init?.agentCapabilities ?? {};
      const sc = caps.sessionCapabilities ?? caps.session_capabilities ?? {};
      let opened;
      try {
        if (sc.resume) opened = await call('session/resume', { sessionId, cwd, mcpServers: [] });
        else if (caps.loadSession || caps.load_session) opened = await call('session/load', { sessionId, cwd, mcpServers: [] });
        else throw new EngineError('acp_no_resume', 503);
      } catch (e) {
        if (e instanceof EngineError) throw e;
        const msg = `${e?.message ?? ''} ${JSON.stringify(e?.data ?? '')}`;
        throw isNotFound(msg) ? new EngineError('session_load_failed', 409) : isLimit(msg) ? new EngineError('usage_limit', 429) : new EngineError('session_load_failed', 409);
      }
      // 질문만: 계획(plan) 방식이 있으면 그것으로(파일 수정·명령은 어차피 허락을 구하고 이어온이 거부)
      const modes = opened?.modes?.availableModes ?? [];
      if (!workMode && modes.some((x) => x.id === 'plan') && opened?.modes?.currentModeId !== 'plan') await call('session/set_mode', { sessionId, modeId: 'plan' }).catch(() => {});
      if (stopped) throw new StoppedError();
      prompted = true;
      const r = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: question }] }).catch((e) => {
        const msg = `${e?.message ?? ''} ${JSON.stringify(e?.data ?? '')}`;
        if (isLimit(msg) && !text.length) throw new EngineError('usage_limit', 429);
        throw Object.assign(new Error('acp_prompt_error'), { unknownCode: 'acp_prompt_error' });
      });
      if (r?.stopReason === 'cancelled' || stopped) throw new StoppedError();
      const note = denied.length ? `[이어온] 허락하지 않아 실행되지 않은 작업 ${denied.length}개:\n${denied.slice(0, 5).map((d) => `- ${d}`).join('\n')}` : '';
      return { answer: [text.join('').trim(), note].filter(Boolean).join('\n\n'), stopReason: r?.stopReason ?? null };
    })().then((v) => finish(null, v), (e) => finish(e));
  });
}
