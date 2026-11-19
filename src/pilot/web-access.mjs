// P4: 허브 웹 접속 제한(설계 HUB_AND_PC_PROFILES 5-1). 설정 파일의 webAccess로만 켠다(웹에서 바꾸지 않음).
// 방식: ip_allowlist(CIDR) · cloudflare_access(Cf-Access-Jwt-Assertion 서명·aud·iss·만료 검증) · tailscale(100.64.0.0/10).
// 여러 방식을 적으면 하나라도 통과하면 허용한다. 예외 경로(기기 API·카카오·Teams 수신·health)는 여기서 보지 않는다.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const MODES = ['ip_allowlist', 'cloudflare_access', 'tailscale'];

function ipv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip ?? '');
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return null;
  return ((Number(m[1]) << 24) >>> 0) + (Number(m[2]) << 16) + (Number(m[3]) << 8) + Number(m[4]);
}
export const normalizeIp = (ip) => String(ip ?? '').trim().replace(/^::ffff:/i, '').toLowerCase();

// "a.b.c.d/n", "a.b.c.d", IPv6 정확히 일치, "unix"(Unix 소켓으로 들어온 요청)
export function matchCidr(ip, cidr) {
  ip = normalizeIp(ip); cidr = String(cidr).trim().toLowerCase();
  if (cidr === 'unix') return ip === 'unix';
  const [net, bitsRaw] = cidr.split('/');
  const a = ipv4(ip); const b = ipv4(net);
  if (a === null || b === null) return bitsRaw === undefined && ip === normalizeIp(net);
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
const inList = (ip, list) => (list ?? []).some((c) => matchCidr(ip, c));

// 접속한 사람의 주소: 바로 붙은 상대가 믿는 앞단(trustedProxies)일 때만 X-Forwarded-For를 오른쪽부터 따라가
// 믿는 앞단이 아닌 첫 주소를 쓴다. 앞단이 아닌 곳에서 온 X-Forwarded-For는 무시한다(위조 방지).
export function clientIp(req, trustedProxies = []) {
  const peer = req.socket?.remoteAddress ? normalizeIp(req.socket.remoteAddress) : 'unix';
  if (!inList(peer, trustedProxies)) return peer;
  const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(normalizeIp).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) if (!inList(chain[i], trustedProxies)) return chain[i];
  return chain[0] ?? peer;
}

export function validateWebAccess(w) {
  if (!w || typeof w !== 'object') throw new Error('bad_web_access');
  const modes = Array.isArray(w.modes) ? w.modes : [];
  for (const m of modes) if (!MODES.includes(m)) throw new Error(`bad_web_access_mode:${m}`);
  if (modes.includes('ip_allowlist') && !(w.ipAllowlist ?? []).length) throw new Error('bad_web_access:ipAllowlist_empty');
  if (modes.includes('cloudflare_access')) {
    const td = String(w.cloudflare?.teamDomain ?? '');
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(td) || !w.cloudflare?.aud) throw new Error('bad_web_access:cloudflare');
  }
  return { ...w, modes };
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function createWebAccess(raw, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const w = validateWebAccess(raw);
  let jwks = null; let jwksAt = 0;
  const keys = async (force) => {
    if (!force && jwks && now() - jwksAt < 3600_000) return jwks;
    const r = await fetchImpl(`https://${w.cloudflare.teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('jwks_fetch_failed');
    jwks = (await r.json()).keys ?? []; jwksAt = now();
    return jwks;
  };
  // Cloudflare Access 토큰 검증. 헤더만 있고 검증이 안 되면 거절한다.
  const cloudflareOk = async (token) => {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return false;
    let header; let claims;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { return false; }
    if (header.alg !== 'RS256' || !header.kid) return false;
    let jwk = (await keys(false)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid); // 키 교체 직후
    if (!jwk) return false;
    const ok = cryptoVerify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    if (!ok) return false;
    const t = Math.floor(now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return aud.includes(w.cloudflare.aud) && claims.iss === `https://${w.cloudflare.teamDomain}`
      && typeof claims.exp === 'number' && claims.exp > t && !(typeof claims.nbf === 'number' && claims.nbf > t + 60);
  };

  return {
    modes: w.modes,
    clientIp: (req) => clientIp(req, w.trustedProxies),
    // 허용이면 통과한 방식 이름, 아니면 null
    async check(req) {
      const ip = clientIp(req, w.trustedProxies);
      for (const m of w.modes) {
        if (m === 'ip_allowlist' && inList(ip, w.ipAllowlist)) return m;
        if (m === 'tailscale' && matchCidr(ip, '100.64.0.0/10')) return m;
        if (m === 'cloudflare_access') {
          try { if (await cloudflareOk(req.headers['cf-access-jwt-assertion'])) return m; } catch { /* 키를 못 받으면 이 방식은 실패 */ }
        }
      }
      return null;
    },
  };
}

// 제한 없이 열리는 경로(토큰·서명 인증과 요청 횟수 제한은 각 경로에서 한다)
// W3: /v1/pair/*(짝맺기 요청·결과 조회)는 관리자 승인과 6자리 코드가 있어야 끝나므로 예외로 두고 요청 횟수만 제한한다.
export const isExemptPath = (path) => path === '/health' || path.startsWith('/v1/device/') || path.startsWith('/kakao/') || path.startsWith('/line/') || path.startsWith('/teams/')
  || path === '/v1/pair/start' || path === '/v1/pair/poll'
  || path === '/terms' // M4: 이용 약관(가입 전에 읽어야 함, 정적 화면)
  || path === '/privacy'; // AP-5a: 스토어 심사·사용자가 볼 수 있어야 하는 개인정보 처리방침(정적 화면, 개인 정보 없음)