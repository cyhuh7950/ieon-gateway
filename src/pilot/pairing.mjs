// W3: 짝맺기(허브 쪽). PC가 요청하면 6자리 확인 코드를 만들고, 관리자가 허브 웹에서 같은 코드를 보고 승인하면
// 기기를 등록하고 기기 토큰을 그 PC에 한 번만 건넨다. 사용자는 토큰을 보거나 옮기지 않는다(설계 WEB_FIRST 3절).
// U6: 허브 관리자가 "PC 연결 링크"(1회용 초대, 10분)를 만들면, 그 링크를 연 PC의 요청은 코드 확인 없이 바로 승인된다.
// 요청은 메모리에만 두고 10분 뒤 사라진다. 짝맺기 ID는 추측할 수 없는 값(32바이트)이라 그것을 아는 PC만 결과를 받는다.
import { createHash, randomBytes, randomInt } from 'node:crypto';

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 5;

export function createPairing({ store, reserved = () => new Set(), now = () => Date.now() }) {
  const reqs = new Map(); // pairId → { pairId, code, name, from, createdAt, expiresAt, status, hostId, token }
  const invites = new Map(); // 초대(32바이트) → { userId, replaceHostId, expiresAt }
  const sweep = () => {
    for (const [k, r] of reqs) if (r.expiresAt < now() && r.status !== 'approved') reqs.delete(k);
    for (const [k, i] of invites) if (i.expiresAt < now()) invites.delete(k);
  };
  const view = (r) => ({ id: r.pairId.slice(0, 12), code: r.code, name: r.name, from: r.from, createdAt: new Date(r.createdAt).toISOString(), status: r.status });
  const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'pc';
  const free = (base) => {
    const taken = new Set([...store.listDevices().map((d) => d.hostId), ...reserved()]);
    for (let i = 0; i < 100; i++) { const h = i ? `h_${base}-${i + 1}` : `h_${base}`; if (!taken.has(h)) return h; }
    return `h_${base}-${randomBytes(3).toString('hex')}`;
  };
  // 승인: 기기를 등록(또는 같은 기기의 토큰을 새로)하고 PC가 한 번 받아 갈 토큰을 요청에 붙인다.
  function grant(r, userId, replaceHostId) {
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    let hostId;
    if (replaceHostId) {
      if (!store.listDevices().some((d) => d.hostId === replaceHostId)) return { http: 404, error: 'unknown_device' };
      const re = store.reissueDevice(replaceHostId, hash, userId);
      if (re.http !== 200) return { http: re.http, error: re.code };
      hostId = replaceHostId;
    } else {
      hostId = free(slug(r.name));
      const added = store.addDevice(hostId, r.name, hash, userId);
      if (added.http !== 201) return { http: added.http, error: added.code };
    }
    Object.assign(r, { status: 'approved', hostId, token, expiresAt: now() + TTL_MS });
    return { http: 200, body: { hostId, name: r.name } };
  }
  return {
    // U6: PC 연결 링크용 1회용 초대. 값은 만든 관리자 화면에만 보이고 서버 기록에 남기지 않는다.
    invite(userId, replaceHostId = null) {
      sweep();
      if (invites.size >= MAX_PENDING) return { http: 429, error: 'too_many_invites' };
      if (replaceHostId && !store.listDevices().some((d) => d.hostId === replaceHostId)) return { http: 404, error: 'unknown_device' };
      const invite = randomBytes(32).toString('base64url');
      invites.set(invite, { userId, replaceHostId, expiresAt: now() + TTL_MS });
      return { http: 201, body: { invite, expiresAt: new Date(now() + TTL_MS).toISOString() } };
    },
    start({ name, from, invite }) {
      sweep();
      const n = String(name ?? '').trim();
      if (!n || n.length > 40 || /[\r\n]/.test(n)) return { http: 400, error: 'bad_name' };
      // 초대가 붙어 오면 맞는 초대일 때만 받는다(틀리면 코드 확인으로 넘어가지 않고 거절). 쓰면 바로 지운다(1회용).
      const inv = invite ? invites.get(String(invite)) : null;
      if (invite && !inv) return { http: 403, error: 'bad_invite' };
      if (!inv && [...reqs.values()].filter((r) => r.status === 'pending').length >= MAX_PENDING) return { http: 429, error: 'too_many_pending' };
      const r = { pairId: randomBytes(32).toString('base64url'), code: String(randomInt(0, 1_000_000)).padStart(6, '0'), name: n,
        from: String(from ?? '').slice(0, 64), createdAt: now(), expiresAt: now() + TTL_MS, status: 'pending' };
      if (inv) {
        invites.delete(String(invite));
        const g = grant(r, inv.userId, inv.replaceHostId);
        if (g.error) return g;
      }
      reqs.set(r.pairId, r);
      return { http: 201, body: { pairId: r.pairId, code: r.code, expiresAt: new Date(r.expiresAt).toISOString(), ...(inv ? { approved: true } : {}) } };
    },
    // PC가 결과를 묻는다. 승인됐으면 토큰을 한 번만 주고 지운다.
    poll(pairId) {
      sweep();
      const r = reqs.get(String(pairId ?? ''));
      if (!r) return { http: 404, body: { status: 'expired' } };
      if (r.status !== 'approved') return { http: 200, body: { status: r.status } };
      reqs.delete(r.pairId);
      return { http: 200, body: { status: 'approved', hostId: r.hostId, token: r.token } };
    },
    pending() { sweep(); return [...reqs.values()].filter((r) => r.status === 'pending').map(view); },
    // 관리자 승인: 화면에 보인 짧은 ID와 코드가 둘 다 맞아야 한다. replaceHostId를 주면 그 웹 기기의 토큰을 새로 바꿔 이어 쓴다
    // (같은 PC를 다시 짝맺을 때 세션 등록을 그대로 쓰도록).
    approve(id, code, userId, replaceHostId) {
      sweep();
      const r = [...reqs.values()].find((x) => x.pairId.startsWith(String(id)) && x.status === 'pending');
      if (!r) return { http: 404, error: 'not_found' };
      if (String(code) !== r.code) return { http: 400, error: 'code_mismatch' };
      return grant(r, userId, replaceHostId);
    },
    reject(id) {
      const r = [...reqs.values()].find((x) => x.pairId.startsWith(String(id)) && x.status === 'pending');
      if (!r) return { http: 404, error: 'not_found' };
      r.status = 'rejected';
      return { http: 200, body: { rejected: true } };
    },
  };
}