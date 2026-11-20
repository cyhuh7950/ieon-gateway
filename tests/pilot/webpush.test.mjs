// 웹 알림(탭을 닫아도): RFC 8291 암호화를 받는 쪽처럼 풀어 확인, VAPID 서명 확인, 구독 저장·끊기, 새 소식 때 원문 없는 알림, 없어진 구독은 지움.
// 실제 브라우저 알림 서버에는 보내지 않음(가짜). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, createHmac, createDecipheriv, createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { encryptWebPush, makeVapidKeys, vapidAuth, validateWebSub, createWebPusher } from '../../src/pilot/push.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const sha = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const T1 = '01a18790-0000-7000-8000-000000000001';

// 브라우저 쪽 구독 키 흉내
function browserKeys() {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, sub: { endpoint: 'https://push.example.com/send/abcdefghijklmnop', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}
// 받는 쪽(브라우저)처럼 풀기 — RFC 8291
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPub = body.subarray(21, 21 + idlen); const enc = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(enc.subarray(enc.length - 16));
  const plain = Buffer.concat([d.update(enc.subarray(0, enc.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, '마지막 레코드 표시');
  return plain.subarray(0, plain.length - 1).toString();
}

test('암호화: 브라우저 키로만 풀리고 내용이 그대로', () => {
  const { ua, auth, sub } = browserKeys();
  const body = encryptWebPush(JSON.stringify({ body: '코덱스가 답했어요' }), sub);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.deepEqual(JSON.parse(decrypt(body, ua, auth)), { body: '코덱스가 답했어요' });
  const other = browserKeys();
  assert.throws(() => decrypt(body, other.ua, other.auth), '다른 브라우저 키로는 못 풂');
});

test('VAPID: 알림 서버 주소를 대상으로 ES256 서명, 공개 키는 65바이트', () => {
  const v = makeVapidKeys();
  assert.equal(Buffer.from(v.publicKey, 'base64url').length, 65);
  const h = vapidAuth('https://fcm.googleapis.com/fcm/send/xyz', v, 'https://hub.example');
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, v.publicKey);
  const [head, body, sig] = t.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')).aud, 'https://fcm.googleapis.com');
  const pub = Buffer.from(v.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('구독 검사: https 주소와 키 모양만', () => {
  const { sub } = browserKeys();
  assert.deepEqual(validateWebSub(sub), sub);
  assert.throws(() => validateWebSub({ ...sub, endpoint: 'http://push.example.com/x/abcdefghijk' }), /bad_subscription/);
  assert.throws(() => validateWebSub({ ...sub, keys: { p256dh: 'x', auth: 'y' } }), /bad_subscription/);
});

test('보내기: 410이면 gone, 머리에 암호화 방식·VAPID', async () => {
  const calls = [];
  const p = createWebPusher({ fetchImpl: async (url, opt) => { calls.push({ url, opt }); return { ok: !url.includes('gone'), status: url.includes('gone') ? 410 : 201 }; } });
  const v = makeVapidKeys(); const { sub } = browserKeys();
  assert.equal(await p.send(v, sub, { body: 'x', tag: 't' }, 'https://hub.example'), 'sent');
  assert.equal(calls[0].opt.headers['content-encoding'], 'aes128gcm');
  assert.match(calls[0].opt.headers.authorization, /^vapid t=/);
  assert.equal(await p.send(v, { ...sub, endpoint: 'https://push.example.com/gone/abcdefgh' }, { body: 'x' }, 'https://hub.example'), 'gone');
});

test('서버: 웹 로그인만 구독, 답이 끝나면 그 주인의 구독으로 원문 없는 알림, 없어진 구독은 지움, 끊기', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-wp-'));
  const sent = [];
  const webPusher = { send: async (v, s, note) => { sent.push({ endpoint: s.endpoint, ...note }); return s.endpoint.includes('gone') ? 'gone' : 'sent'; } };
  const app = createApp({ dbPath: join(d, 'p.db'), webPusher, pusher: { send: async () => 'sent' },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '시험', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  assert.equal((await call('/v1/webpush/key', { token: 'msg' })).status, 403, '메신저 열쇠로는 안 됨');
  const k1 = (await call('/v1/webpush/key')).body.publicKey;
  assert.equal((await call('/v1/webpush/key')).body.publicKey, k1, '키는 한 번 만들고 그대로');
  const { sub } = browserKeys();
  assert.equal((await call('/v1/webpush/subscription', { method: 'PUT', body: { endpoint: 'http://x', keys: {} } })).body.error, 'bad_subscription');
  assert.equal((await call('/v1/webpush/subscription', { method: 'PUT', body: sub })).body.subscribed, true);
  const gone = browserKeys().sub; gone.endpoint = 'https://push.example.com/gone/zzzzzzzzzzzz';
  await call('/v1/webpush/subscription', { method: 'PUT', body: gone });
  // 질문 → 끝남 → 두 구독에 알림, 없어진 것은 지움
  await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } });
  await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '비밀 질문' }, key: 'k-wp-0001' });
  const job = await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }).then((r) => r.json());
  await fetch(base + `/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'completed', answer: '비밀 답' }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent.map((s) => s.body), ['시험이 답했어요', '시험이 답했어요']);
  assert.ok(!JSON.stringify(sent).includes('비밀'));
  assert.equal(app.store.webSubs('u_sinsan').length, 1, '없어진 구독은 지움');
  await call('/v1/webpush/subscription', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  assert.equal(app.store.webSubs('u_sinsan').length, 0);
  // 서비스 워커 파일
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
});

test('화면: 알림 켜면 서비스 워커로 구독, 알림을 누르면 그 대화(#conv=), 웹 알림이 켜져 있으면 탭 알림은 겹치지 않음', () => {
  const app = koView('app.html');
  const sw = readFileSync(fileURLToPath(new URL('../../src/pilot/web/sw.js', import.meta.url)), 'utf8');
  assert.ok(app.includes("navigator.serviceWorker.register('/sw.js')") && app.includes("'/v1/webpush/subscription'") && app.includes('#conv='));
  assert.ok(app.includes('!notifyOnNow || webPushOn ||'));
  assert.ok(sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'") && !sw.includes("addEventListener('fetch'"), '알림만, 요청은 가로채지 않음');
});
