// L1 라인(LINE) 연결(설계 MESSENGER_EXPANSION A). 라인은 카카오처럼 우리 공개 주소로 webhook을 보내므로 공개 중계(src/relay)나
// 허브 내장 중계가 받아 두고, 이 실행기가 먼저 접속해 가져온다(?channel=line).
// - 중계는 서명을 확인할 비밀 값이 없다. 받은 본문 그대로를 채널 비밀 값으로 HMAC-SHA256 서명 확인하고, 틀리면 버린다.
// - 답하기: 라인은 메시지마다 한 번 쓸 수 있는 답장 표(reply token)를 주지만 쓸 수 있는 시간이 짧다. 그래서 답이 빨리 오면 답장 표로
//   (무료), 늦으면 정해진 시간(replyWaitMs)에 "받았어요"를 답장 표로 보내고 실제 답은 보내기(push — 공식 계정 요금제의 월 건수에 포함)로.
// - 처음에는 1:1 대화만(그룹·여러 사람 방은 안내만). 같은 이벤트가 다시 오면 한 번만 처리(webhookEventId).
// - 토큰·채널 비밀 값·질문·답 원문은 기록하지 않는다(이벤트 종류만).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { splitText } from './bridge.mjs';

const API = 'https://api.line.me';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_NOTICE = '접수됨 — 답을 기다리는 중'; // 브리지의 중간 안내. 라인은 자체 "받았어요"로 대신한다.
export const LINE_TEXT_MAX = 4800; // 라인 글 한 칸은 5000자까지
const PER_CALL = 5; // 한 번에 보낼 수 있는 말풍선 수
export const RECEIVED = '받았어요. 답을 만드는 중이에요 — 끝나면 보내 드릴게요.';
export const ONLY_DIRECT = '지금은 1:1 대화에서만 쓸 수 있어요. 봇과의 1:1 대화에서 보내 주세요.';

// 라인 서명: base64(HMAC-SHA256(채널 비밀 값, 받은 본문 그대로)). 길이가 다르면 바로 거절, 같으면 시간 차이 없는 비교.
export function lineSignatureOk(raw, signature, channelSecret) {
  if (typeof raw !== 'string' || !signature || !channelSecret) return false;
  const want = Buffer.from(createHmac('sha256', channelSecret).update(raw, 'utf8').digest('base64'));
  const got = Buffer.from(String(signature));
  return got.length === want.length && timingSafeEqual(got, want);
}

// opts: { relayUrl, relayToken, accessToken, channelSecret, onMessage, log, signal, fetchImpl?, replyWaitMs?, flushMs?, pollTimeoutMs? }
export function runLine(opts) {
  const { relayUrl, relayToken, accessToken, channelSecret, onMessage, log, signal } = opts;
  const f = opts.fetchImpl ?? fetch;
  const replyWait = opts.replyWaitMs ?? 20_000;
  const flushMs = opts.flushMs ?? 300;
  const seen = new Map(); // webhookEventId → 시각(10분)
  const lineApi = (path, body) => f(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
  const msgs = (texts) => texts.map((t) => ({ type: 'text', text: t }));

  async function handleEvent(ev) {
    const id = ev?.webhookEventId;
    if (id) { if (seen.has(id)) return log({ platform: 'line', event: 'duplicate' }); seen.set(id, Date.now()); }
    for (const [k, at] of seen) if (Date.now() - at > 10 * 60_000) seen.delete(k);
    if (ev?.type !== 'message' || ev.message?.type !== 'text' || typeof ev.message.text !== 'string') return; // 따라 하기·스티커 등은 무시
    const reply = { token: ev.replyToken ?? null, at: Date.now(), used: false };
    const useReply = async (texts) => {
      reply.used = true;
      const r = await lineApi('/v2/bot/message/reply', { replyToken: reply.token, messages: msgs(texts) }).catch(() => null);
      if (!r?.ok) log({ platform: 'line', event: 'reply_failed', status: r?.status ?? 0 });
      return Boolean(r?.ok);
    };
    if (ev.source?.type !== 'user' || !ev.source.userId) {
      if (reply.token) await useReply([ONLY_DIRECT]);
      return log({ platform: 'line', event: 'group_ignored' });
    }
    const user = ev.source.userId;
    const out = []; let timer = null; let flushing = Promise.resolve();
    const flush = () => {
      flushing = flushing.then(async () => {
        while (out.length) {
          const batch = out.splice(0, PER_CALL);
          if (reply.token && !reply.used && Date.now() - reply.at < replyWait) { await useReply(batch); continue; }
          const r = await lineApi('/v2/bot/message/push', { to: user, messages: msgs(batch) }).catch(() => null);
          if (!r?.ok) log({ platform: 'line', event: 'push_failed', status: r?.status ?? 0 });
        }
      });
      return flushing;
    };
    const send = async (t) => {
      const s = String(t);
      if (s.endsWith(WAIT_NOTICE)) return;
      out.push(...splitText(s, LINE_TEXT_MAX));
      clearTimeout(timer); timer = setTimeout(flush, flushMs);
    };
    // 답이 늦으면 답장 표가 지나기 전에 "받았어요"로 쓰고, 실제 답은 보내기로.
    const late = setTimeout(() => { if (reply.token && !reply.used && !out.length) useReply([RECEIVED]); }, replyWait);
    try {
      await onMessage({ platform: 'line', userId: user, chatId: user, isGroup: false, called: true, text: ev.message.text }, send);
    } catch (e) {
      log({ platform: 'line', event: 'handle_error', error: String(e.message).slice(0, 80) });
      out.push('처리 중 오류가 났습니다.');
    } finally {
      clearTimeout(late); clearTimeout(timer);
      await flush();
    }
  }

  async function handleItem(item) {
    if (!lineSignatureOk(item?.raw, item?.signature, channelSecret)) return log({ platform: 'line', event: 'signature_bad' });
    let body;
    try { body = JSON.parse(item.raw); } catch { return log({ platform: 'line', event: 'bad_json' }); }
    for (const ev of Array.isArray(body.events) ? body.events : []) {
      handleEvent(ev).catch((e) => log({ platform: 'line', event: 'handle_error', error: String(e.message).slice(0, 80) }));
    }
  }

  (async () => {
    // 토큰 확인 겸 봇 이름(화면의 "연결됨 · 이름")
    let botName = null;
    try {
      const r = await lineApi('/v2/bot/info');
      if (r.status === 401) { log({ platform: 'line', event: 'open_error', error: 'bad_access_token' }); return; }
      if (r.ok) { const b = await r.json(); botName = b.basicId ? `${b.displayName ?? ''} (${b.basicId})`.trim() : b.displayName ?? null; }
    } catch { /* 라인 서버에 잠깐 못 닿아도 받기는 시작한다 */ }
    let attempt = 0; let announced = false;
    while (!signal?.aborted) {
      try {
        const r = await f(`${relayUrl.replace(/\/$/, '')}/pc/poll?channel=line`, {
          headers: { authorization: `Bearer ${relayToken}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(opts.pollTimeoutMs ?? 40_000)]) : AbortSignal.timeout(opts.pollTimeoutMs ?? 40_000),
        });
        if (r.status === 401) { log({ platform: 'line', event: 'open_error', error: 'relay_unauthorized' }); return; }
        if (!r.ok) throw new Error(`relay_${r.status}`);
        attempt = 0;
        if (!announced) { announced = true; log({ platform: 'line', event: 'started', bot: botName ?? '라인 연결' }); }
        const { items } = await r.json();
        for (const item of items ?? []) handleItem(item).catch(() => {});
      } catch (e) {
        if (signal?.aborted) return;
        if (e.name === 'TimeoutError') continue;
        log({ platform: 'line', event: 'network_error', error: String(e.cause?.code ?? e.message).slice(0, 60) });
        await sleep(Math.min(60_000, 2000 * 2 ** attempt++));
      }
    }
  })();
}