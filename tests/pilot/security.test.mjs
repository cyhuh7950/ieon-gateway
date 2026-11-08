// W7: 허브 보안 화면 — 접속 제한을 웹에서 바꾸되 잠김·무방비를 막는다(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('보안: 지금 주소가 막히는 변경·방식 없음은 거절, 허용 목록을 넓히면 바로 적용, 다시 켜도 웹 값 유지, 파일 값으로 되돌리기', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w7-'));
  const config = { dbPath: join(dir, 'hub.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [],
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } };
  let app = createApp(config);
  let base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, xff = '198.51.100.9' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': xff } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  let r = await call('/v1/admin/security');
  assert.deepEqual(r.body, { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], cloudflare: null, source: 'file', yourIp: '198.51.100.9' });
  assert.equal((await call('/v1/admin/security', { method: 'PUT', body: { modes: ['ip_allowlist'], ipAllowlist: ['203.0.113.0/24'] } })).body.error, 'would_lock_out');
  assert.equal((await call('/v1/admin/security', { method: 'PUT', body: { modes: [] } })).body.error, 'closed_not_allowed');
  assert.equal((await call('/v1/admin/security', { method: 'PUT', body: { modes: ['cloudflare_access'], cloudflare: { teamDomain: 'evil.example', aud: 'x' } } })).body.error, 'bad_web_access:cloudflare');
  assert.equal((await call('/v1/conversations', { xff: '203.0.113.7' })).status, 403);
  r = await call('/v1/admin/security', { method: 'PUT', body: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9', '203.0.113.0/24'] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'web');
  assert.equal((await call('/v1/conversations', { xff: '203.0.113.7' })).status, 200); // 바로 적용
  // 서버를 다시 켜도 웹 값 유지
  await app.close();
  app = createApp(config);
  base = `http://127.0.0.1:${await app.listen(0)}`;
  assert.equal((await call('/v1/conversations', { xff: '203.0.113.7' })).status, 200);
  // 파일 값으로 되돌리기(지금 주소가 파일 값에서도 허용되므로 됨)
  r = await call('/v1/admin/security', { method: 'DELETE' });
  assert.equal(r.body.source, 'file');
  assert.equal((await call('/v1/conversations', { xff: '203.0.113.7' })).status, 403);
  // 파일 값으로 되돌리면 지금 주소가 막히는 경우는 거절
  await call('/v1/admin/security', { method: 'PUT', body: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9', '203.0.113.0/24'] } });
  assert.equal((await call('/v1/admin/security', { method: 'DELETE', xff: '203.0.113.7' })).body.error, 'would_lock_out');
});

test('PC에는 보안 화면이 없다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w7p-'));
  const app = createApp({ dbPath: join(dir, 'pc.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await fetch(`${base}/v1/admin/security`, { headers: { authorization: 'Bearer web' } })).status, 404);
});

test('PC 완결형 카카오: 운영자가 둔 중계 비밀 파일로 스킬 URL을 만들고, 중계의 PC 연결 상태를 보여 준다', async (t) => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { createRelay } = await import('../../src/relay/relay.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w7k-'));
  mkdirSync(join(dir, 'relay'));
  writeFileSync(join(dir, 'relay', 'relay.secrets'), 'IEON_RELAY_PC_TOKEN=pc-token-0123456789abcdef\nIEON_RELAY_KAKAO_SECRET=kakao-secret-0123456789abcdef\n');
  const relay = createRelay({ pcToken: 'pc-token-0123456789abcdef', kakaoSecret: 'kakao-secret-0123456789abcdef' });
  const rport = (await relay.listen(0)).port;
  const app = createApp({ dbPath: join(dir, 'pc.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [],
    relaySecretsFile: join(dir, 'relay', 'relay.secrets') });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); await relay.close(); rmSync(dir, { recursive: true, force: true }); });
  const get = (path) => fetch(base + path, { headers: { authorization: 'Bearer web' } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await get('/v1/admin/kakao/skill-url')).body.error, 'no_kakao_relay'); // 중계 주소를 아직 모름
  await fetch(base + '/v1/admin/settings/kakao', { method: 'PUT', headers: { authorization: 'Bearer web', 'content-type': 'application/json' }, body: JSON.stringify({ relayUrl: `http://127.0.0.1:${rport}` }) });
  assert.deepEqual((await get('/v1/admin/kakao/skill-url')).body, { url: `http://127.0.0.1:${rport}/kakao/skill/kakao-secret-0123456789abcdef`, relay: 'public' });
  assert.deepEqual((await get('/v1/admin/kakao/relay-status')).body, { url: `http://127.0.0.1:${rport}`, reachable: true, pcConnected: false });
});
