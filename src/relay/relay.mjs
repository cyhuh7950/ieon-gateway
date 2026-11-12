// 공개 수신 중계(MULTI_BOTS 6절, M4-a). Oracle에서 돌리고, 이 PC가 먼저 접속해 메시지를 가져간다.
// - 카카오 스킬 요청을 받아 5초 안에 "접수"로 답하고, 질문은 PC가 가져갈 때까지 짧게 메모리에만 둔다.
// - 질문 원문·사용자 키는 로그에 남기지 않는다(로그에는 이벤트 종류만). 디스크에 쓰지 않는다.
// - 이 모듈은 비밀번호·메신저 토큰을 갖지 않는다. 카카오 스킬 URL의 비밀 값과 PC 토큰만 안다.
// - L1 라인: 라인 webhook(/line/webhook/<비밀>)은 받은 본문 그대로와 서명 헤더만 맡아 두고, 서명 확인·답하기는 채널 비밀 값을 가진
//   메신저 쪽이 한다(이 모듈은 라인 토큰도 갖지 않는다). 메신저마다 대기열을 따로 두어 카카오 실행기가 라인 몫을 가져가지 않게 한다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const DEFAULTS = {
  maxBody: 16 * 1024, maxText: 2000, maxQueue: 100, ttlMs: 60_000, pcAliveMs: 45_000, pollWaitMs: 25_000,
  dedupeMs: 5 * 60_000, rateLimit: 60, rateWindowMs: 60_000, trustProxy: false,
  callbackHosts: ['bot-api.kakao.com'],
};

const MSG = {
  accepted: '접수되었습니다. 답을 기다리는 중…',
  pcDown: '이어온 PC가 연결되어 있지 않습니다. PC를 켠 뒤 다시 보내 주세요.',
  full: '지금 대기 중인 요청이 너무 많습니다. 잠시 뒤 다시 보내 주세요.',
  noCallback: '이 블록에 AI 챗봇 콜백이 켜져 있지 않아 답을 보낼 수 없습니다. 오픈빌더 설정을 확인하세요.',
  bad: '요청을 처리할 수 없습니다.',
};

const text = (t) => ({ version: '2.0', template: { outputs: [{ simpleText: { text: t } }] } });
const accepted = () => ({ version: '2.0', useCallback: true, data: { text: MSG.accepted } });

const safeEqual = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

// 콜백 주소는 https이고 허용 도메인(정확히 일치하거나 하위 도메인)일 때만 받는다. PC가 이 주소로 보내므로 임의 주소를 막는다.
export function callbackAllowed(url, hosts) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

// L1: 라인 서명은 받은 바이트 그대로에 대해 만들어지므로 본문을 고치지 않고 글자로만 읽는다.
async function readText(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('too_large'), { code: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('too_large'), { code: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('bad_json'), { code: 400 }); }
}

// cfg: { pcToken, kakaoSecret, ...DEFAULTS 덮어쓰기, log(e), now() }
export function createRelay(cfg) {
  if (!cfg?.pcToken || String(cfg.pcToken).length < 16) throw new Error('pcToken은 16자 이상이어야 합니다.');
  if (!cfg.kakaoSecret || String(cfg.kakaoSecret).length < 16) throw new Error('kakaoSecret은 16자 이상이어야 합니다.');
  const o = { ...DEFAULTS, ...cfg };
  const now = o.now ?? Date.now;
  const log = (e) => o.log?.({ ch: 'relay', at: new Date(now()).toISOString(), ...e });
  const queues = { kakao: [], line: [] }; // 메신저별 대기열. kakao: { id, channel, userKey, text, callbackUrl, at } / line: { id, channel, raw, signature, at }
  const queue = queues.kakao; // 카카오 코드가 쓰던 이름 그대로
  const lineSecret = String(o.lineSecret ?? o.kakaoSecret); // 따로 정하지 않으면 카카오와 같은 비밀 경로 값
  const seen = new Map(); // 콜백 주소 해시 → 시각(재전송 중복 제거). 질문 원문은 보관하지 않는다.
  const hits = new Map(); // IP → { n, from }
  const waiters = { kakao: new Set(), line: new Set() }; // 대기 중인 PC 폴링(메신저별): (items) => void
  let lastPoll = 0;
  let seq = 0;

  const pcAlive = () => now() - lastPoll < o.pcAliveMs;
  const purge = () => {
    const t = now();
    for (const [ch, q] of Object.entries(queues)) for (let i = q.length - 1; i >= 0; i--) if (t - q[i].at > o.ttlMs) { q.splice(i, 1); log({ event: 'expired', channel: ch }); }
    for (const [k, at] of seen) if (t - at > o.dedupeMs) seen.delete(k);
    for (const [k, h] of hits) if (t - h.from > o.rateWindowMs) hits.delete(k);
  };
  const limited = (ip) => {
    const t = now();
    const h = hits.get(ip);
    if (!h || t - h.from > o.rateWindowMs) { hits.set(ip, { n: 1, from: t }); return false; }
    return ++h.n > o.rateLimit;
  };
  // 허브 내장일 때는 허브가 믿는 앞단 기준으로 계산한 주소 함수를 넘겨받는다(P5).
  const clientIp = o.clientIp ?? ((req) => (o.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?');
  const flush = (ch = 'kakao') => {
    if (!queues[ch].length) return;
    const w = waiters[ch].values().next().value;
    if (w) { waiters[ch].delete(w); w(queues[ch].splice(0)); }
  };

  function kakao(body) {
    const ur = body?.userRequest;
    const utterance = typeof ur?.utterance === 'string' ? ur.utterance.trim() : '';
    const userKey = typeof ur?.user?.id === 'string' ? ur.user.id : '';
    if (!utterance || !userKey || utterance.length > o.maxText) return { status: 200, body: text(MSG.bad) };
    // PC가 꺼져 있으면 콜백 없이 응답 본문으로 바로 알린다(5초 제한).
    if (!pcAlive()) { log({ event: 'pc_down' }); return { status: 200, body: text(MSG.pcDown) }; }
    if (!ur.callbackUrl) return { status: 200, body: text(MSG.noCallback) };
    if (!callbackAllowed(ur.callbackUrl, o.callbackHosts)) { log({ event: 'callback_rejected' }); return { status: 200, body: text(MSG.bad) }; }
    const key = createHash('sha256').update(ur.callbackUrl).digest('hex');
    if (seen.has(key)) { log({ event: 'duplicate' }); return { status: 200, body: accepted() }; }
    if (queue.length >= o.maxQueue) { log({ event: 'queue_full' }); return { status: 200, body: text(MSG.full) }; }
    seen.set(key, now());
    queue.push({ id: `k${now().toString(36)}${(seq++).toString(36)}`, channel: 'kakao', userKey, text: utterance, callbackUrl: ur.callbackUrl, at: now() });
    log({ event: 'queued', channel: 'kakao', depth: queue.length });
    flush();
    return { status: 200, body: accepted() };
  }

  // L1: 라인 webhook. 본문을 그대로 맡겨 두고 바로 200(라인은 빠른 응답을 기다린다). PC가 꺼져 있으면 답할 수단이 없어 버리고 기록만.
  function line(raw, signature) {
    if (!signature || signature.length > 200) return { status: 401, body: { error: 'no_signature' } };
    if (!pcAlive()) { log({ event: 'pc_down', channel: 'line' }); return { status: 200, body: {} }; }
    if (queues.line.length >= o.maxQueue) { log({ event: 'queue_full', channel: 'line' }); return { status: 200, body: {} }; }
    queues.line.push({ id: `l${now().toString(36)}${(seq++).toString(36)}`, channel: 'line', raw, signature, at: now() });
    log({ event: 'queued', channel: 'line', depth: queues.line.length });
    flush('line');
    return { status: 200, body: {} };
  }

  function poll(req, res, ch = 'kakao') {
    lastPoll = now();
    purge();
    const queue = queues[ch];
    const send = (items) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: items.map(({ at, ...rest }) => ({ ...rest, ageMs: now() - at })) }));
    };
    if (queue.length) return send(queue.splice(0)); // 가져가면 바로 지운다.
    const w = (items) => { clearTimeout(timer); send(items); };
    const timer = setTimeout(() => { waiters[ch].delete(w); lastPoll = now(); send([]); }, o.pollWaitMs);
    waiters[ch].add(w);
    req.on('close', () => { clearTimeout(timer); waiters[ch].delete(w); });
  }

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      purge();
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, pc: pcAlive() });
      if (req.method === 'GET' && url.pathname === '/pc/poll') {
        if (!safeEqual((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''), o.pcToken)) return json(res, 401, { error: 'unauthorized' });
        // 메신저별로 가져간다(?channel=line). 값이 없으면 예전 PC와 맞게 카카오.
        const ch = url.searchParams.get('channel') ?? 'kakao';
        if (!queues[ch]) return json(res, 400, { error: 'bad_channel' });
        return poll(req, res, ch);
      }
      const m = url.pathname.match(/^\/kakao\/skill\/([^/]+)$/);
      if (req.method === 'POST' && m) {
        // 비밀 값이 틀리면 존재 자체를 알리지 않는다.
        if (!safeEqual(m[1], o.kakaoSecret)) return json(res, 404, { error: 'not_found' });
        if (limited(clientIp(req))) { log({ event: 'rate_limited' }); return json(res, 429, { error: 'rate_limited' }); }
        const r = kakao(await readJson(req, o.maxBody));
        return json(res, r.status, r.body);
      }
      const lm = url.pathname.match(/^\/line\/webhook\/([^/]+)$/);
      if (req.method === 'POST' && lm) {
        if (!safeEqual(lm[1], lineSecret)) return json(res, 404, { error: 'not_found' });
        if (limited(clientIp(req))) { log({ event: 'rate_limited', channel: 'line' }); return json(res, 429, { error: 'rate_limited' }); }
        const raw = await readText(req, o.maxBody);
        const r = line(raw, String(req.headers['x-line-signature'] ?? ''));
        return json(res, r.status, r.body);
      }
      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      const code = e.code === 413 || e.code === 400 ? e.code : 500;
      if (code === 500) log({ event: 'error', kind: String(e.name) });
      return json(res, code, { error: code === 413 ? 'too_large' : code === 400 ? 'bad_request' : 'internal' });
    }
  }

  const server = createServer(handler);
  return {
    server, handler,
    listen: (port, host = '127.0.0.1') => new Promise((ok) => server.listen(port, host, () => ok(server.address()))),
    close: () => new Promise((ok) => { for (const set of Object.values(waiters)) for (const w of set) w([]); server.close(() => ok()); server.closeAllConnections?.(); }),
    depth: (ch = 'kakao') => queues[ch].length,
  };
}