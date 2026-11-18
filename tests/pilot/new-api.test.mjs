// 새 세션 API(N4) 검사(모델 0). 실제 서버를 0번 포트로 띄워 HTTP로 부른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t, nsConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-n4-'));
  const ws = join(dir, 'ws');
  const nsPath = join(dir, 'new-sessions.json');
  writeFileSync(nsPath, JSON.stringify({ enabled: true, workspaceRoot: ws, ...nsConfig }));
  const app = createApp({
    dbPath: join(dir, 'pilot.db'), newSessionsConfigPath: nsPath,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' },
      { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' },
      { tokenSha256: sha('mine'), userId: 'u_sinsan', appId: 'app_myapp' },
      { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }],
    bindings: [{ conversationId: 'c_codex', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 'thread-1' }],
  });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'web', method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  return { app, call, ws };
}

test('POST /v1/sessions: 웹·메신저에서 만들면 201, 목록에 새 세션으로 보인다', async (t) => {
  const { call } = await setup(t);
  const r = await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'web-one' } });
  assert.deepEqual(r, { status: 201, body: { conversationId: 'n_web-one', name: 'web-one', engine: 'codex', profile: 'workspace' } });
  assert.equal((await call('/v1/sessions', { token: 'msg', method: 'POST', body: { engine: 'claude', name: 'chat-one', profile: 'read_only' } })).status, 201);
  const list = (await call('/v1/conversations')).body.conversations;
  assert.deepEqual(list.map((c) => [c.conversationId, c.engine, c.newSession?.state]),
    [['c_codex', 'codex_thread', undefined], ['n_web-one', 'codex_thread', 'pending'], ['n_chat-one', 'claude_cli', 'pending']]);
});

test('POST /v1/sessions: 거절 사유를 그대로 돌려준다', async (t) => {
  const { call } = await setup(t, { limits: { maxSessions: 1, maxActive: 1 } });
  assert.deepEqual((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'x', } })).body, { error: 'bad_name' });
  assert.deepEqual((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'ok1', profile: 'full' } })).body, { error: 'profile_not_allowed' });
  assert.deepEqual((await call('/v1/sessions', { token: 'mine', method: 'POST', body: { engine: 'codex', name: 'ok1' } })).body, { error: 'app_not_allowed' });
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'ok1' } })).status, 201);
  assert.deepEqual(await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'ok2' } }), { status: 409, body: { error: 'session_limit', limit: 1 } });
  assert.deepEqual((await call('/v1/sessions/limits')).body, { sessions: 1, maxSessions: 1, perEngine: { codex: 1, claude: 0 },
    maxPerEngine: { codex: 30, claude: 10 }, maxActive: 1 }); // 규칙 점검 9 기본값
});

test('기능이 꺼져 있으면 세션 API는 모두 403', async (t) => {
  const { call } = await setup(t, { enabled: false });
  for (const [path, method] of [['/v1/sessions', 'POST'], ['/v1/sessions/limits', 'GET'], ['/v1/sessions/n_x/sleep', 'POST']]) {
    assert.deepEqual((await call(path, { method, body: method === 'GET' ? undefined : {} })).body, { error: 'new_sessions_disabled' }, path);
  }
});

test('잠재우기·꺼내기·삭제: 상태와 이름 확인을 지키고 작업 폴더는 설정에 따라 지운다', async (t) => {
  const { app, call, ws } = await setup(t, { cleanup: { deleteWorkspaceOnClose: true } });
  await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'life' } });
  assert.deepEqual((await call('/v1/sessions/n_life/sleep', { method: 'POST' })).body, { error: 'not_active' });
  app.store.setSessionState('n_life', 'active');
  assert.deepEqual((await call('/v1/sessions/n_life/sleep', { method: 'POST' })).body, { conversationId: 'n_life', state: 'sleeping' });
  assert.deepEqual((await call('/v1/sessions/n_life/restore', { method: 'POST' })).body, { error: 'not_archived' });
  app.store.setSessionState('n_life', 'archived');
  assert.deepEqual((await call('/v1/sessions/n_life/restore', { method: 'POST' })).body, { conversationId: 'n_life', state: 'sleeping' });
  assert.equal((await call('/v1/sessions/n_life/sleep', { token: 'other', method: 'POST' })).status, 404);
  mkdirSync(join(ws, 'life'), { recursive: true });
  assert.deepEqual((await call('/v1/sessions/n_life', { method: 'DELETE', body: { confirm: 'nope' } })).body, { error: 'confirm_mismatch' });
  assert.deepEqual((await call('/v1/sessions/n_life', { method: 'DELETE', body: { confirm: 'life' } })).body,
    { conversationId: 'n_life', deleted: true, workspaceRemoved: true });
  assert.equal(existsSync(join(ws, 'life')), false);
  assert.equal((await call('/v1/conversations')).body.conversations.length, 1);
});

test('보관 예고: after 이후 것만, 내 세션 것만 돌려준다', async (t) => {
  const { app, call } = await setup(t);
  await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'soon' } });
  app.notices.push({ conversationId: 'n_soon', name: 'soon', archiveAt: '2026-11-19T00:00:00.000Z', at: '2026-11-16T00:00:00.000Z' },
    { conversationId: 'n_someone', name: 'someone', archiveAt: '2026-11-19T00:00:00.000Z', at: '2026-11-16T00:00:01.000Z' });
  assert.deepEqual((await call('/v1/sessions/notices')).body.notices.map((n) => n.name), ['soon']);
  assert.deepEqual((await call('/v1/sessions/notices?after=2026-11-16T00:00:00.000Z')).body.notices, []);
});

test('새 세션 켜기는 서버가 판단한다: 설정 파일이 꺼짐이어도 연결부는 새 세션을 준비한다(웹에서 켠 경우 동작)', async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildAdapters } = await import('../../src/pilot/adapters/index.mjs');
  const d = mkdtempSync(join(tmpdir(), 'ieon-ns-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'ns.json'), JSON.stringify({ enabled: false, workspaceRoot: d }));
  const a = await buildAdapters({ live: false, codex: { allowlist: [] }, newSessions: { configPath: join(d, 'ns.json'), createdPath: join(d, 'c.jsonl') } });
  await assert.rejects(a.codex_thread.run({ sessionRef: null, question: 'q', newSession: { name: 'x' } }), (e) => e.code === 'live_disabled');
});
