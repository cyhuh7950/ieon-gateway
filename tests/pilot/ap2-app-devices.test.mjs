// AP-2(MESSENGER_EXPANSION B6·B9·AP5): 이어온 앱 기기 연결 — 1회용 코드(10분·한 번) → 앱 기기 열쇠(해시만), 대화·방·승인은 쓰고 설정은 못 바꿈,
// 기기 목록·끊기, 새 소식 바로 받기(SSE, 번호·상태만 — 원문 없음, 내 대화만). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap2-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const app = createApp({ dbPath: join(d, 'p.db'), sseKeepaliveMs: 100,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c_o', ownerUserId: 'u_other', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000002' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { app, base, call, closers };
}

test('연결 코드: 8자리·10분·한 번만, 틀리거나 지난 코드는 거절, 앱 열쇠는 한 번만 받고 서버엔 해시만', async (t) => {
  const s = await setup(t);
  const c = (await s.call('/v1/admin/app-devices/code', { method: 'POST', body: {} })).body;
  assert.match(c.code, /^\d{8}$/);
  assert.ok(Date.parse(c.expiresAt) - Date.now() > 9 * 60_000);
  assert.equal((await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: '00000000', name: '폰' } })).body.error, 'bad_code');
  const p = await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: c.code, name: '내 폰' } });
  assert.equal(p.status, 201); assert.match(p.body.token, /^[0-9a-f]{64}$/); assert.match(p.body.deviceId, /^ad_/);
  assert.equal((await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: c.code, name: '또' } })).body.error, 'bad_code', '한 번만');
  // 10분 지난 코드
  const old = '12345678';
  s.app.store.addAppPairCode('u_sinsan', sha(old), 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: old } })).body.error, 'bad_code');
  const dev = (await s.call('/v1/admin/app-devices')).body.devices;
  assert.equal(dev[0].name, '내 폰');
  assert.ok(!JSON.stringify(dev).includes(p.body.token), '목록에 열쇠 없음');
  // 쓰지 않은 코드는 5개까지
  for (let i = 0; i < 5; i += 1) assert.equal((await s.call('/v1/admin/app-devices/code', { method: 'POST', body: {} })).status, 201);
  assert.equal((await s.call('/v1/admin/app-devices/code', { method: 'POST', body: {} })).body.error, 'too_many_codes');
});

test('앱 열쇠: 내 대화·방·승인은 되고 설정(관리)은 안 됨, 끊으면 바로 막힘, 남의 대화는 안 보임', async (t) => {
  const s = await setup(t);
  const c = (await s.call('/v1/admin/app-devices/code', { method: 'POST', body: {} })).body;
  const { token, deviceId } = (await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: c.code, name: '폰' } })).body;
  const list = await s.call('/v1/conversations', { token });
  assert.deepEqual(list.body.conversations.map((x) => x.conversationId), ['c1']);
  assert.equal((await s.call('/v1/rooms', { token })).status, 200);
  for (const pth of ['/v1/admin/bots', '/v1/admin/app-devices', '/v1/admin/settings/allowed-users']) assert.equal((await s.call(pth, { token })).body?.error, 'app_not_allowed', pth);
  assert.equal((await s.call('/v1/admin/app-devices/code', { method: 'POST', body: {}, token })).body.error, 'app_not_allowed', '앱이 다른 앱을 연결하지 못함');
  assert.ok((await s.call('/v1/admin/app-devices')).body.devices[0].lastSeenAt, '마지막 사용 기록');
  assert.equal((await s.call(`/v1/admin/app-devices/${deviceId}/revoke`, { method: 'POST', body: {}, token: 'other' })).status, 404, '남의 기기는 못 끊음');
  assert.equal((await s.call(`/v1/admin/app-devices/${deviceId}/revoke`, { method: 'POST', body: {} })).body.revoked, true);
  assert.equal((await s.call('/v1/conversations', { token })).status, 401);
});

test('새 소식(SSE): 내 대화의 요청 상태만 번호·상태로 — 질문·답 원문 없음, 남의 대화는 안 옴', async (t) => {
  const s = await setup(t);
  const ac = new AbortController(); s.closers.push(() => ac.abort());
  const got = [];
  const open = async (token) => {
    const r = await fetch(s.base + '/v1/events', { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = r.body.getReader(); const dec = new TextDecoder();
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; got.push(dec.decode(value)); } } catch { /* 닫힘 */ } })();
  };
  await open('web');
  const otherGot = []; const ac2 = new AbortController(); s.closers.push(() => ac2.abort());
  const r2 = await fetch(s.base + '/v1/events', { headers: { authorization: 'Bearer other' }, signal: ac2.signal });
  (async () => { const rd = r2.body.getReader(); const dec = new TextDecoder(); try { for (;;) { const { value, done } = await rd.read(); if (done) break; otherGot.push(dec.decode(value)); } } catch { /* 닫힘 */ } })();
  await s.call('/v1/device/jobs', { token: 'dev' });
  const q = await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '비밀 질문' }, key: 'k-ap2-sse-0001' });
  const job = (await s.call('/v1/device/jobs', { token: 'dev' })).body;
  await s.call(`/v1/device/jobs/${job.requestId}/result`, { method: 'POST', body: { status: 'completed', answer: '비밀 답' }, token: 'dev' });
  await new Promise((r) => setTimeout(r, 250));
  const text = got.join('');
  assert.ok(text.includes('event: request') && text.includes(q.body.requestId) && text.includes('"status":"queued"') && text.includes('"status":"completed"'), text);
  assert.ok(!text.includes('비밀'), '원문 없음');
  assert.ok(text.includes(': keepalive'), '살아 있음 표시');
  assert.ok(!otherGot.join('').includes(q.body.requestId), '남의 대화 소식은 안 옴');
});

test('연결 코드 요청 횟수 제한(1분 10번), 화면: 내 프로그램 연결 탭의 이어온 앱 연결', async (t) => {
  const s = await setup(t);
  let last;
  for (let i = 0; i < 11; i += 1) last = await s.call('/v1/app/pair', { method: 'POST', token: null, body: { code: '11111111' } });
  assert.equal(last.status, 429);
  const S = readFileSync(fileURLToPath(new URL('../../src/pilot/web/settings.html', import.meta.url)), 'utf8');
  assert.ok(S.includes('id="adCode"') && S.includes('id="adList"') && S.includes("'/v1/admin/app-devices/code'") && S.includes('10분 동안 한 번만'));
});

test('허브 접속 제한이 켜져 있어도 앱 연결과 앱 열쇠 요청은 통과(휴대폰 주소가 바뀌어도), 웹·관리·틀린 열쇠는 그대로 막힘', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap2x-'));
  const app = createApp({ dbPath: join(d, 'p.db'), webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token, ip = '203.0.113.50' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  // 관리자는 허용된 주소에서 코드를 만든다
  assert.equal((await call('/v1/admin/app-devices/code', { method: 'POST', body: {}, token: 'web' })).body.error, 'access_denied', '허용 안 된 주소의 웹 열쇠는 막힘');
  const c = (await call('/v1/admin/app-devices/code', { method: 'POST', body: {}, token: 'web', ip: '198.51.100.9' })).body;
  // 휴대폰(허용 목록에 없는 주소)에서 연결 → 앱 열쇠로 대화 목록
  const p = await call('/v1/app/pair', { method: 'POST', body: { code: c.code, name: '폰' } });
  assert.equal(p.status, 201);
  assert.equal((await call('/v1/conversations', { token: p.body.token })).status, 200);
  assert.equal((await call('/v1/conversations', { token: p.body.token, ip: '192.0.2.77' })).status, 200, '주소가 바뀌어도');
  assert.equal((await call('/v1/admin/app-devices', { token: p.body.token })).body.error, 'app_not_allowed', '설정은 앱에서 못 씀');
  assert.equal((await call('/v1/conversations', { token: 'f'.repeat(64) })).body.error, 'access_denied', '틀린 열쇠는 접속 제한에 걸림');
  assert.equal((await call('/settings')).status, 403, '웹 화면은 그대로 막힘');
});
