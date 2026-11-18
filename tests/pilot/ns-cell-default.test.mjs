// 새 세션 기본 위치 = 켜진 첫 엔진 칸(2026-11-18 신산님 "새 세션 엔진 칸 진행"), 엔진 칸의 Codex 새 세션은 컨테이너를 경계로. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { healthHeader } from '../../src/pilot/connector.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { loadNewSessionsConfig } from '../../src/pilot/new-sessions.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-cell-')); t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } }); return d; };
const H = { codexShared: 'not_configured', claudeChannel: 'not_configured', codexAccounts: {}, codexDefault: null, claudeKind: null };

test('새 세션: 고르지 않으면 켜진 첫 엔진 칸으로, 엔진 칸이 없거나 꺼져 있으면 허브 자신', async (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'ns.json'), JSON.stringify({ enabled: true, workspaceRoot: join(d, 'ws') }));
  const app = createApp({ dbPath: join(d, 'p.db'), newSessionsConfigPath: join(d, 'ns.json'), claudeAuthDir: null,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('hub'), hostId: 'h_hub' }, { tokenSha256: sha('pc'), hostId: 'h_pc' }, { tokenSha256: sha('cell'), hostId: 'h_cell' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const call = (path, { method = 'GET', body } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const poll = (tok, h) => fetch(base + '/v1/device/jobs', { headers: { authorization: `Bearer ${tok}`, 'x-ieon-health': healthHeader({ ...H, ...h }) } });
  const ask = (conv, k) => fetch(base + `/v1/conversations/${conv}/requests`, { method: 'POST', body: JSON.stringify({ question: 'q' }),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'idempotency-key': 'k-cell-' + k } });
  // 엔진 칸이 아직 알리지 않음 → 허브 자신(첫 기기)
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'first' } })).status, 201);
  await poll('hub', { boundary: false }); // 허브 자신 켜짐(질문 접수에 필요)
  await ask('n_first', '0001');
  assert.equal((await poll('hub', { boundary: false })).status, 200, '허브 자신이 받음');
  // PC(경계 아님)와 엔진 칸(경계)이 켜져 있음 → 엔진 칸
  await poll('pc', { boundary: false });
  await poll('cell', { boundary: true });
  const devs = (await call('/v1/admin/devices')).body.devices;
  assert.deepEqual(devs.filter((x) => x.cell).map((x) => x.hostId), ['h_cell']);
  assert.deepEqual(devs.filter((x) => x.nsDefault).map((x) => x.hostId), ['h_cell']);
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'second' } })).status, 201);
  await ask('n_second', '0002');
  assert.equal((await poll('pc', { boundary: false })).status, 204, 'PC는 받지 않음');
  assert.equal((await poll('cell', { boundary: true })).status, 200, '엔진 칸이 받음');
  // 고른 곳이 있으면 그대로
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'third', hostId: 'h_pc' } })).status, 201);
});

test('엔진 칸의 Codex 새 세션: 작업 폴더 프로필은 컨테이너를 경계로(danger-full-access), 읽기 전용은 그대로', async (t) => {
  const d = tmp(t);
  const calls = [];
  class Codex { startThread(options) { calls.push(options); return { id: null, async runStreamed() { return { events: (async function* () {
    yield { type: 'thread.started', thread_id: '01aaaaaa-0000-7000-8000-00000000000c' };
    yield { type: 'item.completed', item: { type: 'agent_message', text: '답' } }; yield { type: 'turn.completed', usage: {} }; })() }; } }; } }
  const created = new Map();
  const adapter = codexThreadAdapter({ live: true, allowlist: [], probe: () => 'NO_LOCK_FILE', loadSdk: async () => ({ Codex }),
    newSessions: { config: loadNewSessionsConfig({ enabled: true, workspaceRoot: d }), created: { has: (id) => created.has(id), add: (id, n) => created.set(id, n) } } });
  const prev = process.env.IEON_CONTAINER_BOUNDARY;
  process.env.IEON_CONTAINER_BOUNDARY = '1';
  t.after(() => { if (prev === undefined) delete process.env.IEON_CONTAINER_BOUNDARY; else process.env.IEON_CONTAINER_BOUNDARY = prev; });
  await adapter.run({ sessionRef: 'pending:a', question: 'q', newSession: { name: 'cellws', profile: 'workspace', workspace: join(d, 'cellws') } });
  await adapter.run({ sessionRef: 'pending:b', question: 'q', newSession: { name: 'cellro', profile: 'read_only', workspace: join(d, 'cellro') } });
  assert.deepEqual(calls.map((c) => c.sandboxMode), ['danger-full-access', 'read-only']);
});
