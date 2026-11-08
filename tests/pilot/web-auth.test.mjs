// W1: 웹 로그인 — PC 자동 로그인, 허브 관리자 비밀번호, 쿠키·Origin 검사, 잠금(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { hashPassword, verifyPassword } from '../../src/pilot/web-auth.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function server(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w1-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    bindings: [{ conversationId: 'c_a', label: 'A', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: 't1' }], ...extra });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  let cookie = '';
  const call = async (path, { method = 'GET', body, origin = method === 'GET' ? undefined : base, xff, bearer, withCookie = true } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json',
      ...(origin ? { origin } : {}), ...(xff ? { 'x-forwarded-for': xff } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(withCookie && cookie ? { cookie } : {}) } });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null), set };
  };
  return { call, base, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

test('비밀번호 해시: scrypt, 맞는 비밀번호만 통과', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$/);
  assert.ok(verifyPassword('correct horse battery', h));
  assert.ok(!verifyPassword('wrong password!!', h));
  assert.ok(!verifyPassword('x', 'garbage'));
});

test('PC: 이 PC에서 연 화면은 토큰 없이 자동 로그인(쿠키), 쿠키로 바꾸는 요청은 Origin이 맞아야 한다', async (t) => {
  const s = await server(t);
  assert.deepEqual((await s.call('/v1/auth/state')).body, { mode: 'pc', setupRequired: true, loggedIn: false, localAuto: true });
  assert.equal((await s.call('/v1/conversations')).status, 401);
  assert.equal((await s.call('/v1/auth/local', { method: 'POST', origin: 'https://evil.example' })).body.error, 'bad_origin');
  const r = await s.call('/v1/auth/local', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.set, /ieon_sid=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/); // http라 Secure 없음
  assert.equal((await s.call('/v1/conversations')).status, 200);
  assert.equal((await s.call('/v1/auth/state')).body.loggedIn, true);
  // 쿠키로 바꾸는 요청: Origin 없음·다른 사이트면 거절, 같은 곳이면 통과
  const body = { telegram: ['111'] };
  assert.equal((await s.call('/v1/admin/settings/allowed-users', { method: 'PUT', body, origin: null })).body.error, 'bad_origin');
  assert.equal((await s.call('/v1/admin/settings/allowed-users', { method: 'PUT', body, origin: 'https://evil.example' })).body.error, 'bad_origin');
  assert.equal((await s.call('/v1/admin/settings/allowed-users', { method: 'PUT', body })).status, 200);
  // 메신저·외부 앱의 Bearer 토큰은 그대로
  assert.equal((await s.call('/v1/messenger/config', { bearer: 'msg', withCookie: false })).status, 200);
  // 로그아웃하면 그 쿠키는 더 못 쓴다
  const old = s.cookie;
  await s.call('/v1/auth/logout', { method: 'POST' });
  s.cookie = old;
  assert.equal((await s.call('/v1/conversations')).status, 401);
});

test('허브: 처음 한 번 관리자 만들기 → 비밀번호 로그인, 5번 틀리면 잠김, 자동 로그인은 없다', async (t) => {
  const s = await server(t, { webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const xff = '198.51.100.9';
  assert.equal((await s.call('/v1/auth/state', { xff: '203.0.113.7' })).status, 403); // 접속 제한 밖
  assert.deepEqual((await s.call('/v1/auth/state', { xff })).body, { mode: 'hub', setupRequired: true, loggedIn: false, localAuto: false });
  assert.equal((await s.call('/v1/auth/local', { method: 'POST', xff })).body.error, 'local_only');
  assert.equal((await s.call('/v1/auth/login', { method: 'POST', xff, body: { password: 'x' } })).body.error, 'setup_required');
  assert.equal((await s.call('/v1/auth/setup', { method: 'POST', xff, body: { password: 'short' } })).body.error, 'weak_password');
  assert.equal((await s.call('/v1/auth/setup', { method: 'POST', xff, body: { password: 'hub-admin-pass-1' } })).status, 200);
  assert.equal((await s.call('/v1/conversations', { xff })).status, 200);
  assert.equal((await s.call('/v1/auth/setup', { method: 'POST', xff, body: { password: 'another-pass-22' } })).body.error, 'already_setup');
  // 다른 브라우저(쿠키 없음)에서 로그인
  s.cookie = '';
  for (let i = 0; i < 4; i++) assert.equal((await s.call('/v1/auth/login', { method: 'POST', xff, body: { password: 'nope-nope-nope' } })).status, 401);
  assert.equal((await s.call('/v1/auth/login', { method: 'POST', xff, body: { password: 'hub-admin-pass-1' } })).status, 200); // 4번까지는 괜찮다
  s.cookie = '';
  for (let i = 0; i < 5; i++) await s.call('/v1/auth/login', { method: 'POST', xff, body: { password: 'nope-nope-nope' } });
  const locked = await s.call('/v1/auth/login', { method: 'POST', xff, body: { password: 'hub-admin-pass-1' } });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'locked');
});

test('허브: 비밀번호를 바꾸면 다른 로그인은 모두 끊기고, https 앞단이면 쿠키에 Secure가 붙는다', async (t) => {
  const s = await server(t, { webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const xff = '198.51.100.9';
  await s.call('/v1/auth/setup', { method: 'POST', xff, body: { password: 'hub-admin-pass-1' } });
  const other = s.cookie;
  assert.equal((await s.call('/v1/auth/password', { method: 'POST', xff, body: { current: 'wrong-pass-123', next: 'hub-admin-pass-2' } })).body.error, 'bad_password');
  const r = await s.call('/v1/auth/password', { method: 'POST', xff, body: { current: 'hub-admin-pass-1', next: 'hub-admin-pass-2' } });
  assert.equal(r.status, 200);
  const mine = s.cookie;
  s.cookie = other;
  assert.equal((await s.call('/v1/conversations', { xff })).status, 401);
  s.cookie = mine;
  assert.equal((await s.call('/v1/conversations', { xff })).status, 200);
  const sec = await fetch(`${s.base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.base, 'x-forwarded-for': xff, 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ password: 'hub-admin-pass-2' }) });
  assert.match(sec.headers.get('set-cookie'), /; Secure$/);
});
