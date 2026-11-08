// W1: 웹 로그인(설계 WEB_FIRST 2절). 사용자는 토큰을 다루지 않는다.
// - 허브(설정에 webAccess 있음): 처음 한 번 "관리자 만들기"(비밀번호) → 이후 비밀번호 로그인.
// - PC(webAccess 없음): 이 PC의 127.0.0.1에서 앞단 없이 연 화면은 자동 로그인. 다른 곳(Tailscale 등)에서는 비밀번호.
// - 쿠키 ieon_sid(HttpOnly·SameSite=Strict·https면 Secure·12시간), 서버에는 해시만. 쿠키로 온 변경 요청은 Origin을 검사한다.
// - 메신저·연결부·외부 앱의 Bearer 토큰 인증은 그대로 둔다(내부 토큰).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ieon_sid';
const TTL_MS = 12 * 3600_000;
const LOCK_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const sha = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(pw, salt, 32).toString('base64url')}`;
}
export function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = scryptSync(String(pw), Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}
export const validPassword = (pw) => typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;

function cookieOf(req) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export function createWebAuth({ store, config, access, clientIp }) {
  const mode = config.webAccess ? 'hub' : 'pc';
  const webUser = (config.users ?? []).find((u) => u.appId === 'app_web')?.userId ?? 'u_sinsan';
  const fails = new Map(); // 주소 → { n, until }
  const admin = () => store.getSetting('auth.admin')?.value ?? null;
  const isLocalDirect = (req) => !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    && !req.headers['x-forwarded-for'];
  const secure = (req) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  const issue = (req, res) => {
    const sid = randomBytes(32).toString('base64url');
    store.addWebSession(sha(sid), webUser, Date.now() + TTL_MS);
    res.setHeader('set-cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}${secure(req) ? '; Secure' : ''}`);
  };
  const clear = (res) => res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  // 쿠키로 온 변경 요청: 브라우저가 붙이는 Origin의 호스트가 요청 호스트와 같아야 한다(다른 사이트에서 보낸 요청 차단).
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
      return new URL(origin).host === host;
    } catch { return false; }
  };
  const locked = (ip) => { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
  const fail = (ip) => {
    const f = fails.get(ip) ?? { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= LOCK_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
    fails.set(ip, f);
  };
  const log = (event, req) => process.stderr.write(JSON.stringify({ ch: 'auth', event, at: new Date().toISOString(), from: clientIp(req) }) + '\n');

  return {
    mode,
    // 쿠키 세션의 사용자(없으면 null). 변경 요청이면 Origin도 본다.
    principal(req) {
      const sid = cookieOf(req);
      if (!sid) return null;
      const s = store.webSession(sha(sid));
      if (!s) return null;
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return { error: 'bad_origin' };
      return { userId: s.userId, appId: 'app_web' };
    },
    // /v1/auth/* 처리. 처리했으면 true.
    async handle(req, res, path, { json, readJson }) {
      if (!path.startsWith('/v1/auth/')) return false;
      const ip = clientIp(req);
      if (req.method === 'GET' && path === '/v1/auth/state') {
        const s = cookieOf(req) && store.webSession(sha(cookieOf(req)));
        json(res, 200, { mode, setupRequired: !admin(), loggedIn: Boolean(s), localAuto: mode === 'pc' && isLocalDirect(req) });
        return true;
      }
      if (req.method !== 'POST') { json(res, 404, { error: 'not_found' }); return true; }
      if (!sameOrigin(req)) { json(res, 403, { error: 'bad_origin' }); return true; }
      if (path === '/v1/auth/local') {
        if (mode !== 'pc' || !isLocalDirect(req)) { json(res, 403, { error: 'local_only' }); return true; }
        issue(req, res); log('login_local', req); json(res, 200, { loggedIn: true }); return true;
      }
      if (path === '/v1/auth/logout') {
        const sid = cookieOf(req); if (sid) store.deleteWebSession(sha(sid));
        clear(res); json(res, 200, { loggedIn: false }); return true;
      }
      const body = await readJson(req);
      if (path === '/v1/auth/setup') {
        if (admin()) { json(res, 409, { error: 'already_setup' }); return true; }
        // PC는 그 PC에서만 관리자를 만든다. 허브는 접속 제한(5-1)을 통과한 곳에서만 여기까지 온다.
        if (mode === 'pc' && !isLocalDirect(req)) { json(res, 403, { error: 'local_only' }); return true; }
        if (!validPassword(body.password)) { json(res, 400, { error: 'weak_password' }); return true; }
        store.setSetting('auth.admin', { hash: hashPassword(body.password), createdAt: new Date().toISOString() });
        issue(req, res); log('setup', req); json(res, 200, { loggedIn: true }); return true;
      }
      if (path === '/v1/auth/login') {
        const wait = locked(ip);
        if (wait) { res.setHeader('retry-after', String(wait)); json(res, 429, { error: 'locked', retryAfter: wait }); return true; }
        const a = admin();
        if (!a) { json(res, 409, { error: 'setup_required' }); return true; }
        if (!verifyPassword(body.password, a.hash)) { fail(ip); log('login_failed', req); json(res, 401, { error: 'bad_password' }); return true; }
        fails.delete(ip); issue(req, res); log('login', req); json(res, 200, { loggedIn: true }); return true;
      }
      if (path === '/v1/auth/password') {
        const s = cookieOf(req) && store.webSession(sha(cookieOf(req)));
        const a = admin();
        if (!s || !a) { json(res, 401, { error: 'unauthorized' }); return true; }
        if (!verifyPassword(body.current, a.hash)) { fail(ip); json(res, 401, { error: 'bad_password' }); return true; }
        if (!validPassword(body.next)) { json(res, 400, { error: 'weak_password' }); return true; }
        store.setSetting('auth.admin', { hash: hashPassword(body.next), createdAt: a.createdAt, changedAt: new Date().toISOString() });
        store.deleteAllWebSessions(); issue(req, res); log('password_changed', req); json(res, 200, { loggedIn: true }); return true;
      }
      json(res, 404, { error: 'not_found' });
      return true;
    },
  };
}
