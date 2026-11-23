// 메신저별 연결. 모두 이 PC에서 메신저 서버로 먼저 접속하는 방식이라 공개 주소가 필요 없다.
// 텔레그램: long polling / 디스코드: Gateway WebSocket / 슬랙: Socket Mode.
// 토큰은 받은 그대로 쓰고 로그에 남기지 않는다. 로그에는 플랫폼·이벤트·오류 종류만 남긴다.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 메신저 전송 API 응답 확인(2026-11-14): 텔레그램·슬랙은 실패해도 HTTP 200에 ok:false를 돌려준다 → 성공으로 보지 않는다.
// retryable: 잠깐 실패(한도 429·서버 5xx·응답 없음)면 전달만 다시 해 볼 수 있음. 엔진은 다시 돌리지 않는다(브리지).
const SLACK_RETRY = new Set(['ratelimited', 'rate_limited', 'internal_error', 'fatal_error', 'service_unavailable', 'request_timeout']);
export function messengerOk(platform, body) {
  if (body?.ok === true) return body;
  const code = platform === 'telegram' ? body?.error_code : body?.error;
  const retryable = !body ? true : platform === 'telegram' ? (code === 429 || code >= 500) : SLACK_RETRY.has(code);
  throw Object.assign(new Error(`${platform}_${code ?? 'no_response'}`), { retryable });
}
// 원본 메시지 번호(같은 메시지가 다시 와도 같은 값) — 브리지가 요청 열쇠를 만든다
export const telegramMsgId = (msg) => `tg-${msg.chat.id}-${msg.message_id}`;
export const discordMsgId = (d) => `dc-${d.id}`;
export const slackMsgId = (ev) => `sl-${ev.channel}-${ev.client_msg_id ?? ev.ts}`;
// 슬랙 스레드: 스레드 안 글이면 그 스레드(thread_ts)로 대화방을 나눈다(같은 채널의 다른 스레드와 섞이지 않게)
export const slackThreadKey = (ev) => (ev.thread_ts ? String(ev.thread_ts) : undefined);

// 받은 메시지가 "이 봇을 부른 것"인지 메신저 정보로 판별한다(MULTI_BOTS 5절). 부르는 이름은 브리지에서 따로 본다.
// 돌려주는 값: { isGroup(1:1이 아님), called(멘션·답장·/명령@이 봇), forOther(/명령@다른 봇 — 이 봇은 무시), text(부른 표시를 뗀 글) }
export function telegramAddress(msg, username) {
  const isGroup = msg.chat?.type !== 'private';
  let text = msg.text ?? '';
  let called = false;
  let forOther = false;
  const cmd = text.match(/^(\/\w+)@(\w+)/);
  if (cmd) {
    if (username && cmd[2].toLowerCase() === username.toLowerCase()) { called = true; text = cmd[1] + text.slice(cmd[0].length); } else forOther = true;
  }
  if (username) {
    const at = new RegExp(`(^|\\s)@${username}\\b[,:]?\\s*`, 'i');
    if (at.test(text)) { called = true; text = text.replace(at, '$1').trim(); }
    if (msg.reply_to_message?.from?.username?.toLowerCase() === username.toLowerCase()) called = true;
    // 다른 봇(@…bot)을 멘션했거나 다른 봇 메시지에 답장했고 이 봇은 부르지 않았으면 그 봇 것이다.
    const otherAt = [...text.matchAll(/(?:^|\s)@(\w+bot)\b/gi)].some((x) => x[1].toLowerCase() !== username.toLowerCase());
    const otherReply = msg.reply_to_message?.from?.is_bot && msg.reply_to_message.from.username?.toLowerCase() !== username.toLowerCase();
    if (!called && (otherAt || otherReply)) forOther = true;
  }
  return { isGroup, called, forOther, text };
}

// roles: { mine: Set(이 봇의 관리 역할 ID), bots: Set(서버의 모든 봇 관리 역할 ID) } — 자동 완성으로 @봇을 고르면 역할 멘션(<@&ID>)이 들어갈 수 있다.
export function discordAddress(d, botUserId, roles = { mine: new Set(), bots: new Set() }) {
  const isGroup = Boolean(d.guild_id);
  let text = d.content ?? '';
  let called = false;
  let forOther = false;
  if (botUserId) {
    const at = new RegExp(`<@!?${botUserId}>[,:]?\\s*`, 'g');
    if (at.test(text) || (d.mentions ?? []).some((u) => u.id === botUserId)) called = true;
    text = text.replace(at, '');
    const mineRole = (d.mention_roles ?? []).filter((r) => roles.mine.has(r));
    if (mineRole.length) { called = true; for (const r of mineRole) text = text.replace(new RegExp(`<@&${r}>[,:]?\\s*`, 'g'), ''); }
    text = text.trim();
    if (d.referenced_message?.author?.id === botUserId) called = true;
    // 다른 봇(사용자 멘션·봇 역할 멘션·다른 봇 메시지 답장)을 불렀고 이 봇은 안 불렸으면 그 봇 것이다.
    const otherBot = (d.mentions ?? []).some((u) => u.bot && u.id !== botUserId)
      || (d.mention_roles ?? []).some((r) => roles.bots.has(r) && !roles.mine.has(r))
      || (d.referenced_message?.author?.bot && d.referenced_message.author.id !== botUserId);
    if (!called && otherBot) forOther = true;
  }
  return { isGroup, called, forOther, text };
}

export function slackAddress(ev, botUserId) {
  const isGroup = ev.channel_type !== 'im';
  let text = ev.text ?? '';
  let called = false;
  // 멘션된 사용자 ID(이 봇 제외). 슬랙 멘션만으로는 봇인지 사람인지 모르므로, 우리 다른 봇인지는 브리지가 판단한다.
  const mentionIds = [...text.matchAll(/<@([A-Z0-9]+)>/g)].map((x) => x[1]).filter((id) => id !== botUserId);
  if (botUserId) {
    const at = new RegExp(`<@${botUserId}>[,:]?\\s*`, 'g');
    if (at.test(text)) { called = true; text = text.replace(at, '').trim(); }
    if (ev.parent_user_id === botUserId) called = true;
  }
  // 다른 사용자·봇 멘션은 떼어 낸다. 슬랙의 /명령은 앱 슬래시 커맨드로 가로채이므로 "!명령"도 같은 뜻으로 받는다.
  text = text.replace(/<@[A-Z0-9]+>\s*/g, '').replace(/^!(\w+)/, '/$1');
  return { isGroup, called, forOther: false, text, mentionIds, parentUserId: ev.parent_user_id ?? null };
}

// 봇을 끄거나 토큰을 바꾸면 웹소켓을 닫는다. 닫지 않으면 "꺼짐"인데도 메시지를 계속 받는다(2026-11-08 허브 시험에서 발견).
function closeOnAbort(ws, signal) {
  if (!signal) return () => {};
  const close = () => ws.close();
  signal.addEventListener('abort', close, { once: true });
  return () => signal.removeEventListener('abort', close);
}

export function runTelegram({ token, onMessage, log, signal, retryMs = 5000 }) {
  const api = (method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  (async () => {
    let offset = 0;
    let conflict = false; // 409: 다른 곳에서 같은 봇을 받고 있다
    // 봇 이름(공개 정보)만 알려 준다. 메신저에서 이 이름으로 검색해 대화를 시작한다.
    const me = await api('getMe', {}).catch(() => null);
    // 2026-11-23 시험: 토큰을 텔레그램이 거절(401)해도 "시작됨"으로 보고해 마법사가 연결된 줄 알고 숫자를 띄웠음 — 라인·카카오처럼 멈추고 이유를 보고
    if (me && me.ok === false && me.error_code === 401) { log({ platform: 'telegram', event: 'open_error', error: 'unauthorized' }); return; }
    // canReadAll: 그룹 일반 글 수신(privacy mode 해제) 여부. 꺼져 있으면 부르는 이름으로 부를 수 없다.
    log({ platform: 'telegram', event: 'started', bot: me?.ok ? `@${me.result.username}` : null, open: me?.ok ? `https://t.me/${me.result.username}` : null,
      canReadAll: me?.ok ? Boolean(me.result.can_read_all_group_messages) : undefined });
    while (!signal?.aborted) {
      try {
        const r = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
        if (!r.ok) {
          if (r.error_code === 401) { log({ platform: 'telegram', event: 'open_error', error: 'unauthorized' }); return; } // 토큰이 틀리면 다시 해도 실패
          if (r.error_code === 409) conflict = true;
          log({ platform: 'telegram', event: r.error_code === 409 ? 'conflict' : 'poll_error', code: r.error_code });
          await sleep(retryMs);
          continue;
        }
        if (conflict) { conflict = false; log({ platform: 'telegram', event: 'conflict_clear' }); }
        for (const u of r.result) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.text || msg.from?.is_bot) continue;
          const threadKey = msg.is_topic_message ? msg.message_thread_id : undefined;
          const send = (text) => api('sendMessage', { chat_id: msg.chat.id, text, ...(threadKey ? { message_thread_id: threadKey } : {}) }).then((b) => messengerOk('telegram', b), (e) => { throw Object.assign(e, { retryable: true }); });
          const a = telegramAddress(msg, me?.ok ? me.result.username : null);
          onMessage({ platform: 'telegram', userId: msg.from.id, chatId: msg.chat.id, threadKey, msgId: telegramMsgId(msg), ...a }, send).catch((e) => log({ platform: 'telegram', event: 'handle_error', error: String(e.message).slice(0, 80) }));
        }
      } catch (e) {
        log({ platform: 'telegram', event: 'network_error', error: String(e.cause?.code ?? e.message).slice(0, 60) });
        await sleep(5000);
      }
    }
  })();
  // 메신저를 다시 켠 뒤에도 저장한 방에 먼저 보내기(예약 답·보관 예고)
  return { push: (addr, text) => api('sendMessage', { chat_id: addr.chatId, text, ...(addr.threadKey ? { message_thread_id: Number(addr.threadKey) } : {}) }).then((b) => messengerOk('telegram', b)) };
}

export function runDiscord({ token, onMessage, log, signal }) {
  const INTENTS = 1 | 512 | 4096 | 32768; // GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT
  const rest = (path, body) => fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST', headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.ok ? r.json() : r.text().then((t) => { throw Object.assign(new Error(`discord_${r.status}:${t.slice(0, 60)}`), { retryable: r.status === 429 || r.status >= 500 }); }),
    (e) => { throw Object.assign(e, { retryable: true }); });
  const connect = (attempt = 0) => {
    if (signal?.aborted) return;
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    const forget = closeOnAbort(ws, signal);
    let seq = null;
    let beat;
    let botUserId = null;
    const roles = { mine: new Set(), bots: new Set() };
    ws.onmessage = (e) => {
      const p = JSON.parse(e.data);
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        beat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), p.d.heartbeat_interval);
        ws.send(JSON.stringify({ op: 2, d: { token, intents: INTENTS, properties: { os: 'windows', browser: 'ieon', device: 'ieon' } } }));
      }
      if (p.op === 0 && p.t === 'READY') {
        attempt = 0;
        const appId = p.d.application?.id;
        botUserId = p.d.user?.id ?? null;
        // 초대 링크: 채널 보기(1024)·메시지 보내기(2048)·기록 읽기(65536) 권한만.
        log({ platform: 'discord', event: 'ready', bot: p.d.user?.username, guilds: p.d.guilds?.length ?? 0,
          invite: appId ? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=68608` : null });
      }
      // 서버의 봇 관리 역할(tags.bot_id)을 기억한다: 이 봇 것과 다른 봇 것.
      if (p.op === 0 && (p.t === 'GUILD_CREATE' || p.t === 'GUILD_ROLE_CREATE' || p.t === 'GUILD_ROLE_UPDATE')) {
        for (const r of p.t === 'GUILD_CREATE' ? (p.d.roles ?? []) : [p.d.role]) {
          if (!r?.tags?.bot_id) continue;
          roles.bots.add(r.id);
          if (r.tags.bot_id === botUserId) roles.mine.add(r.id);
        }
      }
      if (p.op === 0 && p.t === 'MESSAGE_CREATE') {
        const d = p.d;
        if (d.author?.bot || !d.content) return;
        const send = (text) => rest(`/channels/${d.channel_id}/messages`, { content: text });
        onMessage({ platform: 'discord', userId: d.author.id, chatId: d.channel_id, msgId: discordMsgId(d), ...discordAddress(d, botUserId, roles) }, send)
          .catch((err) => log({ platform: 'discord', event: 'handle_error', error: String(err.message).slice(0, 80) }));
      }
      if (p.op === 7 || p.op === 9) ws.close();
    };
    ws.onclose = (e) => {
      clearInterval(beat);
      forget();
      log({ platform: 'discord', event: 'closed', code: e.code });
      // 4004(토큰 오류)·4014(권한 없는 intent)는 다시 붙어도 실패하므로 멈춘다.
      if ([4004, 4013, 4014].includes(e.code)) return;
      setTimeout(() => connect(attempt + 1), Math.min(60000, 2000 * 2 ** attempt));
    };
    ws.onerror = () => {};
  };
  connect();
  return { push: (addr, text) => rest(`/channels/${addr.chatId}/messages`, { content: text }) };
}

export function runSlack({ appToken, botToken, onMessage, log, signal, recheckMs = 60000 }) {
  const web = (method, body, tokenValue) => fetch(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { authorization: `Bearer ${tokenValue}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());
  let botUserId = null;
  const connect = async (attempt = 0) => {
    if (signal?.aborted) return;
    const open = await web('apps.connections.open', {}, appToken).catch(() => ({ ok: false, error: 'network' }));
    if (!open.ok) {
      log({ platform: 'slack', event: 'open_error', error: open.error });
      if (['invalid_auth', 'not_allowed_token_type'].includes(open.error)) return;
      return setTimeout(() => connect(attempt + 1), Math.min(60000, 2000 * 2 ** attempt));
    }
    const ws = new WebSocket(open.url);
    const forget = closeOnAbort(ws, signal);
    let recheck;
    ws.onmessage = (e) => {
      const p = JSON.parse(e.data);
      if (p.envelope_id) ws.send(JSON.stringify({ envelope_id: p.envelope_id }));
      if (p.type === 'hello') {
        attempt = 0;
        // 같은 앱에 연결이 둘 이상이면 메시지가 나뉜다. 연결 수는 접속할 때만 알려 주므로, 겹친 동안에는 다시 접속해 끝났는지 확인한다.
        const overlapped = (p.num_connections ?? 1) > 1;
        log({ platform: 'slack', event: overlapped ? 'conflict' : 'conflict_clear', connections: p.num_connections ?? null });
        if (overlapped) recheck = setTimeout(() => ws.close(), recheckMs);
        web('auth.test', {}, botToken).then((a) => { botUserId = a.ok ? a.user_id : null; log({ platform: 'slack', event: 'ready', bot: a.ok ? a.user : null, team: a.ok ? a.team : null, botUserId }); });
      }
      if (p.type === 'disconnect') ws.close();
      const ev = p.payload?.event;
      if (p.type !== 'events_api' || ev?.type !== 'message' || ev.bot_id || ev.subtype || !ev.text) return;
      const send = (text) => web('chat.postMessage', { channel: ev.channel, text, ...(ev.thread_ts ? { thread_ts: ev.thread_ts } : {}) }, botToken)
        .then((b) => messengerOk('slack', b), (e) => { throw Object.assign(e, { retryable: true }); });
      onMessage({ platform: 'slack', userId: ev.user, chatId: ev.channel, threadKey: slackThreadKey(ev), msgId: slackMsgId(ev), ...slackAddress(ev, botUserId) }, send)
        .catch((err) => log({ platform: 'slack', event: 'handle_error', error: String(err.message).slice(0, 80) }));
    };
    ws.onclose = () => { clearTimeout(recheck); forget(); log({ platform: 'slack', event: 'closed' }); setTimeout(() => connect(attempt + 1), Math.min(60000, 2000 * 2 ** attempt)); };
    ws.onerror = () => {};
  };
  connect();
  return { push: (addr, text) => web('chat.postMessage', { channel: addr.chatId, text, ...(addr.threadKey ? { thread_ts: addr.threadKey } : {}) }, botToken).then((b) => messengerOk('slack', b)) };
}