import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStore, owner } from './helpers.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';
import { loadNewSessionsConfig } from '../../src/pilot/new-sessions.mjs';

// claude -p 대역: 인자·입력·작업 폴더를 기록하고 json 결과를 돌려준다.
function fakeClaude(result = {}) {
  const calls = [];
  const spawnClaude = async (args, input, { cwd }) => {
    calls.push({ args, input, cwd });
    const flag = args.includes('--session-id') ? '--session-id' : '--resume';
    const id = args[args.indexOf(flag) + 1];
    return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '답',
      session_id: id, permission_denials: [], usage: { input_tokens: 3, output_tokens: 1 }, ...result }) };
  };
  return { calls, spawnClaude };
}

function setup(t, { config = {}, claude = fakeClaude(), live = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ieon-cl-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: root, ...config });
  const created = new Map();
  const adapter = claudeCliAdapter({ live, spawnClaude: claude.spawnClaude,
    newSessions: { config: cfg, created: { has: (id) => created.has(id), add: (id, name) => created.set(id, name) } } });
  return { adapter, claude, created, root };
}
const job = (root, extra = {}) => ({ sessionRef: 'pending:x', question: 'q1',
  newSession: { name: 'cl', profile: 'workspace', workspace: join(root, 'cl') }, ...extra });
const arg = (args, flag) => args[args.indexOf(flag) + 1];

test('pending Claude 세션의 첫 질문은 작업 폴더를 만들고 새 세션 ID로 claude -p를 실행한다', async (t) => {
  const { adapter, claude, created, root } = setup(t);
  const r = await adapter.run(job(root));
  const { args, input, cwd } = claude.calls[0];
  assert.ok(existsSync(join(root, 'cl')));
  assert.equal(cwd, join(root, 'cl'));
  assert.equal(input, 'q1'); // 질문은 명령줄이 아니라 표준 입력으로만 넘긴다.
  assert.match(arg(args, '--session-id'), /^[0-9a-f-]{36}$/);
  for (const f of ['-p', '--restricted', '--strict-mcp-config']) assert.ok(args.includes(f), f);
  assert.equal(arg(args, '--output-format'), 'json');
  assert.equal(arg(args, '--permission-prompts'), 'none');
  assert.equal(arg(args, '--tools'), 'Read,Grep,Glob,Edit,Write');
  assert.equal(arg(args, '--allowedTools'), 'Read,Grep,Glob,Edit,Write');
  assert.ok(!args.includes('--dangerously-skip-permissions') && !args.includes('bypassPermissions'));
  assert.equal(r.sessionRef, arg(args, '--session-id'));
  assert.equal(r.answer, '답');
  assert.deepEqual(r.usage, { inputTokens: 3, outputTokens: 1 });
  assert.equal(created.get(r.sessionRef), 'cl');
});

test('만든 세션은 같은 ID로 --resume하고, 연결부가 만들지 않은 ID는 거부한다', async (t) => {
  const { adapter, claude, root } = setup(t);
  const first = await adapter.run(job(root));
  await adapter.run(job(root, { sessionRef: first.sessionRef, question: 'q2' }));
  assert.equal(arg(claude.calls[1].args, '--resume'), first.sessionRef);
  assert.ok(!claude.calls[1].args.includes('--session-id'));
  await assert.rejects(adapter.run(job(root, { sessionRef: '11111111-2222-4333-8444-555555555555' })), { code: 'session_not_allowed' });
});

test('권한 거부가 있었으면 멈춰 확인을 요청하고 세션 ID는 남긴다', async (t) => {
  const { adapter, root } = setup(t, { claude: fakeClaude({ permission_denials: [{ tool_name: 'Bash' }] }) });
  const r = await adapter.run(job(root));
  assert.equal(r.approvalRequired, true);
  assert.match(r.sessionRef, /^[0-9a-f-]{36}$/);
});

test('사람이 같은 세션을 열고 있어 다른 ID(복사본)로 실행됐으면 결과 불명으로 넘긴다', async (t) => {
  const claude = fakeClaude();
  const { adapter, root } = setup(t, { claude });
  const first = await adapter.run(job(root));
  claude.spawnClaude = async () => ({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', result: 'x',
    session_id: '99999999-2222-4333-8444-555555555555', permission_denials: [] }) });
  const forked = claudeCliAdapter({ live: true, spawnClaude: claude.spawnClaude,
    newSessions: { config: loadNewSessionsConfig({ enabled: true, workspaceRoot: root }), created: { has: () => true, add() {} } } });
  await assert.rejects(forked.run(job(root, { sessionRef: first.sessionRef })), (e) => e.unknownCode === 'session_forked');
});

test('프로필별 도구: read_only는 읽기만, full은 override가 있을 때만 Bash·WebFetch를 연다', async (t) => {
  const claude = fakeClaude();
  const { adapter, root } = setup(t, { claude, config: { sessionOverrides: { box: { profile: 'full' } } } });
  await adapter.run(job(root, { newSession: { name: 'ro', profile: 'read_only', workspace: join(root, 'ro') } }));
  assert.equal(arg(claude.calls[0].args, '--tools'), 'Read,Grep,Glob');
  await assert.rejects(adapter.run(job(root, { newSession: { name: 'x1', profile: 'full', workspace: join(root, 'x1') } })), { code: 'profile_not_allowed' });
  await adapter.run(job(root, { newSession: { name: 'box', profile: 'workspace', workspace: join(root, 'box') } }));
  assert.equal(arg(claude.calls[1].args, '--tools'), 'Read,Grep,Glob,Edit,Write,Bash,WebFetch');
});

test('live가 꺼져 있거나 실행이 실패하면 실행하지 않거나 실패로 넘긴다', async (t) => {
  const off = setup(t, { live: false });
  await assert.rejects(off.adapter.run(job(off.root)), { code: 'live_disabled' });
  assert.equal(off.claude.calls.length, 0);
  const err = setup(t, { claude: fakeClaude({ is_error: true, subtype: 'error_during_execution' }) });
  await assert.rejects(err.adapter.run(job(err.root)), (e) => e.unknownCode === 'claude_error' && /^[0-9a-f-]{36}$/.test(e.sessionRef));
});

test('작업 폴더는 이 연결부의 workspaceRoot 바로 아래만 — 허브가 보낸 경로 앞부분은 쓰지 않고, 이름이 다르면 거부(SV2)', async (t) => {
  const { adapter, claude, root } = setup(t);
  // 허브(다른 기계)의 경로가 와도 이 연결부(엔진 칸)의 뿌리 + 이름으로 실행 — 밖으로 나가지 않는다
  await adapter.run(job(root, { newSession: { name: 'cl', profile: 'workspace', workspace: join(root, '..', 'other-machine', 'cl') } }));
  assert.equal(claude.calls[0].cwd, join(root, 'cl'));
  await assert.rejects(adapter.run(job(root, { newSession: { name: 'cl', profile: 'workspace', workspace: join(root, '..', 'escape') } })),
    { code: 'bad_workspace' });
});

test('서버: Claude 새 세션은 채널 상태와 관계없이 접수되고 첫 결과로 active가 된다', (t) => {
  const { store } = tempStore(t, []);
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: '/ws' });
  store.createSession(owner, { engine: 'claude', name: 'cl', hostId: 'h_sinsan', via: 'web' }, cfg);
  const r = store.submit(owner, 'n_cl', 'k1', { question: 'q1' });
  const j = store.claim('h_sinsan');
  const id = '0f0f0f0f-1111-4222-8333-444444444444';
  store.report('h_sinsan', r.requestId, { status: 'completed', answer: 'a', sessionRef: id });
  assert.equal(j.engine, 'claude_cli');
  assert.equal(store.conversations(owner)[0].newSession.state, 'active');
  store.submit(owner, 'n_cl', 'k2', { question: 'q2' });
  assert.equal(store.claim('h_sinsan').sessionRef, id);
});
