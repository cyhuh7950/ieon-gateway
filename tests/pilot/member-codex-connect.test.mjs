// 가입자 대화 붙이기(2026-11-19 신산님 "1번 진행하자"): 허브 화면에서 내 PC를 고르면 그 PC의 최근 Codex 대화 목록을 받아
// [연결] 한 번으로 그 PC 허용 목록 + 내 대화 등록. 남의 PC는 못 고르고, 업무 대화는 PC에 보내지도 않음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { EXCLUDED_THREAD } from '../../src/pilot/lock-probe.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-0000000000c1';
const T2 = '01a18790-0000-7000-8000-0000000000c2';

test('기기 명령: codex.threads는 업무 대화를 빼고 연결 여부를 붙임, codex.connect는 허용 목록에 넣음(형식·업무 대화 거절)', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-mcc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const cfg = join(d, 'connector.json'); writeFileSync(cfg, JSON.stringify({}));
  const listed = [{ threadId: T1, title: '보고서', workingDirectory: null, updatedAt: null }, { threadId: EXCLUDED_THREAD, title: '업무', workingDirectory: null, updatedAt: null },
    { threadId: T2, title: '기획', workingDirectory: join(d, 'no-such-dir'), updatedAt: null }];
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, listThreads: async () => listed });
  const none = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null });
  assert.equal((await none.run('codex.threads')).body.error, 'codex_unavailable');
  let r = await pc.run('codex.threads');
  assert.deepEqual(r.body.threads.map((x) => [x.threadId, x.connected]), [[T1, false], [T2, false]]);
  assert.equal((await pc.run('codex.connect', { threadId: 'nope' })).body.error, 'bad_session_ref');
  assert.equal((await pc.run('codex.connect', { threadId: EXCLUDED_THREAD })).body.error, 'excluded_session');
  r = await pc.run('codex.connect', { threadId: T1.toUpperCase() });
  assert.equal(r.status, 200); assert.equal(r.body.threadId, T1);
  r = await pc.run('codex.connect', { threadId: T2, workingDirectory: join(d, 'no-such-dir') }); // 없는 폴더여도 연결은 됨(폴더는 비움)
  assert.equal(r.status, 200);
  const saved = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.ok(JSON.stringify(saved).includes(T1) && JSON.stringify(saved).includes(T2));
  assert.ok(!JSON.stringify(saved).includes(EXCLUDED_THREAD));
  assert.deepEqual((await pc.run('codex.threads')).body.threads.map((x) => x.connected), [true, true]);
});

test('허브: 가입자가 내 PC의 Codex 대화를 골라 연결 → 내 대화로 등록(다시 연결하면 그대로), 남의 PC·업무 대화는 거절, 관리자에게 안 보임', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-mcc-hub-'));
  const app = createApp({ dbPath: join(d, 'p.db'), adminTimeoutMs: 5000, webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const browser = () => {
    let cookie = '';
    return async (path, { method = 'GET', body } = {}) => {
      const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) } });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    };
  };
  const admin = browser(); const u = browser(); const other = browser();
  await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } });
  await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } });
  await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123' } });
  await other('/v1/auth/signup', { method: 'POST', body: { email: 'o@example.com', password: 'o-password-123' } });
  for (const x of (await admin('/v1/admin/users')).body.users) await admin(`/v1/admin/users/${x.userId}/approve`, { method: 'POST', body: {} });
  const dev = await u('/v1/admin/devices', { method: 'POST', body: { hostId: 'h_upc', name: '내 PC' } });
  assert.equal(dev.status, 201);
  // PC 흉내: 허브에 붙어 있고, 맡긴 명령을 가져가 결과를 보냄
  const pcCall = (path, { method = 'GET', body } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body), headers: { authorization: `Bearer ${dev.body.token}`, 'content-type': 'application/json' } })
    .then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
  await pcCall('/v1/device/jobs');
  const seen = [];
  const answer = async (reply) => {
    for (let i = 0; i < 100; i++) {
      const c = await pcCall('/v1/device/admin');
      if (c.status === 200) { seen.push([c.body.op, c.body.args]); return pcCall(`/v1/device/admin/${c.body.id}/result`, { method: 'POST', body: reply(c.body) }); }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('no admin job');
  };
  const run = (who, op, args) => who('/v1/admin/hosts/h_upc/run', { method: 'POST', body: { op, args } });
  const [list] = await Promise.all([run(u, 'codex.threads'), answer(() => ({ status: 200, body: { threads: [{ threadId: T1, title: '보고서', connected: false }] } }))]);
  assert.deepEqual(list.body.threads.map((x) => x.threadId), [T1]);
  const [r] = await Promise.all([run(u, 'codex.connect', { threadId: T1, label: '보고서' }), answer((c) => ({ status: 200, body: { threadId: c.args.threadId } }))]);
  assert.equal(r.status, 200); assert.equal(r.body.created, true);
  const conv = (await u('/v1/conversations')).body.conversations.find((c) => c.conversationId === r.body.conversationId);
  assert.deepEqual([conv.engine, conv.label], ['codex_thread', '보고서']);
  assert.ok(app.store.listBindings().some((b) => b.conversationId === r.body.conversationId && b.hostId === 'h_upc' && b.sessionRef === T1), '내 PC·그 대화로 등록');
  const [again] = await Promise.all([run(u, 'codex.connect', { threadId: T1, label: '보고서' }), answer((c) => ({ status: 200, body: { threadId: c.args.threadId } }))]);
  assert.deepEqual([again.body.conversationId, again.body.created], [r.body.conversationId, false]);
  // 업무 대화는 PC에 맡기지도 않고 거절
  const n = seen.length;
  assert.equal((await run(u, 'codex.connect', { threadId: EXCLUDED_THREAD })).body.error, 'excluded_session');
  assert.equal(seen.length, n);
  // 다른 가입자는 내 PC를 못 고름, 관리자에게 내 대화가 안 보임
  assert.equal((await run(other, 'codex.threads')).body.error, 'unknown_host');
  assert.ok(!JSON.stringify((await admin('/v1/conversations')).body).includes(r.body.conversationId));
  assert.ok(!JSON.stringify((await other('/v1/conversations')).body).includes(r.body.conversationId));
});

test('화면: 허브의 대화 연결은 내 PC를 골라 그 PC 목록·연결로(이 PC 화면은 그대로)', () => {
  const html = readFileSync(new URL('../../src/pilot/web/app.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="connHost"') && html.includes("op: 'codex.threads'") && html.includes("op: 'codex.connect'"));
  assert.ok(html.includes("api('/v1/admin/local/threads')") && html.includes("api('/v1/admin/connections'"), '이 PC 화면 연결은 그대로');
  assert.ok(!html.includes("location.href = '/settings#conv'; return; } // 허브 화면"), '허브에서 설정으로 보내지 않음');
  assert.ok(html.includes("if (authState?.mode !== 'hub') { location.href = '/settings#conv'") && !html.includes('if (!hubMode) { location.href'), '허브 화면은 auth state의 mode로 판정');
});
