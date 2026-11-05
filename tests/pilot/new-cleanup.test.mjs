import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempStore, owner, stranger } from './helpers.mjs';
import { loadNewSessionsConfig, removeWorkspace } from '../../src/pilot/new-sessions.mjs';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const cfg = (over = {}) => loadNewSessionsConfig({ enabled: true, workspaceRoot: '/ws', ...over });
const ID = (n) => `0000000${n}-1111-4222-8333-444444444444`;

// 새 세션을 만들고 질문 1회를 끝내 active로 만든다. at: 그 질문이 끝난 시각.
function activeSession(store, name, at, engine = 'codex', n = 1) {
  store.createSession(owner, { engine, name, hostId: 'h_sinsan', via: 'web' }, cfg());
  const r = store.submit(owner, `n_${name}`, `k-${name}-0`, { question: 'q' });
  store.claim('h_sinsan');
  store.report('h_sinsan', r.requestId, { status: 'completed', answer: 'a', sessionRef: ID(n) }, { now: at });
  return `n_${name}`;
}
const state = (store, id) => store.conversations(owner).find((c) => c.conversationId === id)?.newSession.state;

test('정리: 30분 유휴면 잠들고, 14일 미사용이면 보관된다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const id = activeSession(store, 'idle', t0);
  assert.deepEqual(store.runCleanup(cfg(), t0 + 29 * MIN).changes, []);
  assert.deepEqual(store.runCleanup(cfg(), t0 + 31 * MIN).changes, [{ conversationId: id, name: 'idle', from: 'active', to: 'sleeping' }]);
  assert.equal(state(store, id), 'sleeping');
  assert.deepEqual(store.runCleanup(cfg(), t0 + 14 * DAY + MIN).changes, [{ conversationId: id, name: 'idle', from: 'sleeping', to: 'archived' }]);
  assert.equal(state(store, id), 'archived');
});

test('정리: 처리 중이거나 확인 필요 잠금이 있는 세션은 어떤 단계도 적용하지 않는다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const id = activeSession(store, 'busy', t0);
  const r = store.submit(owner, id, 'k2', { question: 'q2' });
  store.claim('h_sinsan');
  store.report('h_sinsan', r.requestId, { status: 'unknown', errorCode: 'result_unknown' }, { now: t0 });
  assert.deepEqual(store.runCleanup(cfg(), t0 + 30 * DAY).changes, []);
  assert.equal(state(store, id), 'active');
});

test('잠든 세션은 질문하면 깨어나고, 보관된 세션은 꺼낼 때까지 질문을 받지 않는다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const id = activeSession(store, 'nap', t0);
  store.runCleanup(cfg(), t0 + 31 * MIN);
  assert.equal(store.submit(owner, id, 'k2', { question: 'q2' }).http, 202);
  assert.equal(state(store, id), 'active');
  const j = store.claim('h_sinsan');
  store.report('h_sinsan', j.requestId, { status: 'completed', answer: 'a' }, { now: t0 + 40 * MIN });
  store.runCleanup(cfg(), t0 + 40 * MIN + 15 * DAY);
  assert.equal(state(store, id), 'archived');
  assert.deepEqual(store.submit(owner, id, 'k3', { question: 'q3' }), { http: 409, code: 'session_archived' });
  assert.ok(!store.conversations(owner).some((c) => c.conversationId === id && c.newSession.state !== 'archived'));
});

test('보관 꺼내기: 한도 안에서만 되고 잠든 상태로 돌아온다. 다른 사용자는 못 한다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const c = cfg({ limits: { maxSessions: 1, maxActive: 1 } });
  const id = activeSession(store, 'old', t0);
  store.runCleanup(c, t0 + 15 * DAY);
  assert.equal(store.createSession(owner, { engine: 'codex', name: 'fresh', hostId: 'h_sinsan', via: 'web' }, c).http, 201);
  assert.deepEqual(store.restoreSession(owner, id, c), { http: 409, code: 'session_limit', limit: 1 });
  assert.deepEqual(store.restoreSession(stranger, id, c), { http: 404, code: 'not_found' });
  assert.equal(store.deleteSession(owner, 'n_fresh', { confirm: 'fresh' }, c).http, 200);
  assert.deepEqual(store.restoreSession(owner, id, c), { http: 200, conversationId: id, state: 'sleeping' });
});

test('삭제: 이름 확인이 맞아야 하고 잠금이 있으면 거절한다. 지우면 목록·기록에서 사라진다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const id = activeSession(store, 'gone', t0);
  assert.deepEqual(store.deleteSession(owner, id, { confirm: 'nope' }, cfg()), { http: 400, code: 'confirm_mismatch' });
  store.submit(owner, id, 'k2', { question: 'q2' });
  assert.deepEqual(store.deleteSession(owner, id, { confirm: 'gone' }, cfg()), { http: 409, code: 'conversation_busy' });
  const j = store.claim('h_sinsan');
  store.report('h_sinsan', j.requestId, { status: 'completed', answer: 'a' }, { now: t0 });
  const r = store.deleteSession(owner, id, { confirm: 'gone' }, cfg());
  assert.deepEqual(r, { http: 200, conversationId: id, name: 'gone', workspace: '/ws/gone', removeWorkspace: false });
  assert.equal(store.conversations(owner).length, 0);
  assert.equal(store.messages(owner, id), null);
  // 기존 세션 연결은 이 경로로 지울 수 없다.
  const h = tempStore(t);
  assert.deepEqual(h.store.deleteSession(owner, 'c_codex', { confirm: 'c_codex' }, cfg()), { http: 404, code: 'not_found' });
});

test('동시 실행 한도: 새 세션의 처리 중 질문이 maxActive개면 다음 새 세션 질문은 기다리게 한다', (t) => {
  const { store } = tempStore(t);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const c = cfg({ limits: { maxSessions: 5, maxActive: 2 } });
  store.configureNewSessions(c);
  const a = activeSession(store, 'a1', t0, 'codex', 1);
  const b = activeSession(store, 'b1', t0, 'codex', 2);
  const d = activeSession(store, 'd1', t0, 'claude', 3);
  assert.equal(store.submit(owner, a, 'x1', { question: 'q' }).http, 202);
  assert.equal(store.submit(owner, b, 'x1', { question: 'q' }).http, 202);
  assert.deepEqual(store.submit(owner, d, 'x1', { question: 'q' }), { http: 409, code: 'active_limit', limit: 2 });
  // 기존 세션 연결은 이 한도와 관계없다.
  assert.equal(store.submit(owner, 'c_codex', 'x1', { question: 'q' }).http, 202);
});

test('보관 예고: 보관까지 3일 이내인 세션을 하루 한 번만 알린다', (t) => {
  const { store } = tempStore(t, []);
  const t0 = Date.parse('2026-11-05T00:00:00Z');
  const id = activeSession(store, 'soon', t0);
  assert.deepEqual(store.runCleanup(cfg(), t0 + 10 * DAY).notices, []);
  const n1 = store.runCleanup(cfg(), t0 + 11 * DAY + MIN).notices;
  assert.equal(n1.length, 1);
  assert.equal(n1[0].conversationId, id);
  assert.equal(n1[0].archiveAt, new Date(t0 + 14 * DAY).toISOString());
  assert.deepEqual(store.runCleanup(cfg(), t0 + 11 * DAY + 2 * MIN).notices, []);
  assert.equal(store.runCleanup(cfg(), t0 + 12 * DAY + 2 * MIN).notices.length, 1);
});

test('작업 폴더 삭제는 workspaceRoot 바로 아래 같은 이름 폴더만 지운다', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ieon-rm-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const c = loadNewSessionsConfig({ enabled: true, workspaceRoot: root });
  mkdirSync(join(root, 'proj')); writeFileSync(join(root, 'proj', 'a.txt'), 'x');
  assert.equal(removeWorkspace(c, 'proj', join(root, 'proj')), true);
  assert.equal(existsSync(join(root, 'proj')), false);
  for (const [name, path] of [['x', root], ['..', join(root, '..')], ['proj2', join(root, 'other')]]) {
    assert.throws(() => removeWorkspace(c, name, path), /bad_workspace/);
  }
  assert.ok(existsSync(root));
});

test('서버: 세션 목록에 새 세션 상태·이름이 보이고, 설정이 있으면 주기 정리가 돈다', async (t) => {
  const { createApp } = await import('../../src/pilot/server.mjs');
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const dir = mkdtempSync(join(tmpdir(), 'ieon-n3s-'));
  const nsPath = join(dir, 'new-sessions.json');
  writeFileSync(nsPath, JSON.stringify({ enabled: true, workspaceRoot: '/ws', cleanup: { idleSleepMinutes: 1 } }));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), users: [{ tokenSha256: sha('tok'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [], bindings: [], newSessionsConfigPath: nsPath, cleanupIntervalMs: 50 });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const t0 = Date.now() - 2 * MIN;
  activeSession(app.store, 'srv', t0);
  const port = await app.listen(0);
  await new Promise((r) => setTimeout(r, 200));
  const body = await (await fetch(`http://127.0.0.1:${port}/v1/conversations`, { headers: { authorization: 'Bearer tok' } })).json();
  assert.deepEqual(body.conversations[0].newSession, { name: 'srv', state: 'sleeping', profile: 'workspace', sessionId: ID(1) });
  assert.equal(body.conversations[0].label, 'srv');
});
