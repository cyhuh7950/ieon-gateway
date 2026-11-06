// 카카오톡 연결(MULTI_BOTS M6-a). 공개 수신 중계(src/relay)에서 PC가 먼저 접속해 질문을 가져오고,
// 답은 질문에 딸려 온 AI 챗봇 콜백 주소로 보낸다. 중계 토큰은 받은 그대로 쓰고 로그에 남기지 않는다.
// - 콜백은 1회용이고 유효 시간이 짧다(약 1분으로 알려져 있음, 실측 전). 그래서 브리지가 보내는 글을 모아 한 번에 보낸다.
// - 제한 시간(callbackLimitMs) 안에 답이 안 끝나면 "오래 걸린다"는 안내로 콜백을 쓰고, 뒤늦은 답은 보관했다가 /last로 보낸다.
import { callbackAllowed } from '../../relay/relay.mjs';
import { splitText } from './bridge.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_NOTICE = '접수됨 — 답을 기다리는 중'; // 브리지의 중간 안내. 스킬 응답이 이미 "접수"를 알렸으므로 콜백에는 넣지 않는다.
const SLOW = '답이 오래 걸리고 있습니다. 끝나면 /last 를 보내 받아 보세요.';
const BUSY = '아직 답을 만드는 중입니다. 잠시 뒤 /last 를 다시 보내 주세요.';
const BUBBLE = 1000; // simpleText 한 칸 글자 수 한도
const MAX_OUTPUTS = 3; // 응답 하나의 말풍선 수 한도

// 글을 카카오 응답(simpleText ≤1000자, 최대 3개)으로 만든다. 넘치면 마지막 칸에서 줄이고 알린다.
export function kakaoBody(text) {
  let parts = splitText(String(text), BUBBLE);
  if (parts.length > MAX_OUTPUTS) {
    parts = parts.slice(0, MAX_OUTPUTS);
    const tail = '\n…(길어서 줄임 — 전체는 웹 화면에서 확인)';
    parts[MAX_OUTPUTS - 1] = parts[MAX_OUTPUTS - 1].slice(0, BUBBLE - tail.length) + tail;
  }
  return { version: '2.0', template: { outputs: parts.map((t) => ({ simpleText: { text: t } })) } };
}

// opts: { relayUrl, token, onMessage, log, signal, postCallback?(url, body), callbackLimitMs?, pollTimeoutMs?, lateTtlMs? }
export function runKakao(opts) {
  const { relayUrl, token, onMessage, log, signal } = opts;
  const limit = opts.callbackLimitMs ?? 55_000;
  const lateTtl = opts.lateTtlMs ?? 10 * 60_000;
  const post = opts.postCallback ?? (async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return r.ok;
  });
  const busy = new Map(); // 사용자 키 → 아직 답을 만드는 중인 질문 수(/last를 "없음"과 구분하려고)
  const late = new Map(); // 사용자 키 → [{ text, at }] 콜백으로 못 보낸 답(메모리에만, 짧게)
  const stash = (user, text) => {
    const list = (late.get(user) ?? []).filter((x) => Date.now() - x.at < lateTtl);
    list.push({ text, at: Date.now() });
    late.set(user, list.slice(-5));
  };
  const take = (user) => {
    const list = (late.get(user) ?? []).filter((x) => Date.now() - x.at < lateTtl);
    late.delete(user);
    return list.map((x) => x.text).join('\n\n');
  };

  async function handleItem(item) {
    if (!item?.userKey || typeof item.text !== 'string' || !callbackAllowed(item.callbackUrl, opts.callbackHosts ?? ['bot-api.kakao.com'])) {
      return log({ platform: 'kakao', event: 'item_rejected' });
    }
    const user = item.userKey;
    const buf = [];
    let spent = false;
    let timer;
    const flush = async (slow) => {
      if (spent) return;
      spent = true;
      clearTimeout(timer);
      const text = [...buf, ...(slow ? [SLOW] : [])].join('\n\n') || '(답이 없습니다)';
      const ok = await post(item.callbackUrl, kakaoBody(text)).catch(() => false);
      if (!ok) { log({ platform: 'kakao', event: 'callback_failed' }); if (!slow) stash(user, text); }
    };
    const send = async (t) => {
      if (String(t).endsWith(WAIT_NOTICE)) return;
      if (spent) stash(user, String(t)); else buf.push(String(t));
    };
    if (item.text.trim() === '/last') {
      buf.push(take(user) || (busy.get(user) ? BUSY : '보관된 답이 없습니다.'));
      return flush(false);
    }
    timer = setTimeout(() => flush(true), limit);
    busy.set(user, (busy.get(user) ?? 0) + 1);
    try {
      await onMessage({ platform: 'kakao', userId: user, chatId: user, isGroup: false, called: true, text: item.text }, send);
    } catch (e) {
      log({ platform: 'kakao', event: 'handle_error', error: String(e.message).slice(0, 80) });
      buf.push('처리 중 오류가 났습니다.');
    } finally {
      busy.set(user, busy.get(user) - 1);
      if (!busy.get(user)) busy.delete(user);
    }
    await flush(false);
  }

  (async () => {
    let attempt = 0;
    let announced = false;
    while (!signal?.aborted) {
      try {
        const r = await fetch(`${relayUrl.replace(/\/$/, '')}/pc/poll`, {
          headers: { authorization: `Bearer ${token}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(opts.pollTimeoutMs ?? 40_000)]) : AbortSignal.timeout(opts.pollTimeoutMs ?? 40_000),
        });
        if (r.status === 401) { log({ platform: 'kakao', event: 'open_error', error: 'unauthorized' }); return; } // 토큰이 틀리면 다시 붙어도 실패하므로 멈춘다.
        if (!r.ok) throw new Error(`relay_${r.status}`);
        attempt = 0;
        if (!announced) { announced = true; log({ platform: 'kakao', event: 'started', bot: '카카오 중계 연결' }); }
        const { items } = await r.json();
        for (const item of items ?? []) handleItem(item).catch((e) => log({ platform: 'kakao', event: 'handle_error', error: String(e.message).slice(0, 80) }));
      } catch (e) {
        if (signal?.aborted) return;
        if (e.name === 'TimeoutError') continue; // 대기 시간 초과는 정상 — 바로 다시 접속
        log({ platform: 'kakao', event: 'network_error', error: String(e.cause?.code ?? e.message).slice(0, 60) });
        await sleep(Math.min(60_000, 2000 * 2 ** attempt++));
      }
    }
  })();
}
