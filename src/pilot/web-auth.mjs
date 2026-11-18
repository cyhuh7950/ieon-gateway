// W1: 웹 로그인(설계 WEB_FIRST 2절). 사용자는 토큰을 다루지 않는다.
// - 허브(설정에 webAccess 있음): 처음 한 번 "관리자 만들기"(비밀번호) → 이후 비밀번호 로그인.
// - PC(webAccess 없음): 이 PC의 127.0.0.1에서 앞단 없이 연 화면은 자동 로그인. 다른 곳(Tailscale 등)에서는 비밀번호.
// - 쿠키 ieon_sid(HttpOnly·SameSite=Strict·https면 Secure·유지 기간은 웹 설정, 기본 30일 — 규칙 점검 10, 전에는 12시간), 서버에는 해시만. 쿠키로 온 변경 요청은 Origin을 검사한다.
// - 메신저·연결부·외부 앱의 Bearer 토큰 인증은 그대로 둔다(내부 토큰).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ieon_sid';
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

export function createWebAuth({ store, config, access, clientIp, installKind = () => null }) {
  const mode = config.webAccess ? 'hub' : 'pc';
  const webUser = (config.users ?? []).find((u) => u.appId === 'app_web')?.userId ?? 'u_sinsan';
  const fails = new Map(); // 주소 → { n, until }
  const admin = () => store.getSetting('auth.admin')?.value ?? null;
  const isLocalDirect = (req) => !req.ieonPublic && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    && !req.headers['x-forwarded-for'];
  const secure = (req) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  const loginDays = () => { const d = store.getSetting('auth.loginDays')?.value?.days; return Number.isInteger(d) ? d : (config.loginDays ?? 30); };
  // M2: 가입한 사용자(관리자 아닌 사람). 여러 사람 쓰기가 꺼져 있으면 가입 신청을 받지 않음(승인된 사람 로그인은 그대로)
  const multiUser = () => Boolean(store.getSetting('multiUser.enabled')?.value?.enabled);
  const normEmail = (e) => String(e ?? '').trim().toLowerCase();
  const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(e);
  // 그 세션의 사람: 관리자면 role admin, 가입한 사람이면 role user + 상태
  const who = (userId) => { if (userId === webUser) return { userId, role: 'admin', status: 'approved' }; const u = store.user(userId); return u ? { userId, role: 'user', status: u.status, email: u.email } : null; };
  const issue = (req, res, userId = webUser) => {
    const sid = randomBytes(32).toString('base64url');
    const ttl = loginDays() * 86_400_000;
    store.addWebSession(sha(sid), userId, Date.now() + ttl);
    res.setHeader('set-cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl / 1000}${secure(req) ? '; Secure' : ''}`);
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

  return { loginDays, multiUser, who,
    mode,
    // 쿠키 세션의 사용자(없으면 null). 변경 요청이면 Origin도 본다.
    principal(req) {
      const sid = cookieOf(req);
      if (!sid) return null;
      const s = store.webSession(sha(sid));
      if (!s) return null;
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return { error: 'bad_origin' };
      const w = who(s.userId);
      if (!w || ['rejected', 'disabled'].includes(w.status)) return null;
      return { userId: s.userId, appId: 'app_web', role: w.role, status: w.status };
    },
    // /v1/auth/* 처리. 처리했으면 true.
    async handle(req, res, path, { json, readJson }) {
      if (!path.startsWith('/v1/auth/')) return false;
      const ip = clientIp(req);
      if (req.method === 'GET' && path === '/v1/auth/state') {
        const s = cookieOf(req) && store.webSession(sha(cookieOf(req)));
        const w = s ? who(s.userId) : null;
        json(res, 200, { mode, setupRequired: !admin(), loggedIn: Boolean(w && !['rejected', 'disabled'].includes(w.status)), localAuto: mode === 'pc' && isLocalDirect(req), installKind: installKind(),
          ...(mode === 'hub' && multiUser() ? { signupOpen: true } : {}), ...(w?.role === 'user' ? { role: 'user', status: w.status, email: w.email } : {}) }); // M2: 가입한 사용자일 때만 역할·상태
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
      // M2 가입 신청(허브, 여러 사람 쓰기가 켜져 있을 때만): 이메일·비밀번호 → 승인 대기. 로그인은 되지만 승인 전에는 아무 기능도 못 씀
      if (path === '/v1/auth/signup') {
        const wait = locked(ip);
        if (wait) { res.setHeader('retry-after', String(wait)); json(res, 429, { error: 'locked', retryAfter: wait }); return true; }
        if (mode !== 'hub' || !multiUser()) { json(res, 403, { error: 'signup_closed' }); return true; }
        const email = normEmail(body.email);
        if (!validEmail(email)) { json(res, 400, { error: 'bad_email' }); return true; }
        if (!validPassword(body.password)) { json(res, 400, { error: 'weak_password' }); return true; }
        const userId = 'u_' + randomBytes(8).toString('hex');
        const r = store.addUser(userId, email, hashPassword(body.password));
        if (r.http !== 201) { fail(ip); json(res, r.http, { error: r.code }); return true; }
        issue(req, res, userId); log('signup', req); json(res, 201, { loggedIn: true, status: 'pending' }); return true;
      }
      if (path === '/v1/auth/login') {
        const wait = locked(ip);
        if (wait) { res.setHeader('retry-after', String(wait)); json(res, 429, { error: 'locked', retryAfter: wait }); return true; }
        // M2: 이메일을 넣으면 가입한 사용자 로그인, 비우면 관리자 비밀번호 로그인
        if (body.email) {
          const u = store.userByEmail(normEmail(body.email));
          if (!u || !verifyPassword(body.password, u.pwHash)) { fail(ip); log('login_failed', req); json(res, 401, { error: 'bad_password' }); return true; }
          if (['rejected', 'disabled'].includes(u.status)) { json(res, 403, { error: 'account_disabled' }); return true; }
          fails.delete(ip); issue(req, res, u.userId); log('login_user', req); json(res, 200, { loggedIn: true, status: u.status }); return true;
        }
        const a = admin();
        if (!a) { json(res, 409, { error: 'setup_required' }); return true; }
        if (!verifyPassword(body.password, a.hash)) { fail(ip); log('login_failed', req); json(res, 401, { error: 'bad_password' }); return true; }
        fails.delete(ip); issue(req, res); log('login', req); json(res, 200, { loggedIn: true }); return true;
      }
      if (path === '/v1/auth/password') {
        const s = cookieOf(req) && store.webSession(sha(cookieOf(req)));
        const a = admin();
        if (!s || !a || s.userId !== webUser) { json(res, 401, { error: 'unauthorized' }); return true; } // 관리자 비밀번호 바꾸기는 관리자만
        if (!verifyPassword(body.current, a.hash)) { fail(ip); json(res, 401, { error: 'bad_password' }); return true; }
        if (!validPassword(body.next)) { json(res, 400, { error: 'weak_password' }); return true; }
        store.setSetting('auth.admin', { hash: hashPassword(body.next), createdAt: a.createdAt, changedAt: new Date().toISOString() });
        store.deleteWebSessionsOf(webUser); issue(req, res); log('password_changed', req); json(res, 200, { loggedIn: true }); return true; // M2: 관리자 세션만 끊음
      }
      json(res, 404, { error: 'not_found' });
      return true;
    },
  };
}
