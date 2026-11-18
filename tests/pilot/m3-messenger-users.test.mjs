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
