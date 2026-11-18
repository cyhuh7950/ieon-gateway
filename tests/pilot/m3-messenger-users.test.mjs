// M3 공용 메신저 봇(신산님 결정: 지금 봇 그대로 같이, 카카오는 이번엔 빼기): 가입자가 연결 숫자로 자기 메신저 계정을 연결하면
// 봇이 그 사람 요청에 보낸 사람을 실어 보내고, 서버는 그 가입자 대화만 보여 줌. 연결 안 된 사람은 전처럼(관리자 대화). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('M3: 연결 숫자 → 메신저 계정 연결, 그 계정의 봇 요청은 그 가입자 대화만, 연결 안 된 사람은 관리자 대화, 카카오는 연결 안 됨, 끊으면 다시 관리자 기준', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m3-'));
  const app = createApp({ dbPath: join(d, 'p.db'), webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  let cookie = '';
  const web = async (path, { method = 'GET', body } = {}) => { const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) } }); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; };
  const msg = (path, { method = 'GET', body, sender, bot = 'telegram:default' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer msg', 'content-type': 'application/json', ...(bot ? { 'x-ieon-bot': bot } : {}), ...(sender ? { 'x-ieon-sender': sender } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  app.store.saveBot({ platform: 'telegram', botId: 'default', name: '기본 봇', roleId: null, callNames: [], extraUsers: [], enabled: true });
  // 관리자 대화(메신저에도 보임)와 가입자 대화
  app.store.setSetting('multiUser.enabled', { enabled: true });
  await web('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123' } });
  const uid = app.store.userByEmail('u@example.com').userId;
  app.store.setUserStatus(uid, 'approved');
  app.store.saveBinding('u_sinsan', { conversationId: 'c_admin', label: '관리자 대화', engine: 'codex_thread', hostId: 'h_a', sessionRef: '01a18790-0000-7000-8000-0000000000c1', appIds: ['app_web', 'app_messenger'] });
  app.store.addDevice('h_u', 'U PC', 'y'.repeat(64), uid);
  app.store.saveBinding(uid, { conversationId: 'c_user', label: '가입자 대화', engine: 'codex_thread', hostId: 'h_u', sessionRef: '01a18790-0000-7000-8000-0000000000c2', appIds: ['app_web'] });
  // 연결 전: 그 메신저 계정은 관리자 기준(관리자가 허용한 사람일 때만 봇이 받아 줌)
  assert.deepEqual((await msg('/v1/conversations', { sender: '555' })).body.conversations.map((c) => c.conversationId), ['c_admin']);
  // 가입자: 연결 숫자 받기 → 봇에 그 숫자를 보냄(메신저가 claim으로 알림)
  const code = (await web('/v1/admin/messenger/link', { method: 'POST', body: {} })).body.code;
  assert.match(code, /^\d{6}$/);
  assert.equal((await msg('/v1/messenger/claim', { method: 'POST', bot: null, body: { platform: 'kakao', botId: 'default', userId: '999', code } })).status === 200, false, '카카오는 연결 안 됨');
  assert.deepEqual((await msg('/v1/messenger/claim', { method: 'POST', bot: null, body: { platform: 'telegram', botId: 'default', userId: '555', name: '유저', code } })).body, { claimed: true, linked: true });
  assert.equal((await msg('/v1/messenger/claim', { method: 'POST', bot: null, body: { platform: 'telegram', botId: 'default', userId: '777', code } })).status === 200, false, '숫자는 한 번만');
  assert.deepEqual((await msg('/v1/messenger/config', { bot: null })).body.linkedUsers, { telegram: ['555'] });
  // 연결 뒤: 그 계정의 봇 요청은 가입자 대화만
  assert.deepEqual((await msg('/v1/conversations', { sender: '555' })).body.conversations.map((c) => c.conversationId), ['c_user']);
  assert.deepEqual((await msg('/v1/conversations', { sender: '111' })).body.conversations.map((c) => c.conversationId), ['c_admin'], '다른 사람은 그대로');
  assert.equal((await msg('/v1/conversations/c_admin/cards', { sender: '555' })).status, 404, '가입자는 관리자 대화 못 봄');
  assert.equal((await msg('/v1/admin/bots', { sender: '555' })).body.error, 'admin_only', '관리 경로는 M2 규칙');
  // 내 연결 목록·끊기
  const links = (await web('/v1/admin/messenger/link')).body;
  assert.deepEqual(links.links.map((l) => [l.platform, l.senderId, l.name]), [['telegram', '555', '유저']]);
  assert.ok(links.bots.some((b) => b.platform === 'telegram'));
  assert.equal((await web('/v1/admin/messenger/link/telegram/555', { method: 'DELETE' })).body.unlinked, true);
  assert.deepEqual((await msg('/v1/conversations', { sender: '555' })).body.conversations.map((c) => c.conversationId), ['c_admin'], '끊으면 다시 관리자 기준');
});

test('M3: 브리지는 메시지를 처리하는 동안의 서버 요청에 보낸 사람을 실음(동시에 와도 섞이지 않음)', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m3b-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const seen = [];
  const api = async (req) => { seen.push([req.path, req.headers?.['x-ieon-sender']]); await new Promise((r) => setTimeout(r, 5)); return { status: 200, body: { conversations: [] } }; };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111', '222'] }, roomsPath: join(d, 'rooms.json'), pollMs: 1, waitMs: 100 });
  await Promise.all([bridge.handle({ platform: 'telegram', userId: '111', chatId: 'A', text: '/sessions' }, async () => {}),
    bridge.handle({ platform: 'telegram', userId: '222', chatId: 'B', text: '/sessions' }, async () => {})]);
  const convCalls = seen.filter(([p]) => p === '/v1/conversations').map(([, s]) => s).sort();
  assert.deepEqual(convCalls, ['111', '222']);
});

test('M3: 메신저 봇이 가져가는 예약 답 알림에 연결된 가입자의 대화 것도 들어감(연결 안 된 가입자 것은 안 들어감)', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m3c-'));
  const app = createApp({ dbPath: join(d, 'p.db'), schedulesOff: true, users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_u' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  app.store.saveBot({ platform: 'telegram', botId: 'default', name: '기본 봇', roleId: null, callNames: [], extraUsers: [], enabled: true });
  const mk = (email) => { app.store.addUser('u_' + sha(email).slice(0, 16), email, 'x'); const id = 'u_' + sha(email).slice(0, 16); app.store.setUserStatus(id, 'approved'); return id; };
  const linked = mk('l@example.com'); const other = mk('o@example.com');
  app.store.linkMessenger('telegram', '555', linked);
  app.store.saveBinding(linked, { conversationId: 'c_l', label: '연결된 사람 대화', engine: 'codex_thread', hostId: 'h_u', sessionRef: '01a18790-0000-7000-8000-0000000000d1', appIds: ['app_web'] });
  app.store.saveBinding(other, { conversationId: 'c_o', label: '다른 사람 대화', engine: 'codex_thread', hostId: 'h_u', sessionRef: '01a18790-0000-7000-8000-0000000000d2', appIds: ['app_web'] });
  // 두 대화에 끝난 예약 질문 하나씩
  for (const [conv, owner] of [['c_l', linked], ['c_o', other]]) {
    const at = new Date(Date.now() + 60_000).toISOString();
    const s = app.store.addSchedule({ userId: owner, appId: 'app_web' }, conv, { kind: 'once', question: 'q', tz: 'Asia/Seoul', spec: { at }, maxPerDay: 1 }, { id: 'sch_' + conv.slice(2).padEnd(12, '0'), nextRunAt: at, max: 20 });
    assert.equal(s.http, 201);
  }
  await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } });
  app.runSchedules(new Date(Date.now() + 120_000));
  for (let i = 0; i < 2; i++) { const job = await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }).then((r) => (r.status === 200 ? r.json() : null)); if (job) await fetch(base + `/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'completed', answer: 'a' }) }); }
  app.runSchedules(new Date(Date.now() + 180_000));
  const notes = await fetch(base + '/v1/schedules/notices?after=', { headers: { authorization: 'Bearer msg', 'x-ieon-bot': 'telegram:default' } }).then((r) => r.json());
  assert.deepEqual(notes.notices.map((n) => n.conversationId).sort(), ['c_l'], '연결된 가입자 것만(다른 가입자 것은 안 감)');
});

test('M3: 봇은 가입자 연결 성공을 "이어온 계정과 연결됐어요"로 답함(주인 등록 문구 아님)', async () => {
  const { createBotRunner } = await import('../../src/pilot/messenger/runner.mjs');
  const { mkdtempSync: mk } = await import('node:fs');
  const dir = mk(join(tmpdir(), 'ieon-m3r-'));
  let onMessage = null; const sent = [];
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [{ platform: 'telegram', botId: 'default', name: '기본 봇', callNames: [], extraUsers: [], enabled: true }] } };
    if (req.path === '/v1/messenger/config') return { status: 200, body: { allowedUsers: { telegram: ['111'] }, kakao: null, linkedUsers: {} } };
    if (req.path === '/v1/messenger/claim') return { status: 200, body: { claimed: true, linked: true } };
    return { status: 200, body: {} };
  };
  const runner = createBotRunner({ api, apiFor: () => api, env: { TELEGRAM_BOT_TOKEN: 'x' }, roomsPath: join(dir, 'rooms.json'), log: () => {},
    runners: { telegram: (o) => { onMessage = o.onMessage; return {}; } } });
  await runner.sync();
  await onMessage({ platform: 'telegram', userId: '555', chatId: '555', text: '123456' }, async (s) => { sent.push(s); });
  assert.match(sent[0], /이어온 계정과 연결됐어요/);
  rmSync(dir, { recursive: true, force: true });
});
