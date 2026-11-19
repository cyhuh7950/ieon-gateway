// E3 ACP 연결(신산님 2026-11-19 "9번까지 차례로"): Antigravity 작업 모드를 ACP로 — session/resume으로 같은 대화, 허락 요청은 승인 카드로.
// 질문만이면 계획(plan) 방식 + 허락 요청은 늘 거부. 불러오기 실패는 새 세션으로 대체하지 않음. 멈춤은 session/cancel. 모델 0(가짜 에이전트).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { acpTurn } from '../../src/pilot/adapters/acp.mjs';
import { cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';

const SID = '9e943423-0000-4000-8000-0000000000aa';

// 가짜 ACP 에이전트: 받은 메시지를 기록하고 정해진 대로 답한다
function fakeAgent({ resumeError = null, permission = true, hangPrompt = false } = {}) {
  const seen = []; const replies = new Map();
  const spawnImpl = (bin, args, o) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stderr.resume = () => {};
    child.kill = () => { setImmediate(() => child.emit('close', 0)); };
    const out = (m) => setImmediate(() => child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'));
    let promptId = null;
    child.stdin = { end() {}, write(s) {
      for (const line of String(s).split('\n').filter(Boolean)) {
        const m = JSON.parse(line); seen.push(m);
        if (m.method === 'initialize') out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, load: {} } } } });
        else if (m.method === 'session/resume') out(resumeError ? { id: m.id, error: { code: -32000, message: resumeError } } : { id: m.id, result: { modes: { availableModes: [{ id: 'plan' }, { id: 'default' }], currentModeId: 'default' } } });
        else if (m.method === 'session/set_mode') out({ id: m.id, result: {} });
        else if (m.method === 'session/prompt') {
          promptId = m.id;
          out({ method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '고칠게요. ' } } } });
          if (hangPrompt) continue;
          if (permission) out({ id: 'perm-1', method: 'session/request_permission', params: { sessionId: SID, toolCall: { toolCallId: 'tc1', title: 'Edit src/a.js', kind: 'edit' },
            options: [{ optionId: 'ok1', name: 'Allow', kind: 'allow_once' }, { optionId: 'okA', name: 'Always', kind: 'allow_always' }, { optionId: 'no1', name: 'Reject', kind: 'reject_once' }] } });
          else { out({ method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '끝.' } } } }); out({ id: m.id, result: { stopReason: 'end_turn' } }); }
        } else if (m.id === 'perm-1' && m.result) {
          replies.set('perm-1', m.result);
          out({ method: 'session/update', params: { sessionId: SID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '끝.' } } } });
          out({ id: promptId, result: { stopReason: 'end_turn' } });
        } else if (m.method === 'session/cancel') out({ id: promptId, result: { stopReason: 'cancelled' } });
      }
    } };
    seen.args = args; seen.env = o.env;
    return child;
  };
  return { spawnImpl, seen, replies };
}

test('질문만: 계획 방식으로 바꾸고, 허락 요청은 거부(reject_once), 답 조각을 모음', async () => {
  const f = fakeAgent();
  const r = await acpTurn({ bin: 'agy', sessionId: SID, question: 'q', cwd: '.', spawnImpl: f.spawnImpl });
  assert.equal(r.answer, '고칠게요. 끝.');
  assert.deepEqual(f.seen.map((m) => m.method).filter(Boolean), ['initialize', 'session/resume', 'session/set_mode', 'session/prompt']);
  assert.equal(f.seen.find((m) => m.method === 'session/resume').params.sessionId, SID, '같은 대화를 이어 붙음(새 세션 아님)');
  assert.ok(!f.seen.some((m) => m.method === 'session/new'));
  assert.deepEqual(f.replies.get('perm-1'), { outcome: { outcome: 'selected', optionId: 'no1' } });
});

test('작업 모드: 허락 요청을 승인 카드로 — 허용이면 allow_once(늘 허용은 고르지 않음), 거부면 reject_once', async () => {
  const asked = [];
  const f = fakeAgent();
  const r = await acpTurn({ bin: 'agy', sessionId: SID, question: 'q', cwd: 'D:/w', workMode: true, spawnImpl: f.spawnImpl, approve: async (a) => { asked.push(a); return 'accept'; } });
  assert.equal(r.answer, '고칠게요. 끝.');
  assert.deepEqual(asked, [{ kind: 'file', summary: 'Edit src/a.js', cwd: 'D:/w', itemId: 'tc1' }]);
  assert.deepEqual(f.replies.get('perm-1'), { outcome: { outcome: 'selected', optionId: 'ok1' } });
  assert.ok(!f.seen.some((m) => m.method === 'session/set_mode'), '작업 모드는 계획 방식으로 바꾸지 않음');
  const g = fakeAgent();
  await acpTurn({ bin: 'agy', sessionId: SID, question: 'q', cwd: '.', workMode: true, spawnImpl: g.spawnImpl, approve: async () => 'decline' });
  assert.deepEqual(g.replies.get('perm-1'), { outcome: { outcome: 'selected', optionId: 'no1' } });
});

test('불러오기 실패는 실행 안 됨(새 세션으로 대체하지 않음), 멈춤은 session/cancel', async () => {
  const f = fakeAgent({ resumeError: 'conversation not found' });
  await assert.rejects(acpTurn({ bin: 'agy', sessionId: SID, question: 'q', cwd: '.', spawnImpl: f.spawnImpl }), (e) => e.code === 'session_load_failed');
  assert.ok(!f.seen.some((m) => m.method === 'session/new' || m.method === 'session/prompt'));
  const g = fakeAgent({ hangPrompt: true });
  const ac = new AbortController();
  const p = acpTurn({ bin: 'agy', sessionId: SID, question: 'q', cwd: '.', spawnImpl: g.spawnImpl, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 30));
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'StoppedError' || e.constructor?.name === 'StoppedError');
  assert.ok(g.seen.some((m) => m.method === 'session/cancel'));
});

test('Antigravity 어댑터: 작업 모드면 ACP(같은 대화·승인 전달), 질문만이면 지금처럼 한 번 실행', async () => {
  const calls = []; const runs = [];
  const a = cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [SID], bin: 'agy', probe: () => 'NO_LOCK_FILE',
    acp: async (o) => { calls.push(o); return { answer: 'acp 답' }; },
    run: async (bin, args) => { runs.push(args); return { code: 0, stdout: JSON.stringify({ conversation_id: SID, response: '보통 답', status: 'SUCCESS' }), stderr: '' }; } });
  const approve = async () => 'accept';
  const w = await a.run({ sessionRef: SID, question: 'q', workMode: true }, { approve });
  assert.deepEqual([w.answer, calls[0].sessionId, calls[0].workMode, calls[0].approve, calls[0].args], ['acp 답', SID, true, approve, ['acp']]);
  await a.run({ sessionRef: SID, question: 'q' }, { approve });
  assert.equal(calls.length, 1); assert.equal(runs.length, 1, '질문만은 ACP를 쓰지 않음');
  const g = cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: ['abcdef-1'], bin: 'grok', run: async () => ({ code: 0, stdout: '{}', stderr: '' }) });
  await assert.rejects(g.run({ sessionRef: 'abcdef-1', question: 'q', workMode: true }), (e) => e.code === 'work_mode_not_supported');
});
