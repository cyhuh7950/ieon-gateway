// AP-4b 휴대폰 알림(Firebase Cloud Messaging HTTP v1). 설계 APP_AP4_PLAN 1·3절.
// - 알림 글은 "○○가 답했어요" / "○○가 허락을 기다려요" / "○○에게 보내지 못했어요" / "○○ — 확인이 필요해요"만. 질문·답·명령 원문은 넣지 않는다(구글 서버를 거침).
// - 서비스 계정 키로 구글에 로그인(JWT RS256, node 기본 crypto — 새 부품 없음). 키 원문은 화면·로그에 내보내지 않는다.
// - 알림 주소(FCM 토큰)가 더는 쓰이지 않으면(UNREGISTERED·404) 그 주소를 지운다.
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
  const c = name.charCodeAt(name.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? name + '이' : name + '가';
}

// 새 소식 하나 → 알림 글(원문 없음). 알릴 것이 아니면 null(접수·실행 중 등)
export function pushNote(e, who = 'AI 직원') {
  if (e.type === 'request' && e.requestId) {
    if (e.status === 'completed') return { body: `${iga(who)} 답했어요`, tag: 'r:' + e.requestId };
    if (e.status === 'failed') return { body: `${who}에게 보내지 못했어요`, tag: 'r:' + e.requestId };
    if (e.status === 'unknown') return { body: `${who} — 확인이 필요해요`, tag: 'r:' + e.requestId };
    return null;
  }
  if (e.type === 'approval' && e.approvalId && e.status === 'pending') return { body: `${iga(who)} 허락을 기다려요`, tag: 'a:' + e.approvalId };
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
  async function send(sa, token, { title = '이어온', body, conversationId, tag }) {
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
