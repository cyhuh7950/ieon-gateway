// E4 Antigravity 새 세션(신산님 2026-11-19 "9번까지 차례로"): 처음 질문은 새 대화(--conversation 없이), 받은 대화 ID로만 이어 씀,
// 권한 프로필 → --mode(plan / accept-edits / auto, auto만 샌드박스 풂), 작업 폴더는 이 연결부 설정으로 다시 검사. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStore, owner } from './helpers.mjs';
import { cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';
import { loadNewSessionsConfig, NEW_ENGINES } from '../../src/pilot/new-sessions.mjs';

const NEW_ID = '9e943423-0000-4000-8000-0000000000b1';

function setup(t, { reply = (args) => ({ conversation_id: args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : NEW_ID, status: 'SUCCESS', response: '답' }) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ieon-e4-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: root });
  const ids = new Map();
  const created = { has: (id) => ids.has(id), add: (id, name) => ids.set(id, name) };
  const calls = [];
  const adapter = cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [], bin: 'agy', probe: () => 'NO_LOCK_FILE', newSessions: { config: cfg, created },
    run: async (bin, args, o) => { calls.push({ args, cwd: o.cwd }); return { code: 0, stdout: JSON.stringify(reply(args)), stderr: '' }; } });
  return { adapter, calls, root, ids, cfg };
}
const job = (root, extra = {}) => ({ sessionRef: 'pending:x', question: 'q', newSession: { name: 'ag', profile: 'workspace', workspace: join(root, 'ag') }, ...extra });

test('설정: Antigravity가 새 세션 엔진, 프로필마다 기본 방식, 예전 설정(agy 없음)은 이름별 기본, 틀린 방식은 거부', () => {
  assert.equal(NEW_ENGINES.antigravity, 'agy_cli');
  const c = loadNewSessionsConfig({});
  assert.deepEqual([c.permissions.profiles.read_only.agy.mode, c.permissions.profiles.workspace.agy.mode, c.permissions.profiles.full.agy.mode], ['plan', 'accept-edits', 'auto']);
  assert.equal(c.limits.maxPerEngine.antigravity, 10);
  const old = loadNewSessionsConfig({ permissions: { profiles: { workspace: { codex: { sandbox: 'workspace-write', network: false }, claude: { allowedTools: ['Read'] } }, mine: { codex: { sandbox: 'read-only', network: false }, claude: { allowedTools: [] } } } } });
  assert.deepEqual([old.permissions.profiles.workspace.agy.mode, old.permissions.profiles.mine.agy.mode], ['accept-edits', 'plan']);
  assert.throws(() => loadNewSessionsConfig({ permissions: { profiles: { read_only: { codex: { sandbox: 'read-only', network: false }, claude: { allowedTools: [] }, agy: { mode: 'yolo' } } } } }), /profile\.read_only\.agy/);
});

test('처음 질문: 새 대화로 실행(--conversation 없음·작업 폴더에서·accept-edits+샌드박스), 받은 ID를 돌려주고 적어 둠, 다음은 그 ID로', async (t) => {
  const { adapter, calls, root, ids } = setup(t);
  const r = await adapter.run(job(root));
  assert.deepEqual([r.sessionRef, r.answer], [NEW_ID, '답']);
  assert.ok(!calls[0].args.includes('--conversation'));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--mode'), calls[0].args.indexOf('--mode') + 3), ['--mode', 'accept-edits', '--sandbox']);
  assert.equal(calls[0].cwd, join(root, 'ag')); assert.ok(existsSync(join(root, 'ag')));
  assert.equal(ids.get(NEW_ID), 'ag');
  await adapter.run(job(root, { sessionRef: NEW_ID }));
  assert.deepEqual(calls[1].args.slice(-2), ['--conversation', NEW_ID]);
});

test('읽기만은 plan+샌드박스, 전체는 auto(샌드박스 없음), 이어온이 만들지 않은 ID·다른 ID로 답하면 거부·결과 불명, 작업 폴더 벗어나면 거부', async (t) => {
  const { adapter, calls, root } = setup(t);
  await adapter.run(job(root, { newSession: { name: 'ag', profile: 'read_only', workspace: join(root, 'ag') } }));
  assert.ok(calls[0].args.includes('plan') && calls[0].args.includes('--sandbox'));
  const full = setup(t);
  full.cfg.permissions.allowFullFromChat = true;
  await full.adapter.run(job(full.root, { newSession: { name: 'ag', profile: 'full', workspace: join(full.root, 'ag') } }));
  assert.ok(full.calls[0].args.includes('auto') && !full.calls[0].args.includes('--sandbox'));
  await assert.rejects(adapter.run(job(root, { sessionRef: '9e943423-0000-4000-8000-0000000000ff' })), (e) => e.code === 'session_not_allowed');
  await assert.rejects(adapter.run(job(root, { newSession: { name: 'ag', profile: 'workspace', workspace: join(root, '..', 'escape') } })), (e) => e.code === 'bad_workspace');
  // 이어 쓸 때 다른 대화 ID로 답하면(새로 갈라짐) 이어 쓴 것이 아니므로 결과 불명
  const odd = setup(t, { reply: (args) => ({ conversation_id: args.includes('--conversation') ? '9e943423-0000-4000-8000-0000000000cc' : NEW_ID, status: 'SUCCESS', response: '답' }) });
  await odd.adapter.run(job(odd.root));
  await assert.rejects(odd.adapter.run(job(odd.root, { sessionRef: NEW_ID })), (e) => e.unknownCode === 'session_changed');
});

test('서버: Antigravity 새 세션 접수 → agy_cli로 실행, 첫 결과의 대화 ID로 이어 감, 엔진별 한도에 Antigravity', (t) => {
  const { store } = tempStore(t, []);
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: '/ws' });
  assert.equal(store.createSession(owner, { engine: 'antigravity', name: 'ag', hostId: 'h_sinsan', via: 'web' }, cfg).http, 201);
  const r = store.submit(owner, 'n_ag', 'k1', { question: 'q1' });
  const j = store.claim('h_sinsan');
  assert.equal(j.engine, 'agy_cli');
  store.report('h_sinsan', r.requestId, { status: 'completed', answer: 'a', sessionRef: NEW_ID });
  store.submit(owner, 'n_ag', 'k2', { question: 'q2' });
  assert.equal(store.claim('h_sinsan').sessionRef, NEW_ID);
  assert.equal(store.sessionLimits(cfg, 'h_sinsan').perEngine.antigravity, 1);
});
