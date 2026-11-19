// M2 여러 사람(신산님 결정 MU1~4): 가입 신청 → 승인, 승인 전엔 아무것도 못 씀, 사용자는 자기 PC·자기 대화만, 관리자도 남의 대화는 못 봄,
// 허브 설정은 관리자만, 끊으면 바로 막힘. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-0000000000a1';

async function hub(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m2-'));
  const app = createApp({ dbPath: join(d, 'p.db'), webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  // 쿠키를 따로 들고 다니는 브라우저 하나
  const browser = () => {
    let cookie = '';
    return async (path, { method = 'GET', body } = {}) => {
      const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) } });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    };
  };
  return { app, base, browser };
}

test('M2: 가입 신청 → 승인 대기 → 승인, 사용자는 자기 PC·대화만, 관리자도 남의 대화는 못 봄, 허브 설정은 관리자만, 끊으면 막힘', async (t) => {
  const { app, browser } = await hub(t);
  const admin = browser(); const a = browser(); const b = browser();
  assert.equal((await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } })).status, 200);
  // 여러 사람 쓰기가 꺼져 있으면 가입 신청 불가
  assert.equal((await a('/v1/auth/signup', { method: 'POST', body: { email: 'a@example.com', password: 'a-password-123', agree: true } })).body.error, 'signup_closed');
  assert.equal((await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } })).body.multiUser.enabled, true);
  assert.equal((await a('/v1/auth/state')).body.signupOpen, true);
  // 가입 신청 → 승인 대기(로그인은 되지만 기능은 못 씀)
  assert.deepEqual((await a('/v1/auth/signup', { method: 'POST', body: { email: 'A@Example.com', password: 'a-password-123', agree: true } })).body, { loggedIn: true, status: 'pending' });
  assert.equal((await b('/v1/auth/signup', { method: 'POST', body: { email: 'a@example.com', password: 'other-password-1', agree: true } })).body.error, 'email_taken', '대소문자 달라도 같은 이메일');
  await b('/v1/auth/signup', { method: 'POST', body: { email: 'b@example.com', password: 'b-password-123', agree: true } });
  assert.deepEqual([(await a('/v1/auth/state')).body.role, (await a('/v1/auth/state')).body.status], ['user', 'pending']);
  assert.equal((await a('/v1/conversations')).body.error, 'pending_approval');
  // 관리자: 사용자 목록(이메일·상태·PC 수) → 승인
  const users = (await admin('/v1/admin/users')).body.users;
  assert.deepEqual(users.map((u) => [u.email, u.status]).sort(), [['a@example.com', 'pending'], ['b@example.com', 'pending']]);
  for (const u of users) assert.equal((await admin(`/v1/admin/users/${u.userId}/approve`, { method: 'POST', body: {} })).body.status, 'approved');
  const aId = users.find((u) => u.email === 'a@example.com').userId;
  assert.equal((await a('/v1/conversations')).status, 200);
  // 사용자는 허브 설정·사용자 목록을 못 씀
  for (const p of ['/v1/admin/settings', '/v1/admin/users', '/v1/admin/bots', '/v1/admin/security', '/v1/admin/bindings']) assert.equal((await a(p)).body.error, 'admin_only', p);
  // A가 자기 PC를 연결(기기 등록) → A만 보임
  const dev = await a('/v1/admin/devices', { method: 'POST', body: { hostId: 'h_apc', name: 'A의 PC' } });
  assert.equal(dev.status, 201);
  assert.deepEqual((await a('/v1/admin/devices')).body.devices.map((d) => d.hostId), ['h_apc']);
  assert.deepEqual((await b('/v1/admin/devices')).body.devices, [], 'B에게는 A의 PC가 안 보임');
  assert.equal((await b('/v1/admin/devices/h_apc/reissue', { method: 'POST', body: {} })).status, 404, 'B는 A의 PC 열쇠를 못 바꿈');
  assert.ok((await admin('/v1/admin/devices')).body.devices.some((d) => d.hostId === 'h_apc' && d.name === 'A의 PC'), '관리자는 기기 이름(관리 정보)은 봄');
  // A의 대화(그 PC의 세션 등록) — 저장소로 직접(화면 흐름은 PC가 있어야 해서)
  assert.equal(app.store.saveBinding(aId, { conversationId: 'c_a1', label: 'A의 비밀 대화', engine: 'codex_thread', hostId: 'h_apc', sessionRef: T1, appIds: ['app_web'] }).http, 200);
  assert.deepEqual((await a('/v1/conversations')).body.conversations.map((c) => c.conversationId), ['c_a1']);
  assert.ok(!JSON.stringify((await b('/v1/conversations')).body).includes('c_a1'), 'B에게 안 보임');
  assert.ok(!JSON.stringify((await admin('/v1/conversations')).body).includes('비밀'), '관리자에게도 안 보임(MU3)');
  assert.ok(!JSON.stringify((await admin('/v1/admin/users')).body).includes('비밀'), '사용자 목록에 대화 내용 없음');
  assert.equal((await b('/v1/conversations/c_a1/requests', { method: 'POST', body: { question: 'q' } })).status === 202, false, 'B는 A의 대화에 못 보냄');
  // B는 남의 PC로 명령·새 세션·등록 불가, 자기 PC가 없으면 새 세션 거절
  assert.equal((await b('/v1/admin/hosts/h_apc/run', { method: 'POST', body: { op: 'device.get' } })).body.error, 'unknown_host');
  assert.equal((await b('/v1/admin/hosts/hub/run', { method: 'POST', body: { op: 'device.get' } })).body.error, 'unknown_host', '허브 자신은 관리자만');
  assert.equal(app.store.saveBinding('u_someone', { conversationId: 'c_a1', label: 'x', engine: 'codex_thread', hostId: 'h_apc', sessionRef: T1, appIds: ['app_web'] }).code, 'id_taken', '남의 등록을 덮어쓰지 못함');
  // 끊기 → 바로 로그아웃, 다시 로그인도 안 됨
  assert.equal((await admin(`/v1/admin/users/${aId}/disable`, { method: 'POST', body: {} })).body.status, 'disabled');
  assert.equal((await a('/v1/conversations')).status, 401);
  assert.equal((await browser()('/v1/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'a-password-123' } })).body.error, 'account_disabled');
  // 관리자 로그인(이메일 없이 비밀번호)은 그대로
  assert.equal((await browser()('/v1/auth/login', { method: 'POST', body: { password: 'admin-password-123' } })).status, 200);
});

test('M2: 사용자는 자기 PC에만 새 세션, PC가 없으면 거절', async (t) => {
  const { app, browser } = await hub(t);
  const admin = browser(); const u = browser();
  await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } });
  await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } });
  await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123', agree: true } });
  const id = (await admin('/v1/admin/users')).body.users[0].userId;
  await admin(`/v1/admin/users/${id}/approve`, { method: 'POST', body: {} });
  app.store.setSetting('newSessions', { enabled: true });
  const r = await u('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'mine' } });
  assert.ok(['no_device', 'new_sessions_disabled'].includes(r.body.error), JSON.stringify(r.body));
});

test('M2-b: AI 직원 이름은 사람마다 따로, 임시 비밀번호·내 비밀번호 바꾸기, 가입자 지우기는 그 사람 것만 모두 지움', async (t) => {
  const { app, browser } = await hub(t);
  const admin = browser(); const u = browser();
  await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } });
  await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } });
  await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123', agree: true } });
  const id = (await admin('/v1/admin/users')).body.users[0].userId;
  await admin(`/v1/admin/users/${id}/approve`, { method: 'POST', body: {} });
  // 관리자 대화와 가입자 대화가 같은 AI 직원 이름을 쓸 수 있음(같은 사람 안에서는 겹치면 안 됨)
  app.store.saveBinding('u_sinsan', { conversationId: 'c_adm', label: '관리자 대화', engine: 'codex_thread', hostId: 'h_adm', sessionRef: '01a18790-0000-7000-8000-0000000000b1', appIds: ['app_web'] });
  app.store.addDevice('h_u', 'U PC', 'x'.repeat(64), id);
  app.store.saveBinding(id, { conversationId: 'c_u1', label: 'U 대화', engine: 'codex_thread', hostId: 'h_u', sessionRef: '01a18790-0000-7000-8000-0000000000b2', appIds: ['app_web'] });
  app.store.saveBinding(id, { conversationId: 'c_u2', label: 'U 대화2', engine: 'codex_thread', hostId: 'h_u', sessionRef: '01a18790-0000-7000-8000-0000000000b3', appIds: ['app_web'] });
  assert.equal(app.store.setStaff({ userId: 'u_sinsan', appId: 'app_web' }, 'c_adm', { name: '코덱스' }).http, 200);
  assert.equal(app.store.setStaff({ userId: id, appId: 'app_web' }, 'c_u1', { name: '코덱스' }).http, 200, '다른 사람은 같은 이름 가능');
  assert.equal(app.store.setStaff({ userId: id, appId: 'app_web' }, 'c_u2', { name: '코덱스' }).code, 'staff_name_taken', '같은 사람 안에서는 겹치면 안 됨');
  // 임시 비밀번호: 그 사람 로그인 끊김 → 새 비밀번호로만 로그인
  const temp = (await admin(`/v1/admin/users/${id}/reset`, { method: 'POST', body: {} })).body.tempPassword;
  assert.match(temp, /^[\w-]{12}$/);
  assert.equal((await u('/v1/conversations')).status, 401, '로그인 끊김');
  assert.equal((await u('/v1/auth/login', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123' } })).status, 401, '옛 비밀번호 안 됨');
  assert.equal((await u('/v1/auth/login', { method: 'POST', body: { email: 'u@example.com', password: temp } })).status, 200);
  // 내 비밀번호 바꾸기
  assert.equal((await u('/v1/auth/password', { method: 'POST', body: { current: 'wrong-password', next: 'new-password-123' } })).body.error, 'bad_password');
  assert.equal((await u('/v1/auth/password', { method: 'POST', body: { current: temp, next: 'new-password-123' } })).status, 200);
  assert.equal((await u('/v1/conversations')).status, 200, '바꾼 화면은 계속 로그인');
  assert.equal((await browser()('/v1/auth/login', { method: 'POST', body: { email: 'u@example.com', password: 'new-password-123' } })).status, 200);
  // 지우기: 그 사람 대화·기기·로그인 모두 지움, 관리자 것은 그대로
  const del = (await admin(`/v1/admin/users/${id}/delete`, { method: 'POST', body: {} })).body;
  assert.deepEqual([del.deleted, del.conversations], [true, 2]);
  assert.equal((await u('/v1/conversations')).status, 401);
  assert.equal(app.store.user(id), null);
  assert.deepEqual(app.store.listBindings(id), []);
  assert.equal(app.store.deviceOwner('h_u'), undefined, '그 사람 PC 기록도 지움');
  assert.equal(app.store.listBindings('u_sinsan').length, 1, '관리자 대화는 그대로');
  assert.deepEqual((await admin('/v1/admin/users')).body.users, []);
});
