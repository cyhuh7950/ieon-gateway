// W2b: 외부 프로그램 API 키 — 웹에서 발급·세션 고르기·폐기, server.json을 고치지 않는다(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('API 키: 발급(키는 한 번만), 고른 세션만 보이고, 관리 API는 못 쓰며, 폐기하면 바로 401', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w2b-'));
  const app = createApp({ dbPath: join(dir, 'pc.db'), devices: [], users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    bindings: [
      { conversationId: 'c_a', label: 'A', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: 't1' },
      { conversationId: 'c_b', label: 'B', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: 't2' },
    ] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const made = await call('/v1/admin/apps', { method: 'POST', body: { name: '내 자동화' } });
  assert.equal(made.status, 201);
  assert.equal(made.body.appId, 'app_ext_app'); // 영문이 없으면 기본 이름
  assert.match(made.body.key, /^[0-9a-f]{64}$/);
  const key = made.body.key;
  assert.ok(!JSON.stringify((await call('/v1/admin/apps')).body).includes(key)); // 목록에는 키가 없다
  assert.deepEqual((await call('/v1/conversations', { token: key })).body.conversations, []);
  assert.deepEqual((await call(`/v1/admin/apps/${made.body.appId}/sessions`, { method: 'PUT', body: { sessions: ['c_b'] } })).body, { sessions: ['c_b'] });
  assert.deepEqual((await call('/v1/conversations', { token: key })).body.conversations.map((c) => c.conversationId), ['c_b']);
  assert.equal((await call('/v1/admin/apps', { token: key })).body.error, 'admin_only');
  assert.equal((await call(`/v1/admin/apps/${made.body.appId}/sessions`, { method: 'PUT', body: { sessions: ['c_zz'] } })).body.error, 'unknown_session');
  const second = await call('/v1/admin/apps', { method: 'POST', body: { name: 'my bot' } });
  assert.equal(second.body.appId, 'app_ext_my_bot');
  assert.equal((await call(`/v1/admin/apps/${made.body.appId}/revoke`, { method: 'POST', body: {} })).body.revoked, true);
  assert.equal((await call('/v1/conversations', { token: key })).status, 401);
  assert.equal((await call('/v1/conversations', { token: second.body.key })).status, 200); // 다른 키는 그대로
});
