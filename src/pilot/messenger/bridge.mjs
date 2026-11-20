// 메신저 공통 처리. 메신저별 연결(텔레그램·디스코드·슬랙)은 메시지를 이 모듈에 넘기고, 돌려받은 글을 보낸다.
// - 허용 목록에 없는 발신자는 /whoami 외에는 응답하지 않는다(처음 설정할 때 내 ID 확인용).
// - 대화방마다 세션 하나를 연결하거나(/use), 1:1 대화에서 /use로 대상 세션을 고른다.
// - 질문은 이어온 서버 API로만 넣는다. 결과 불명이면 다시 보내지 않고 /review로 정리한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_BOT, migrateRooms } from '../bots.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { t as tServer, makeT, errText } from '../../i18n/index.mjs';
const senderCtx = new AsyncLocalStorage(); // M3: 지금 처리 중인 메시지의 보낸 사람

const MAX_CHUNK = { telegram: 3800, discord: 1900, slack: 3800, kakao: 950, line: 4800 };

// 메시지 맨 앞의 부르는 이름을 찾는다: "리뷰, …" · "리뷰: …" · "리뷰야 …" · "@리뷰 …" · "리뷰"만. 찾으면 이름을 떼고 나머지를 돌려준다.
export function stripCallName(text, names, suffixes = tServer('messenger.call_suffixes')) {
  const t = String(text ?? '').trimStart();
  const suf = String(suffixes ?? '').split('|').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const n of [...names].map((x) => String(x).trim()).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const m = t.match(new RegExp(`^@?${esc(n)}${suf ? `(?:${suf})?` : ''}(?:[,:，]\\s*|\\s+|$)`, 'i'));
    if (m) return { called: true, text: t.slice(m[0].length).trim() };
  }
  return { called: false, text };
}

// 브리지의 중간 안내("[이름] 접수됨 — …")에서 이름 뒤 부분. 카카오·라인은 이 안내를 따로 보내지 않는다.
// 봇 언어용 t: lang은 값 또는 함수(웹에서 바꾸면 바로 반영). 없으면 서버 기본 언어
export function botT(lang) {
  const now = () => (typeof lang === 'function' ? lang() : lang) || null;
  const pick = () => (now() ? makeT(now()) : tServer);
  const t = (key, vars) => pick()(key, vars);
  t.has = (key) => pick().has(key);
  return t;
}

export const waitNotice = (tr = tServer) => tr('messenger.ask.received', { label: '\u0001' }).split('\u0001').pop().replace(/^[\])\s:：-]+/, '');

export function splitText(text, max) {
  const out = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

// opts: { api({method, path, body, headers}) → {status, body}, allowedUsers: {telegram:[], …}, roomsPath, pollMs, waitMs }
export function createBridge(opts) {
  // M3: 한 메시지를 처리하는 동안(그 안의 비동기 호출까지) 서버 요청에 보낸 사람(x-ieon-sender)을 붙인다 — 서버가 연결된 가입자의 대화만 보여 줌
  const rawApi = opts.api;
  opts = { ...opts, api: (req) => { const s = senderCtx.getStore(); return rawApi(s ? { ...req, headers: { ...(req.headers ?? {}), 'x-ieon-sender': s } } : req); } };
  // 봇 언어(I18N-b에서 봇마다 고름). 없으면 서버 기본 언어
  const t = botT(opts.lang);
  // 서버가 글과 키를 같이 보낸 이름표는 봇 언어로 다시 바꾼다(키가 없으면 글 그대로)
  const accLabel = (a) => (a.labelKey ? t(a.labelKey, a.labelVars) : a.label);
  const al = () => Object.fromEntries(['allow', 'deny', 'done', 'drop', 'stop', 'confirm'].map((k) => [k, t(`messenger.alias.${k}`)]));
  const ERR = (code, fallback = 'messenger.fail.send') => errText(t, code, { surface: 'messenger', fallback });
  const STATE = (s) => (t.has(`messenger.ns_state.${s}`) ? t(`messenger.ns_state.${s}`) : s);
  const KIND = (k, other = 'other') => t(`messenger.approval.kind.${['command', 'file', 'permissions'].includes(k) ? k : other}`);
  const pollMs = opts.pollMs ?? 2000;
  const waitMs = opts.waitMs ?? 300000;
  // 대화방 연결은 봇마다 따로다. 옛 형식(봇 구분 없음)은 처음 읽을 때 default 봇 것으로 바꿔 저장한다(MULTI_BOTS 3-4).
  // 여러 봇이 함께 쓰도록 roomStore({ rooms, save })를 넘겨받을 수 있다(키에 봇 ID가 있어 겹치지 않음).
  let roomStore = opts.roomStore;
  if (!roomStore) {
    const loaded = migrateRooms(existsSync(opts.roomsPath) ? JSON.parse(readFileSync(opts.roomsPath, 'utf8')) : {});
    const raw = existsSync(opts.roomsPath) ? JSON.parse(readFileSync(opts.roomsPath, 'utf8')) : {};
    roomStore = { rooms: loaded.data.rooms, routes: raw?._v === 2 && raw.routes ? raw.routes : {}, save: () => writeFileSync(opts.roomsPath, JSON.stringify({ _v: 2, rooms: roomStore.rooms, ...(Object.keys(roomStore.routes ?? {}).length ? { routes: roomStore.routes } : {}) }, null, 2)) };
    if (loaded.changed && existsSync(opts.roomsPath)) roomStore.save();
  }
  const rooms = roomStore.rooms;
  if (!roomStore.routes) roomStore.routes = {};
  const routes = roomStore.routes;
  const saveRooms = () => roomStore.save();
  const allowed = opts.isAllowed ?? ((m) => (opts.allowedUsers?.[m.platform] ?? []).map(String).includes(String(m.userId)));
  // W2: 승인(허용·거부)은 주인만 — 봇마다 더한 사람(extraUsers)이 아니라 공통 허용 사용자(사용자 본인)
  const isOwner = opts.isOwner ?? ((m) => (opts.allowedUsers?.[m.platform] ?? []).map(String).includes(String(m.userId)));
  // RC1: 승인 번호(n)는 서버가 대화마다 매긴다 — 메신저를 다시 켜도 /허용 n 이 같은 승인을 가리킨다(전에는 이 프로그램 메모리에만 있었음).
  const EXEC = new Set(['completed', 'failed', 'unknown']);
  // 서버가 예전 버전이라 카드에 번호가 없을 때만 쓰는 대비용 번호(대화방 → [{ n, approvalId }], 이 프로그램 메모리)
  const roomApprovals = new Map();
  const roomKey = (m) => `${m.platform}:${m.botId ?? opts.botId ?? DEFAULT_BOT}:${m.chatId}${m.threadKey ? `:${m.threadKey}` : ''}`;
  const channelKey = (m) => roomKey({ ...m, threadKey: undefined });
  // 슬랙 스레드는 자기 연결이 있으면 그것, 없으면 채널 연결을 따른다(전에는 스레드를 나누지 않아 모두 채널 연결이었음 — 그 동작 보존).
  // 텔레그램 주제(topic)는 전부터 따로였고 채널 연결을 따르지 않는다.
  const roomConv = (m) => rooms[roomKey(m)] ?? (m.platform === 'slack' && m.threadKey ? rooms[channelKey(m)] : undefined);
  const log = opts.log ?? (() => {});
  // 같은 원본 메시지는 한 번만(메신저 재전송·재접속) — 프로그램 안에서는 10분 기억, 다시 켠 뒤에는 같은 요청 열쇠로 서버가 막음
  const seen = new Map();
  const botOf = (m) => m.botId ?? opts.botId ?? DEFAULT_BOT;
  const seenBefore = (m) => {
    if (!m.msgId) return false;
    const k = `${m.platform}:${botOf(m)}:${m.msgId}`;
    for (const [x, at] of seen) if (Date.now() - at > 10 * 60_000) seen.delete(x);
    if (seen.has(k)) return true;
    seen.set(k, Date.now()); return false;
  };
  const idemKey = (m) => (m.msgId ? 'msg-' + createHash('sha256').update(`${m.platform}:${botOf(m)}:${m.msgId}`).digest('hex').slice(0, 40) : `msg-${randomUUID()}`);
  // 엔진 실행 완료와 답 전달 완료를 나눈다: 대화방 → { requestId, label, delivered }
  const lastAnswer = new Map();
  const retryMs = opts.deliverRetryMs ?? 2000;
  // 안내 글은 못 보내도 처리를 멈추지 않는다(기록만, 내용 없이)
  const safeSend = async (m, send, text) => { try { await send(text); return true; } catch (e) { log({ platform: m.platform, event: 'send_failed', error: String(e.message).slice(0, 40) }); return false; } };
  // 답 전달: 잠깐 실패(retryable)는 두 번 더 해 보고, 끝내 실패하면 기록하고 /last로 다시 받게 한다. 엔진은 다시 돌리지 않는다.
  async function deliver(m, send, conv, requestId, answer) {
    const parts = splitText(answer ?? t('messenger.no_answer_kept'), MAX_CHUNK[m.platform] ?? 1900);
    for (const part of parts) {
      for (let attempt = 0; ; attempt++) {
        try { await send(part); break; } catch (e) {
          if (e.retryable && attempt < 2) { await new Promise((ok) => setTimeout(ok, retryMs * (attempt + 1))); continue; }
          lastAnswer.set(roomKey(m), { requestId, label: conv.label, delivered: false });
          log({ platform: m.platform, event: 'deliver_failed', requestId, error: String(e.message).slice(0, 40) });
          await safeSend(m, send, t('messenger.deliver_failed', { label: conv.label, error: String(e.message).slice(0, 30) }));
          return false;
        }
      }
    }
    lastAnswer.set(roomKey(m), { requestId, label: conv.label, delivered: true });
    return true;
  }

  async function sessions() {
    const r = await opts.api({ method: 'GET', path: '/v1/conversations' });
    return r.status === 200 ? r.body.conversations : [];
  }
  const lastSend = new Map(); // 대화방 → 마지막으로 쓴 send(보관 예고를 그 방에 보내기 위해)
  // 이번에 받은 메시지의 send가 없으면(메신저를 다시 켬) 저장한 보낼 곳으로 먼저 보낸다 — 메신저가 지원할 때만(카카오는 받은 메시지에만 답할 수 있음)
  const senderFor = (k) => lastSend.get(k) ?? (routes[k] && opts.push && (opts.canPush?.() ?? true) && !k.startsWith('kakao:') ? (t) => opts.push(routes[k], t) : null);
  let noticeAfter = new Date().toISOString();
  const byName = (all, name) => all.find((c) => c.newSession?.name === name);
  const nsFail = (r) => errText(t, r.body?.error, { ns: true, fallback: 'messenger.fail.ns' });
  const describe = (c, i) => {
    const engine = c.engine === 'claude_channel' ? 'Claude' : c.engine === 'claude_cli' ? 'Claude(CLI)' : c.engine === 'agy_cli' ? 'Antigravity' : c.engine === 'grok_cli' ? 'Grok' : `Codex(${t(c.connectMode === 'shared_server' ? 'messenger.engine.mode.shared_server' : 'messenger.engine.mode.alternate')})`;
    const ns = c.newSession ? t('messenger.describe.new_session', { state: STATE(c.newSession.state) }) : '';
    const state = t(!c.deviceOnline ? 'messenger.state.offline' : c.heldBy ? 'messenger.state.held' : c.engineReady === false ? 'messenger.state.engine_off' : c.busy ? 'messenger.state.busy' : 'messenger.state.ready');
    // 어느 PC·작업 모드인지도 보이게(허브는 PC 이름을 알려 줌)
    const where = `${c.host?.name ? t('messenger.describe.pc', { name: c.host.name }) : ''}${c.workMode ? t('messenger.describe.work_mode') : ''}`;
    // WS1-a: 작업 공간 한 줄(폴더 이름만, 전체 경로는 웹에서만)
    const ws = c.workspace ? [c.workspace.personal && t('messenger.ws.personal', { name: c.workspace.personal }), ...(c.workspace.shared ?? []).map((s) => t('messenger.ws.shared', { name: s.name, access: t(s.write ? 'messenger.ws.write' : 'messenger.ws.read') }))].filter(Boolean).join(', ') : '';
    return `${i + 1}. ${c.label} — ${engine} · ${state}${where}${ns}${c.account?.label ? t('messenger.describe.account', { label: accLabel(c.account) }) : ''}${ws ? t('messenger.describe.workspace', { ws }) : ''}`;
  };

  async function ask(m, conv, question, send) {
    const r = await opts.api({
      method: 'POST', path: `/v1/conversations/${conv.conversationId}/requests`,
      headers: { 'idempotency-key': idemKey(m) }, body: { question },
    });
    if (r.status !== 202) return safeSend(m, send, `[${conv.label}] ${ERR(r.body?.error)}`);
    lastAnswer.set(roomKey(m), { requestId: r.body.requestId, label: conv.label, delivered: null, askedBy: String(m.userId) });
    // RC3: 작업 열기 링크(서버가 공개 웹 주소를 알 때만 — 열면 로그인·권한을 먼저 확인)
    await safeSend(m, send, t('messenger.ask.received', { label: conv.label }) + (conv.workMode ? t('messenger.ask.work_mode') : '') + (r.body.taskUrl ? t('messenger.ask.task_url', { url: r.body.taskUrl }) : ''));
    const started = Date.now();
    const announced = new Set();
    const told = new Set(); // 실행 결과를 알린 승인(RC1)
    // 작업 모드는 승인을 기다리는 동안(최대 15분) 더 오래 기다린다
    const limit = conv.workMode ? Math.max(waitMs, 20 * 60_000) : waitMs;
    while (Date.now() - started < limit) {
      await new Promise((ok) => setTimeout(ok, pollMs));
      const s = (await opts.api({ method: 'GET', path: `/v1/requests/${r.body.requestId}` })).body;
      // W2: 처리 중 승인 요청이 오면 이 대화방에 알리고 /허용 n · /거부 n 으로 받는다(이번 한 번만, 주인만)
      // RC1: 허용한 뒤의 실제 실행 결과(완료·실패·결과 불명)도 같은 대화방에 한 번 알린다. 차례가 끝난 직후에도 한 번 더 본다.
      if (conv.workMode && (['running', 'dispatching'].includes(s.status) || announced.size > told.size)) {
        const cards = (await opts.api({ method: 'GET', path: `/v1/conversations/${conv.conversationId}/cards` }).catch(() => null))?.body?.cards ?? [];
        for (const k of cards.filter((x) => x.kind === 'approval' && !announced.has(x.approvalId))) {
          announced.add(k.approvalId);
          const what = KIND(k.approvalKind);
          let n = k.n;
          if (!Number.isInteger(n)) { const list = roomApprovals.get(roomKey(m)) ?? []; n = (list.at(-1)?.n ?? 0) + 1; list.push({ n, approvalId: k.approvalId }); roomApprovals.set(roomKey(m), list.slice(-20)); }
          await safeSend(m, send, t('messenger.approval.request', { label: conv.label, n, what, summary: k.summary, cwd: k.cwd ? t('messenger.approval.cwd', { cwd: k.cwd }) : '', allow: al().allow, deny: al().deny }));
        }
        // RC5: 사람에게 넘긴 일 — AI에게는 하지 말라고 전했고, 직접 처리했으면 /처리 n, 안 할 거면 /중단 n
        for (const k of cards.filter((x) => x.kind === 'handoff' && !announced.has(x.approvalId))) {
          announced.add(k.approvalId); told.add(k.approvalId);
          const what = KIND(k.approvalKind, 'other_handoff');
          await safeSend(m, send, t('messenger.approval.handoff', { label: conv.label, n: k.n, what, summary: k.summary, cwd: k.cwd ? t('messenger.approval.cwd', { cwd: k.cwd }) : '', done: al().done, drop: al().drop }));
        }
        for (const k of cards.filter((x) => x.kind === 'approval_result' && x.requestId === r.body.requestId && EXEC.has(x.state) && !told.has(x.approvalId))) {
          told.add(k.approvalId);
          await safeSend(m, send, t('messenger.approval.result', { label: conv.label, n: k.n, word: t(`messenger.exec.${k.state}`), exit: k.state === 'failed' && Number.isInteger(k.exitCode) ? t('messenger.exec.exit_code', { code: k.exitCode }) : '' }));
        }
      }
      if (s.status === 'completed') return deliver(m, send, conv, r.body.requestId, s.answer);
      // A1: 한도는 어느 계정인지와 고를 수 있는 길을 함께(실행 안 됨이 확실 — 잠그지 않음, 자동으로 다시 보내지 않음).
      if (s.status === 'failed' && s.errorCode === 'usage_limit') {
        return safeSend(m, send, t('messenger.ask.usage_limit', { label: conv.label, err: ERR('usage_limit'), account: conv.account?.label ? accLabel(conv.account) : t('messenger.unknown') }));
      }
      if (s.status === 'failed') return safeSend(m, send, t('messenger.ask.failed', { label: conv.label, err: ERR(s.errorCode, 'messenger.fail.run') }));
      if (s.status === 'unknown') {
        return safeSend(m, send, t('messenger.ask.unknown', { label: conv.label, joined: s.errorCode === 'turn_joined_by_other_input' ? t('messenger.ask.unknown_joined') : '' }));
      }
      if (s.status === 'approval_required') return safeSend(m, send, t('messenger.ask.approval_required', { label: conv.label }));
      // RC2: 사람이 이 질문만 멈춤(엔진 차례가 끝난 것까지 확인됨)
      if (s.status === 'cancelled') return safeSend(m, send, t('messenger.ask.cancelled', { label: conv.label }));
    }
    return safeSend(m, send, t('messenger.ask.timeout', { label: conv.label }));
  }

  // 그 대화방에서 다른 우리 봇이 세션에 연결돼 있는지(키 "<메신저>:<봇>:<대화방>[:<주제>]"의 대화방 부분이 같은 것).
  const otherBotConnected = (m) => {
    const [platform, bot, ...rest] = roomKey(m).split(':');
    const suffix = rest.join(':');
    return Object.keys(rooms).some((k) => { const [p, b, ...r] = k.split(':'); return p === platform && b !== bot && r.join(':') === suffix; });
  };
  const info = () => opts.botInfo?.() ?? {};

  // m: { platform, botId?, userId, chatId, threadKey?, text, isGroup?, called?, forOther? }, send(text) → Promise
  function handle(m, send) { return m?.userId !== undefined && m?.userId !== null ? senderCtx.run(String(m.userId), () => handleIn(m, send)) : handleIn(m, send); }
  async function handleIn(m, send) {
    if (m.forOther) return; // /명령@다른 봇
    if (seenBefore(m)) return log({ platform: m.platform, event: 'duplicate' }); // 같은 원본 메시지가 다시 옴
    const bot = info();
    // 부르는 이름이 없으면 봇 ID로 부를 수 있다.
    const call = stripCallName(m.text, bot.callNames?.length ? bot.callNames : [m.botId ?? opts.botId ?? DEFAULT_BOT], t('messenger.call_suffixes'));
    let text = (call.called ? call.text : String(m.text ?? '')).trim();
    // 슬랙은 /명령을 앱이 가로채므로 !명령을 쓴다. 부르는 이름을 뗀 뒤에도 같은 뜻으로 바꾼다.
    if (m.platform === 'slack') text = text.replace(/^!(\w+)/, '/$1');
    if (!text) return;
    // 같은 메신저의 다른 우리 봇을 멘션했거나 그 봇 스레드에 답장했고 이 봇은 안 불렸으면 그 봇 것이다(슬랙).
    const others = new Set(bot.otherBotUserIds ?? []);
    if (m.isGroup && !m.called && !call.called
      && ((m.mentionIds ?? []).some((id) => others.has(id)) || (m.parentUserId && others.has(m.parentUserId)))) return;
    // 같은 메신저의 다른 우리 봇 부르는 이름으로 시작하면 그 봇 것이다(이 봇 이름이 아닐 때).
    if (m.isGroup && !m.called && !call.called && stripCallName(m.text, bot.otherCallNames ?? [], t('messenger.call_suffixes')).called) return;
    // 그룹·채널에서는 부른 봇만 답한다. 부르지 않았어도 그 방에 연결된 우리 봇이 이 봇뿐(또는 아무도 없음)이면 받는다.
    if (m.isGroup && !m.called && !call.called && otherBotConnected(m)) return;
    if (/^\/whoami\b/.test(text)) {
      return send(t('messenger.whoami', { platform: m.platform, botId: m.botId ?? opts.botId ?? DEFAULT_BOT, name: bot.name ? t('messenger.whoami.name', { name: bot.name }) : '',
        role: bot.role ? t('messenger.whoami.role', { role: bot.role.name }) : '', callNames: bot.callNames?.length ? t('messenger.whoami.call_names', { names: bot.callNames.join(', ') }) : '',
        userId: m.userId, room: roomKey(m), allowed: t(allowed(m) ? 'messenger.whoami.allowed' : 'messenger.whoami.not_allowed') }));
    }
    if (!allowed(m)) return; // 허용되지 않은 발신자에게는 아무것도 하지 않는다.
    lastSend.set(roomKey(m), send);
    { const k = roomKey(m); const addr = { chatId: String(m.chatId), ...(m.threadKey ? { threadKey: String(m.threadKey) } : {}) };
      if (JSON.stringify(routes[k]) !== JSON.stringify(addr)) { routes[k] = addr; saveRooms(); } }
    const all = await sessions();
    // 보관된 새 세션은 목록·번호에서 빼고 /archived로 따로 본다.
    const list = all.filter((c) => c.newSession?.state !== 'archived');
    let current = list.find((c) => c.conversationId === roomConv(m));
    // 역할의 기본 세션: 연결이 없는 대화방이면 /use 없이 그 세션에 연결한다(이 봇이 볼 수 있는 세션일 때만).
    if (!current && bot.role?.defaultSession && !/^\/(help|start|sessions|use|new)\b/.test(text)) {
      const d = list.find((c) => c.conversationId === bot.role.defaultSession);
      if (d) {
        rooms[roomKey(m)] = d.conversationId;
        saveRooms();
        current = d;
        await send(t('messenger.default_session', { label: d.label, role: bot.role.name }));
      }
    }

    if (/^\/(help|start)\b/.test(text)) {
      const head = bot.name ? `${bot.name}${bot.role ? ` · ${bot.role.name}${bot.role.description ? ` — ${bot.role.description}` : ''}` : ''}${bot.callNames?.length ? t('messenger.help.call', { name: bot.callNames[0] }) : ''}\n\n` : '';
      return send(head + t('messenger.help.body', al()));
    }
    const create = text.match(/^\/new\s+(codex|claude|antigravity)\s+(\S+)(?:\s+(\S+))?\s*$/);
    if (create) {
      const r = await opts.api({ method: 'POST', path: '/v1/sessions', body: { engine: create[1], name: create[2], ...(create[3] ? { profile: create[3] } : {}) } });
      if (r.status !== 201) return send(t('messenger.new.failed', { err: nsFail(r), allowed: r.body?.allowed ? t('messenger.new.allowed', { list: r.body.allowed.join(', ') }) : '' }));
      rooms[roomKey(m)] = r.body.conversationId;
      saveRooms();
      return send(t('messenger.new.created', { engine: create[1] === 'codex' ? 'Codex' : 'Claude', name: r.body.name, profile: r.body.profile }));
    }
    if (/^\/new\b/.test(text)) return send(t('messenger.new.usage'));
    if (/^\/limits\b/.test(text)) {
      const r = await opts.api({ method: 'GET', path: '/v1/sessions/limits' });
      if (r.status !== 200) return send(nsFail(r));
      const l = r.body;
      return send(t('messenger.limits', { sessions: l.sessions, maxSessions: l.maxSessions, codex: l.perEngine.codex, maxCodex: l.maxPerEngine.codex, claude: l.perEngine.claude, maxClaude: l.maxPerEngine.claude, agy: l.perEngine.antigravity ?? 0, maxAgy: l.maxPerEngine.antigravity ?? 0, maxActive: l.maxActive }));
    }
    if (/^\/archived\b/.test(text)) {
      const arch = all.filter((c) => c.newSession?.state === 'archived');
      return send(arch.length ? t('messenger.archived.list', { list: arch.map((c) => `- ${c.newSession.name}`).join('\n') }) : t('messenger.archived.none'));
    }
    const act = text.match(/^\/(sleep|restore)\s+(\S+)\s*$/);
    if (act) {
      const c = byName(all, act[2]);
      if (!c) return send(t('messenger.ns.not_found', { name: act[2] }));
      const r = await opts.api({ method: 'POST', path: `/v1/sessions/${c.conversationId}/${act[1]}` });
      return send(r.status === 200 ? t(act[1] === 'sleep' ? 'messenger.ns.slept' : 'messenger.ns.restored', { name: act[2] }) : nsFail(r));
    }
    const close = text.match(new RegExp(`^/close\\s+(\\S+)(\\s+(?:${[al().confirm, 'confirm'].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))?\\s*$`, 'i'));
    if (close) {
      const c = byName(all, close[1]);
      if (!c) return send(t('messenger.ns.not_found', { name: close[1] }));
      if (!close[2]) return send(t('messenger.close.confirm', { name: close[1], confirm: al().confirm }));
      const r = await opts.api({ method: 'DELETE', path: `/v1/sessions/${c.conversationId}`, body: { confirm: close[1] } });
      if (r.status !== 200) return send(nsFail(r));
      for (const [k, v] of Object.entries(rooms)) if (v === c.conversationId) delete rooms[k];
      saveRooms();
      return send(t('messenger.close.done', { name: close[1], ws: r.body.workspaceRemoved ? t('messenger.close.ws_removed') : '' }));
    }
    // W2: 승인 답(/허용 n, /거부 n — 영문 /allow n, /deny n). 주인만, 이 대화방에 알린 번호만.
    // RC5: /처리 n · /중단 n(영문 /done n · /drop n) — 사람에게 넘긴 일의 처리 기록
    const ALIAS = { allow: [al().allow, 'allow'], deny: [al().deny, 'deny'], done: [al().done, 'done'], drop: [al().drop, 'drop'] };
    const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dec = text.match(new RegExp(`^/(${Object.values(ALIAS).flat().map(reEsc).join('|')})\\s+(\\d+)\\s*$`, 'i'));
    if (dec) {
      if (!isOwner(m)) return send(t('messenger.decide.owner_only'));
      // RC1: 이 대화방에 연결된 대화의 승인 번호로 찾는다(서버가 매긴 번호 — 메신저를 다시 켜도 같다)
      const convId = roomConv(m);
      const found = convId ? ((await opts.api({ method: 'GET', path: `/v1/conversations/${convId}/approvals` })).body?.approvals ?? []).find((x) => x.n === Number(dec[2])) : null;
      const item = found ? { n: found.n, approvalId: found.approvalId } : (roomApprovals.get(roomKey(m)) ?? []).find((x) => x.n === Number(dec[2])) ?? null;
      if (!item) return send(t('messenger.decide.not_found', { n: dec[2] }));
      const decision = Object.keys(ALIAS).find((k) => ALIAS[k].some((w) => w.toLowerCase() === dec[1].toLowerCase())) ?? 'drop';
      const r = await opts.api({ method: 'POST', path: `/v1/approvals/${item.approvalId}`, body: { decision } });
      if (r.status === 200) return send(t('messenger.decide.ok', { what: t(['done', 'drop'].includes(decision) ? 'messenger.decide.what.handoff' : 'messenger.decide.what.approval'), n: item.n, result: t(`messenger.decide.result.${decision}`) }));
      return send(r.body?.error === 'approval_closed' ? t('messenger.decide.closed', { n: item.n, status: t.has(`messenger.decide.status.${r.body.status}`) ? t(`messenger.decide.status.${r.body.status}`, al()) : r.body.status }) : t('messenger.decide.failed', { error: r.body?.error }));
    }
    // RC2: 이 대화방의 마지막 질문만 멈추기(/stop · /중지). 물어본 사람이나 주인만. 다른 대화방·다른 질문은 그대로.
    if (new RegExp(`^/(stop|${al().stop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(\\s|$)`, 'i').test(text)) {
      const la = lastAnswer.get(roomKey(m));
      if (!la) return send(t('messenger.stop.none'));
      if (la.askedBy !== String(m.userId) && !isOwner(m)) return send(t('messenger.stop.not_allowed'));
      const r = await opts.api({ method: 'POST', path: `/v1/requests/${la.requestId}/stop` });
      if (r.status === 200) return send(t('messenger.stop.cancelled', { label: la.label }));
      if (r.status === 202) return send(t('messenger.stop.stopping', { label: la.label }));
      if (r.body?.error === 'stop_unsupported') return send(t('messenger.stop.unsupported', { label: la.label }));
      const word = t.has(`messenger.stop.status.${r.body?.status}`) ? t(`messenger.stop.status.${r.body?.status}`) : null;
      return send(t('messenger.stop.failed', { label: la.label, word: word ?? r.body?.error ?? t('messenger.unknown') }));
    }
    // 마지막 답 다시 받기 — 요청을 다시 읽어 전달만(엔진을 다시 돌리지 않음)
    if (/^\/last\b/.test(text)) {
      const la = lastAnswer.get(roomKey(m));
      if (!la) return send(t('messenger.last.none'));
      const s = (await opts.api({ method: 'GET', path: `/v1/requests/${la.requestId}` })).body ?? {};
      if (s.status === 'completed') return deliver(m, send, { label: la.label }, la.requestId, s.answer);
      const word = t.has(`messenger.req.status.${s.status}`) ? t(`messenger.req.status.${s.status}`) : null;
      return send(t('messenger.last.pending', { label: la.label, word: word ?? s.status ?? t('messenger.unknown') }));
    }
    if (/^\/sessions\b/.test(text)) return send(list.length ? list.map(describe).join('\n') : t('messenger.sessions.none'));
    const use = text.match(/^\/use\s+(\d+)\s*$/);
    if (use) {
      const c = list[Number(use[1]) - 1];
      if (!c) return send(t('messenger.use.not_found'));
      rooms[roomKey(m)] = c.conversationId;
      saveRooms();
      return send(t('messenger.use.done', { label: c.label }));
    }
    if (!current) return send(t('messenger.no_session'));
    if (/^\/status\b/.test(text)) {
      const la = lastAnswer.get(roomKey(m));
      // RC4: 이 대화를 막고 있는 확인 필요 질문이 있으면 그때 보낸 세션과 지금 세션이 같은지 한 줄
      let rs = '';
      if (current.heldBy?.requestId) {
        const r = (await opts.api({ method: 'GET', path: `/v1/tasks/${current.heldBy.requestId}` }).catch(() => null))?.body?.resume;
        if (r?.known) rs = t(r.sameSession ? 'messenger.status.same_session' : 'messenger.status.other_session');
      }
      return send(describe(current, list.indexOf(current)) + (la?.delivered === false ? t('messenger.status.deliver_failed') : '') + rs);
    }
    const review = text.match(/^\/review\s+(done|not)\s*$/);
    if (review) {
      if (!current.heldBy) return send(t('messenger.review.none', { label: current.label }));
      const r = await opts.api({ method: 'POST', path: `/v1/requests/${current.heldBy.requestId}/review`, body: { executed: review[1] === 'done' } });
      return send(r.status === 200
        ? t(review[1] === 'done' ? 'messenger.review.done' : 'messenger.review.not', { label: current.label })
        : t('messenger.review.failed', { label: current.label, error: r.body?.error }));
    }
    if (text.startsWith('/')) return send(t('messenger.unknown_command'));
    return ask(m, current, text, send);
  }

  // 보관 예고를 그 세션에 연결된 대화방으로 보낸다. 대화방의 send는 그 방에서 마지막으로 받은 메시지 것을 쓴다
  // (메신저 봇을 다시 켠 뒤 그 방에서 아직 아무 말도 없으면 보낼 수 없어 건너뛴다).
  async function deliverNotices() {
    const r = await opts.api({ method: 'GET', path: `/v1/sessions/notices?after=${encodeURIComponent(noticeAfter)}` });
    if (r.status !== 200) return 0;
    let sent = 0;
    for (const n of r.body.notices) {
      noticeAfter = n.at > noticeAfter ? n.at : noticeAfter;
      for (const [k, v] of Object.entries(rooms)) {
        const send = v === n.conversationId && senderFor(k);
        if (send) { await send(t('messenger.notice.archive', { name: n.name, date: n.archiveAt.slice(0, 10) })); sent += 1; }
      }
    }
    return sent;
  }

  // W3: 끝난 예약 질문의 답을 그 대화에 연결된 방에 올린다(그 방에서 받은 적이 있어 보낼 길이 있을 때만). 자동으로 다시 실행하지 않음.
  let schedAfter = new Date().toISOString();
  async function deliverScheduled() {
    const r = await opts.api({ method: 'GET', path: `/v1/schedules/notices?after=${encodeURIComponent(schedAfter)}` }).catch(() => null);
    if (r?.status !== 200) return 0;
    let sent = 0;
    for (const n of r.body.notices) {
      if (!(n.at > schedAfter)) continue; // 이미 올린 것(서버도 after로 거르지만 한 번 더)
      schedAfter = n.at;
      const when = n.whenKey === 'server.sched.once' && n.whenAt ? t(n.whenKey, { at: new Date(n.whenAt).toLocaleString(t('common.intl_locale'), { timeZone: n.whenTz || undefined }) }) : n.whenKey ? t(n.whenKey, n.whenVars) : n.when;
      const head = t('messenger.sched.head', { label: n.label, when });
      const text = n.status === 'completed' ? t('messenger.sched.completed', { head, answer: n.answer ?? t('messenger.no_answer_kept') })
        : ['unknown', 'cancelled', 'approval_required'].includes(n.status) ? t(`messenger.sched.${n.status}`, { head })
        : t('messenger.sched.failed', { head, err: ERR(n.errorCode, 'messenger.fail.run') });
      for (const [k, v] of Object.entries(rooms)) {
        const send = v === n.conversationId && senderFor(k);
        if (!send) continue;
        for (const part of splitText(text, MAX_CHUNK[k.split(':')[0]] ?? 1900)) await send(part).catch(() => {});
        sent += 1;
      }
    }
    return sent;
  }

  return { handle, roomKey, deliverNotices, deliverScheduled, allowed };
}

// 이어온 서버 API 호출기. 토큰은 파일에서 읽고 출력하지 않는다.
// botHeader("<메신저>:<봇ID>")를 주면 요청마다 x-ieon-bot을 붙여 서버가 그 봇으로 처리하게 한다(여러 봇 M1).
export function serverApi(baseUrl, tokenFile, botHeader) {
  const token = readFileSync(tokenFile, 'utf8').trim();
  return async ({ method, path, body, headers = {} }) => {
    const r = await fetch(baseUrl + path, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(botHeader ? { 'x-ieon-bot': botHeader } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  };
}