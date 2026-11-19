// AP-4b 휴대폰 알림(Firebase Cloud Messaging HTTP v1). 설계 APP_AP4_PLAN 1·3절.
// - 알림 글은 "○○가 답했어요" / "○○가 허락을 기다려요" / "○○에게 보내지 못했어요" / "○○ — 확인이 필요해요"만. 질문·답·명령 원문은 넣지 않는다(구글 서버를 거침).
// - 서비스 계정 키로 구글에 로그인(JWT RS256, node 기본 crypto — 새 부품 없음). 키 원문은 화면·로그에 내보내지 않는다.
// - 알림 주소(FCM 토큰)가 더는 쓰이지 않으면(UNREGISTERED·404) 그 주소를 지운다.
import { t as i18nT } from '../i18n/index.mjs';
import { createSign } from 'node:crypto';

const fail = (why) => { throw Object.assign(new Error(why), { http: 400 }); };

// 웹 설정에 올린 서비스 계정 키(JSON) 검사 — 필요한 칸만 남긴다
export function validateServiceAccount(v) {
  const sa = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!sa || typeof sa !== 'object') fail('bad_push_key');
  if (sa.type !== 'service_account' || !/^[a-z0-9-]{4,40}$/.test(String(sa.project_id ?? '')) || !/^[^@\s]+@[^@\s]+$/.test(String(sa.client_email ?? ''))
    || !String(sa.private_key ?? '').includes('PRIVATE KEY')) fail('bad_push_key');
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
}

// 앱 설정 파일(google-services.json) 검사 — 앱을 만들 때 쓴다(비밀값 아님, 패키지 이름 확인)
export function validateGoogleServices(v, packageName = 'kr.sinsan.ieon') {
  const g = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!g || typeof g !== 'object' || !g.project_info?.project_id || !Array.isArray(g.client)) fail('bad_google_services');
  if (!g.client.some((c) => c?.client_info?.android_client_info?.package_name === packageName)) fail('wrong_package');
  return g;
}

// 이름 뒤 "이/가"(앱 notify.ts와 같음)
export function iga(name) {
  return ieonFormat([{ k: '{name|이가}' }], 'k', { name }); // 조사 처리는 사전 채우기와 같은 함수
}

// 새 소식 하나 → 알림 글(원문 없음). 알릴 것이 아니면 null(접수·실행 중 등)
export function pushNote(e, who = i18nT('server.staff')) {
  if (e.type === 'request' && e.requestId) {
    if (e.status === 'completed') return { body: i18nT('server.push.answered', { who }), tag: 'r:' + e.requestId };
    if (e.status === 'failed') return { body: i18nT('server.push.failed', { who }), tag: 'r:' + e.requestId };
    if (e.status === 'unknown') return { body: i18nT('server.push.unknown', { who }), tag: 'r:' + e.requestId };
    return null;
  }
  if (e.type === 'approval' && e.approvalId && e.status === 'pending') return { body: i18nT('server.push.approval', { who }), tag: 'a:' + e.approvalId };
  return null;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

// 보내는 쪽: 구글 로그인 토큰을 50분 동안 다시 쓴다
export function createPusher({ fetchImpl = fetch, now = () => Date.now(), log = () => {} } = {}) {
  let cached = { key: null, token: null, until: 0 };
  async function accessToken(sa) {
    if (cached.key === sa.clientEmail && cached.until > now()) return cached.token;
    const iat = Math.floor(now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ iss: sa.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.privateKey).toString('base64url');
    const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString(), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`push_login_${r.status}`);
    const j = await r.json();
    cached = { key: sa.clientEmail, token: j.access_token, until: now() + 50 * 60_000 };
    return j.access_token;
  }
  // 돌려주는 값: 'sent' | 'gone'(그 주소는 더 안 씀 — 지우기) | 'failed'
  async function send(sa, token, { title = i18nT('common.product'), body, conversationId, tag }) {
    try {
      const at = await accessToken(sa);
      const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`, { method: 'POST',
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ message: { token, notification: { title, body }, data: { conversationId: String(conversationId ?? ''), tag: String(tag ?? '') },
          android: { priority: 'HIGH', notification: { tag: String(tag ?? ''), channel_id: 'ieon' } } } }) });
      if (r.ok) return 'sent';
      const text = await r.text().catch(() => '');
      if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return 'gone';
      log({ event: 'push_failed', status: r.status });
      return 'failed';
    } catch (e) {
      log({ event: 'push_failed', error: String(e.message).slice(0, 40) });
      return 'failed';
    }
  }
  return { send };
}

// ---------------------------------------------------------------------------
// 웹 알림(Web Push, 탭을 닫아도). 표준 RFC 8291(aes128gcm 암호화)·RFC 8292(VAPID). node 기본 crypto만 — 새 부품 없음.
// 키는 허브가 처음 쓸 때 스스로 만든다(사용자 입력 없음). 알림 글은 휴대폰 알림과 같다(원문 없음).
import { createECDH, createHmac, createCipheriv, randomBytes as rnd, createPrivateKey, sign as edSign } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// VAPID 키 만들기: 공개 키(65바이트 압축 안 한 점, base64url)와 개인 키(32바이트, base64url)
export function makeVapidKeys() {
  const e = createECDH('prime256v1'); e.generateKeys();
  return { publicKey: e.getPublicKey().toString('base64url'), privateKey: e.getPrivateKey().toString('base64url') };
}
function vapidPrivateKeyObject(v) {
  const pub = Buffer.from(v.publicKey, 'base64url');
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') }, format: 'jwk' });
}
// 알림 서버 인증(VAPID JWT, ES256 — 서명은 r||s 64바이트)
export function vapidAuth(endpoint, v, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = edSign('sha256', Buffer.from(`${head}.${body}`), { key: vapidPrivateKeyObject(v), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${head}.${body}.${sig}, k=${v.publicKey}`;
}
// 브라우저 구독 키(p256dh·auth)로 내용 암호화(aes128gcm, 레코드 하나)
export function encryptWebPush(plaintext, sub, { salt = rnd(16), ecdh = null } = {}) {
  const ua = Buffer.from(sub.keys.p256dh, 'base64url');
  const auth = Buffer.from(sub.keys.auth, 'base64url');
  const as = ecdh ?? (() => { const e = createECDH('prime256v1'); e.generateKeys(); return e; })();
  const asPub = as.getPublicKey();
  const shared = as.computeSecret(ua);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPub.length;
  return Buffer.concat([header, asPub, enc]);
}
// 구독 검사(브라우저가 준 값 — 주소는 https만)
export function validateWebSub(v) {
  const ok = v && typeof v.endpoint === 'string' && /^https:\/\/[^\s]{10,1000}$/.test(v.endpoint)
    && /^[\w-]{80,100}$/.test(String(v.keys?.p256dh ?? '')) && /^[\w-]{16,30}$/.test(String(v.keys?.auth ?? ''));
  if (!ok) fail('bad_subscription');
  return { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } };
}
// 보내기: 'sent' | 'gone'(그 구독은 더 안 씀 — 지우기) | 'failed'
export function createWebPusher({ fetchImpl = fetch, log = () => {} } = {}) {
  async function send(v, sub, note, subject) {
    try {
      const body = encryptWebPush(JSON.stringify({ title: note.title ?? i18nT('common.product'), body: note.body, conversationId: note.conversationId ?? '', tag: note.tag ?? '' }), sub);
      const r = await fetchImpl(sub.endpoint, { method: 'POST', signal: AbortSignal.timeout(10_000), body,
        headers: { authorization: vapidAuth(sub.endpoint, v, subject), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high' } });
      if (r.ok) return 'sent';
      if (r.status === 404 || r.status === 410) return 'gone';
      log({ event: 'webpush_failed', status: r.status });
      return 'failed';
    } catch (e) {
      log({ event: 'webpush_failed', error: String(e.message).slice(0, 40) });
      return 'failed';
    }
  }
  return { send };
}
