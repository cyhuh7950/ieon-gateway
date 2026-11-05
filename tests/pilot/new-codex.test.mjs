import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStore, owner } from './helpers.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { loadNewSessionsConfig } from '../../src/pilot/new-sessions.mjs';

const NEW_ID = '01aaaaaa-0000-7000-8000-000000000001';

// SDK 대역: 호출 옵션을 기록하고, 지정한 item 종류를 흘려보낸다.
function fakeSdk({ items = [{ type: 'agent_message', text: '답' }], threadId = NEW_ID } = {}) {
  const calls = [];
  const thread = (kind, id, options) => {
    const t = {
      id,
      async runStreamed(question) {
        async function* events() {
          // 실제 SDK처럼 첫 이벤트를 기다릴 때 프로세스가 뜨므로 그때의 현재 폴더를 기록한다.
          calls.push({ kind, id, options, question, cwd: process.cwd() });
          yield { type: 'thread.started', thread_id: threadId };
          t.id = threadId;
          for (const item of items) {
            yield { type: 'item.started', item };
            yield { type: 'item.completed', item };
          }
          yield { type: 'turn.completed', usage: {} };
        }
        return { events: events() };
      },
    };
    return t;
  };
  class Codex {
    startThread(options) { return thread('start', null, options); }
    resumeThread(id, options) { return thread('resume', id, options); }
  }
  return { calls, loadSdk: async () => ({ Codex }) };
}

function setup(t, { config = {}, sdk = fakeSdk() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ieon-ws-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: root, ...config });
  const created = new Map();
  const adapter = codexThreadAdapter({
    live: true, allowlist: [], probe: () => 'NO_LOCK_FILE', loadSdk: sdk.loadSdk,
    newSessions: { config: cfg, created: { has: (id) => created.has(id), add: (id, name) => created.set(id, name) } },
  });
  return { adapter, sdk, cfg, created, root };
}
const job = (root, extra = {}) => ({ sessionRef: 'pending:x', question: 'q1', newSession: { name: 'proj', profile: 'workspace', workspace: join(root, 'proj') }, ...extra });

test('pending 새 세션의 첫 질문은 작업 폴더를 만들고 startThread로 새 대화를 시작해 ID를 돌려준다', async (t) => {
  const { adapter, sdk, created, root } = setup(t);
  const r = await adapter.run(job(root));
  assert.equal(r.sessionRef, NEW_ID);
  assert.equal(r.answer, '답');
  assert.ok(existsSync(join(root, 'proj')));
  assert.equal(sdk.calls[0].kind, 'start');
  assert.deepEqual(sdk.calls[0].options, { sandboxMode: 'workspace-write', approvalPolicy: 'never', networkAccessEnabled: false,
    webSearchMode: 'disabled', skipGitRepoCheck: true, workingDirectory: join(root, 'proj') });
  assert.equal(created.get(NEW_ID), 'proj');
});

test('만든 대화는 같은 ID로 resumeThread하고 작업 폴더에서 실행한다', async (t) => {
  const { adapter, sdk, created, root } = setup(t);
  await adapter.run(job(root));
  const r = await adapter.run(job(root, { sessionRef: NEW_ID, question: 'q2' }));
  assert.equal(r.sessionRef, NEW_ID);
  const resume = sdk.calls[1];
  assert.equal(resume.kind, 'resume');
  assert.equal(resume.id, NEW_ID);
  assert.equal(resume.options.sandboxMode, 'workspace-write');
  assert.equal(resume.options.workingDirectory, undefined);
  assert.equal(resume.cwd, join(root, 'proj'));
  assert.equal(created.size, 1);
});

test('연결부가 만들지 않은 대화·업무 대화는 새 세션 경로로 재개하지 않는다', async (t) => {
  const { adapter, root } = setup(t);
  for (const ref of ['01bbbbbb-0000-7000-8000-000000000002', '01a0dadd-739f-74d2-93c5-9c405cc1019b']) {
    await assert.rejects(adapter.run(job(root, { sessionRef: ref })), { code: 'thread_not_allowed' });
  }
});

test('프로필별 옵션: read_only는 읽기 전용, full은 설정 파일 override가 있을 때만 네트워크를 연다', async (t) => {
  const sdk = fakeSdk();
  const { adapter, root } = setup(t, { sdk, config: { sessionOverrides: { boxed: { profile: 'full' } } } });
  await adapter.run(job(root, { newSession: { name: 'ro', profile: 'read_only', workspace: join(root, 'ro') } }));
  assert.equal(sdk.calls[0].options.sandboxMode, 'read-only');
  await assert.rejects(adapter.run(job(root, { newSession: { name: 'sneaky', profile: 'full', workspace: join(root, 'sneaky') } })),
    { code: 'profile_not_allowed' });
  await adapter.run(job(root, { newSession: { name: 'boxed', profile: 'workspace', workspace: join(root, 'boxed') } }));
  assert.equal(sdk.calls[1].options.networkAccessEnabled, true);
  assert.equal(sdk.calls[1].options.webSearchMode, 'live');
});

test('workspace 프로필은 파일 변경을 허용하고 명령 실행은 멈춰 확인을 요청한다', async (t) => {
  const ok = setup(t, { sdk: fakeSdk({ items: [{ type: 'file_change', changes: [] }, { type: 'agent_message', text: '고침' }] }) });
  assert.equal((await ok.adapter.run(job(ok.root))).answer, '고침');
  const stop = setup(t, { sdk: fakeSdk({ items: [{ type: 'command_execution', command: 'npm test' }] }) });
  const r = await stop.adapter.run(job(stop.root));
  assert.equal(r.approvalRequired, true);
  assert.equal(r.sessionRef, NEW_ID); // 멈춰도 만들어진 대화 ID는 남긴다.
});

test('작업 폴더는 workspaceRoot 아래만 허용한다', async (t) => {
  const { adapter, root } = setup(t);
  await assert.rejects(adapter.run(job(root, { newSession: { name: 'proj', profile: 'workspace', workspace: join(root, '..', 'escape') } })),
    { code: 'bad_workspace' });
});

test('서버: 첫 결과의 대화 ID로 새 세션이 active가 되고 다음 작업은 그 ID로 간다. Claude pending은 계속 거절한다', (t) => {
  const { store } = tempStore(t, []);
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: '/ws' });
  store.createSession(owner, { engine: 'codex', name: 'proj', hostId: 'h_sinsan', via: 'web' }, cfg);
  store.createSession(owner, { engine: 'claude', name: 'cl', hostId: 'h_sinsan', via: 'web' }, cfg);

  const r1 = store.submit(owner, 'n_proj', 'k1', { question: 'q1' });
  assert.equal(r1.http, 202);
  const j1 = store.claim('h_sinsan');
  assert.match(j1.sessionRef, /^pending:/);
  assert.deepEqual(j1.newSession, { name: 'proj', profile: 'workspace', workspace: '/ws/proj' });
  store.report('h_sinsan', j1.requestId, { status: 'completed', answer: 'a1', sessionRef: NEW_ID });
  assert.equal(store.conversations(owner).find((c) => c.conversationId === 'n_proj').newSession.state, 'active');

  const r2 = store.submit(owner, 'n_proj', 'k2', { question: 'q2' });
  assert.equal(store.claim('h_sinsan').sessionRef, NEW_ID);
  // 이미 정해진 대화 ID는 연결부 보고로 바뀌지 않는다.
  store.report('h_sinsan', r2.requestId, { status: 'completed', answer: 'a2', sessionRef: '01cccccc-0000-7000-8000-000000000003' });
  store.submit(owner, 'n_proj', 'k3', { question: 'q3' });
  assert.equal(store.claim('h_sinsan').sessionRef, NEW_ID);
});
