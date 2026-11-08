// P4: 허브 웹 접속 제한(IP 허용 목록·Cloudflare Access·Tailscale)과 Unix 소켓 전달기(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { matchCidr, clientIp, createWebAccess, validateWebAccess } from '../../src/pilot/web-access.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const fakeReq = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('CIDR·접속 주소: 믿는 앞단에서 온 X-Forwarded-For만 따르고, 아니면 위조로 보고 무시한다', () => {
  assert.ok(matchCidr('203.0.113.7', '203.0.113.0/24'));
  assert.ok(!matchCidr('203.0.114.7', '203.0.113.0/24'));
  assert.ok(matchCidr('::ffff:10.0.0.1', '10.0.0.1'));
  assert.ok(matchCidr('100.101.1.2', '100.64.0.0/10'));
  assert.ok(!matchCidr('100.128.0.1', '100.64.0.0/10'));
  assert.ok(matchCidr('unix', 'unix') && !matchCidr('1.2.3.4', 'unix'));
  const trusted = ['unix', '172.18.0.0/16'];
  assert.equal(clientIp(fakeReq(undefined, { 'x-forwarded-for': '198.51.100.9, 172.18.0.5' }), trusted), '198.51.100.9');
  assert.equal(clientIp(fakeReq(undefined, { 'x-forwarded-for': '6.6.6.6, 198.51.100.9, 172.18.0.5' }), trusted), '198.51.100.9'); // 앞쪽 위조는 무시
  assert.equal(clientIp(fakeReq('198.51.100.9', { 'x-forwarded-for': '203.0.113.7' }), trusted), '198.51.100.9'); // 앞단이 아니면 헤더 무시
  assert.throws(() => validateWebAccess({ modes: ['basic'] }), /bad_web_access_mode/);
  assert.throws(() => validateWebAccess({ modes: ['ip_allowlist'] }), /ipAllowlist_empty/);
  assert.throws(() => validateWebAccess({ modes: ['cloudflare_access'], cloudflare: { teamDomain: 'evil.example', aud: 'x' } }), /cloudflare/);
});

test('Cloudflare Access: 서명·aud·iss·만료를 직접 검증하고, 헤더만 있거나 틀리면 거절한다', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const team = 'sinsan.cloudflareaccess.com';
  let fetched = 0;
  const fetchImpl = async (url) => { fetched++; assert.equal(url, `https://${team}/cdn-cgi/access/certs`); return { ok: true, json: async () => ({ keys: [jwk] }) }; };
  const now = Date.UTC(2026, 10, 8) ;
  const access = createWebAccess({ modes: ['cloudflare_access'], cloudflare: { teamDomain: team, aud: 'AUD1' } }, { fetchImpl, now: () => now });
  const jwt = (claims, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
    const h = Buffer.from(JSON.stringify({ alg, kid })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
  };
  const good = { aud: ['AUD1'], iss: `https://${team}`, exp: now / 1000 + 600, email: 'me@example.com' };
  const req = (token) => fakeReq('172.18.0.5', token ? { 'cf-access-jwt-assertion': token } : {});
  assert.equal(await access.check(req(jwt(good))), 'cloudflare_access');
  assert.equal(await access.check(req(null)), null);
  assert.equal(await access.check(req('a.b.c')), null);
  assert.equal(await access.check(req(jwt(good, { key: other }))), null); // 다른 키로 서명
  assert.equal(await access.check(req(jwt({ ...good, aud: 'AUD2' }))), null);
  assert.equal(await access.check(req(jwt({ ...good, iss: 'https://evil.cloudflareaccess.com' }))), null);
  assert.equal(await access.check(req(jwt({ ...good, exp: now / 1000 - 1 }))), null);
  assert.equal(await access.check(req(jwt(good, { alg: 'HS256' }))), null);
  assert.ok(fetched <= 3); // 키는 캐시하고, 모르는 kid일 때만 다시 받는다
});

async function hub(t, webAccess, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p4-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), webAccess, bindings: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }], ...extra });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, base: `http://127.0.0.1:${port}`, dir };
}

test('허브 서버: 앞단을 거친 요청은 허용 목록 밖이면 403, 예외 경로(기기 API·health)는 통과, 이 PC 직접 접속은 통과', async (t) => {
  const { base } = await hub(t, { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.0/24'], trustedProxies: ['127.0.0.1'] });
  const get = (path, xff, token = 'web') => fetch(base + path, { headers: { authorization: `Bearer ${token}`, ...(xff ? { 'x-forwarded-for': xff } : {}) } }).then((r) => r.status);
  assert.equal(await get('/', '203.0.113.7'), 403);
  assert.equal(await get('/v1/conversations', '203.0.113.7'), 403);
  assert.equal(await get('/v1/conversations', '198.51.100.9'), 200);
  assert.equal(await get('/v1/conversations', '198.51.100.9', 'wrong'), 401); // 접속 제한을 통과해도 토큰은 따로 본다
  assert.equal(await get('/health', '203.0.113.7'), 200);
  assert.equal(await get('/v1/device/jobs', '203.0.113.7', 'dev'), 204);
  assert.equal(await get('/v1/conversations'), 200); // 앞단 없이 127.0.0.1 직접(SSH 터널 관리)
});

test('허브 서버: 접속 제한 방식이 없으면 공개용 소켓을 열지 않는다(기본 닫힘)', async (t) => {
  const { app } = await hub(t, { modes: [] });
  assert.throws(() => app.listenSocket(join(tmpdir(), 'x.sock')), /web_access_required/);
  const { app: noAccess } = await hub(t, undefined);
  assert.throws(() => noAccess.listenSocket(join(tmpdir(), 'y.sock')), /web_access_required/);
});

test('허브 공개 포트(W0): 접속 제한이 없으면 열지 않고, NPM(믿는 앞단)을 거친 주소로 판정하며 127.0.0.1 직접 접속 예외를 받지 않는다', async (t) => {
  const { app: closed } = await hub(t, { modes: [] });
  assert.throws(() => closed.listenPublic(0, '127.0.0.1'), /web_access_required/);
  const { app } = await hub(t, { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] });
  const port = await app.listenPublic(0, '127.0.0.1');
  const get = (path, xff) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: 'Bearer web', ...(xff ? { 'x-forwarded-for': xff } : {}) } }).then((r) => r.status);
  assert.equal(await get('/v1/conversations', '198.51.100.9'), 200);
  assert.equal(await get('/v1/conversations', '203.0.113.7'), 403);
  assert.equal(await get('/v1/conversations'), 403); // 공개 포트는 127.0.0.1에서 와도 예외 없음
  assert.equal(await get('/health'), 200);
});
