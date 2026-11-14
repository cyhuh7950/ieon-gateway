// 여러 봇 실행기(MULTI_BOTS M1). 웹에 정의된 봇과 .env의 규칙 이름 토큰으로 봇마다 메신저 연결을 띄운다.
// - 봇마다 공통 대화방 연결 파일을 함께 쓰고(키에 봇 ID), 서버에는 메신저 토큰 + x-ieon-bot으로 그 봇으로 접속한다.
// - 허용 사용자: 공통(웹 설정, 없으면 config allowedUsers) + 봇별 추가(웹). 카카오 설정도 웹 값이 있으면 그 값(P1).
// - sync()를 주기적으로 부르면 봇 추가·끄기·이름·허용 사용자 변경이 반영된다. 토큰이 바뀌면 메신저를 다시 켠다.
// - 상태(토큰 있음·없음·중복·연결됨·실제 봇 이름)만 서버에 보고한다. 토큰 값은 보고·기록하지 않는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createBridge } from './bridge.mjs';
import { DEFAULT_BOT, migrateRooms, resolveBotTokens } from '../bots.mjs';
const RELAY_OFF = new Set(['kakaoRelayUrl_missing', 'relay_missing']);

// 서버가 아직 봇 정의 API를 모르면(이전 버전) 메신저마다 default 봇만 쓴다.
const LEGACY = ['telegram', 'discord', 'slack'].map((platform) => ({ platform, botId: DEFAULT_BOT, name: '기본 봇', callNames: [], extraUsers: [], enabled: true }));

export function loadRoomStore(path) {
  const loaded = migrateRooms(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  const store = { rooms: loaded.data.rooms, save: () => writeFileSync(path, JSON.stringify({ _v: 2, rooms: store.rooms }, null, 2)) };
  if (loaded.changed && existsSync(path)) store.save();
  return store;
}

// opts: { api(req)(메신저 토큰, 봇 헤더 없음), apiFor(platform, botId) → api, env, allowedUsers, roomsPath, runners: {telegram, discord, slack}, log, bridgeOpts }
export function createBotRunner(opts) {
  const roomStore = loadRoomStore(opts.roomsPath);
  const running = new Map(); // "<메신저>:<봇ID>" → { def, controller, bridge, state, username, canReadAll }
  let peers = []; // 마지막으로 받은 봇 정의 전체(다른 봇의 부르는 이름 확인용)
  let serverCfg = { allowedUsers: null, kakao: null }; // 웹에서 바꾼 메신저 설정(P1). null이면 파일 값
  const commonUsers = (platform) => (serverCfg.allowedUsers ?? opts.allowedUsers ?? {})[platform] ?? [];
  const settings = () => ({ kakao: serverCfg.kakao });

  // 웹 설정을 받는다. 서버가 이 API를 모르면(이전 버전) 파일 값만 쓴다.
  async function loadServerConfig() {
    try {
      const r = await opts.api({ method: 'GET', path: '/v1/messenger/config' });
      if (r.status === 200) return { allowedUsers: r.body.allowedUsers ?? null, kakao: r.body.kakao ?? null };
    } catch { return serverCfg; }
    return { allowedUsers: null, kakao: null };
  }
  const log = opts.log ?? (() => {});

  async function definitions() {
    try {
      const r = await opts.api({ method: 'GET', path: '/v1/messenger/bots' });
      if (r.status === 200) return r.body.bots;
    } catch { /* 서버가 꺼져 있으면 지난 정의를 유지한다 */ return null; }
    return LEGACY;
  }

  // 허용 목록에 없는 메시지가 오면 그 자리에서 허용 목록만 다시 읽는다. 웹에서 "허용"을 누른 직후 다음 주기(1분)까지 거절되지 않게 한다.
  // 모르는 사람이 메시지를 쏟아 내도 서버를 두드리지 않도록 동시에 하나, 최소 간격을 둔다. 토큰·연결은 건드리지 않는다.
  let refreshing = null;
  let refreshedAt = -Infinity;
  const allowRefreshMs = opts.allowRefreshMs ?? 2000;
  function refreshAllowed() {
    if (refreshing) return refreshing;
    if (Date.now() - refreshedAt < allowRefreshMs) return Promise.resolve();
    refreshing = (async () => {
      try {
        const r = await opts.api({ method: 'GET', path: '/v1/messenger/bots' });
        if (r.status === 200) {
          for (const b of r.body.bots) {
            const e = running.get(`${b.platform}:${b.botId}`);
            if (e) e.def = { ...e.def, extraUsers: b.extraUsers ?? [] };
          }
        }
        const c = await loadServerConfig();
        serverCfg = { ...serverCfg, allowedUsers: c.allowedUsers };
      } catch { /* 서버가 꺼져 있으면 지난 목록으로 판단한다 */ } finally {
        refreshedAt = Date.now();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function start(key, b) {
    const runner = opts.runners[b.platform];
    if (!runner) return 'platform_not_supported';
    const entry = { def: b, controller: new AbortController(), state: 'starting', username: null, canReadAll: null };
    entry.bridge = createBridge({ ...opts.bridgeOpts, api: opts.apiFor(b.platform, b.botId), roomStore, botId: b.botId,
      log: (e) => log({ botId: b.botId, ...e }), // 전달 실패·중복 메시지 기록(내용 없이)
      botInfo: () => ({ name: entry.def.name, callNames: entry.def.callNames ?? [], role: entry.def.role ?? null,
        // 같은 메신저의 다른 봇을 부르는 이름(부르는 이름이 없으면 봇 ID). 그 이름으로 부른 글은 이 봇이 받지 않는다.
        otherCallNames: [...peers].filter((p) => p.platform === b.platform && p.botId !== b.botId)
          .flatMap((p) => (p.callNames?.length ? p.callNames : [p.botId])),
        // 같은 메신저의 다른 우리 봇 사용자 ID(슬랙 멘션 구분용)
        otherBotUserIds: [...running.values()].filter((o) => o !== entry && o.def.platform === b.platform && o.userId).map((o) => o.userId) }),
      isAllowed: (m) => [...commonUsers(b.platform), ...(entry.def.extraUsers ?? [])].map(String).includes(String(m.userId)),
      // W2: 승인은 공통 허용 사용자(사용자 본인)만 — 봇마다 더한 사람은 질문만
      isOwner: (m) => commonUsers(b.platform).map(String).includes(String(m.userId)) });
    // 상태가 바뀌면 다음 주기(1분)를 기다리지 않고 바로 보고한다.
    const report = () => opts.api({ method: 'POST', path: '/v1/messenger/bots/status', body: { bots: [{ platform: b.platform, botId: b.botId,
      state: entry.state, missing: [], username: entry.username, canReadAll: entry.canReadAll, detail: entry.detail ?? null }] } }).catch(() => {});
    const botLog = (e) => {
      if (['started', 'ready'].includes(e.event)) {
        entry.state = entry.conflict ? 'conflict' : 'connected';
        entry.username = e.bot ?? entry.username;
        if (typeof e.canReadAll === 'boolean') entry.canReadAll = e.canReadAll;
        if (e.botUserId) entry.userId = e.botUserId;
        report();
      }
      // 다른 곳에서 같은 봇을 받고 있음: 연결은 됐어도 메시지가 나뉘므로 "연결됨"으로 보이지 않게 한다.
      if (e.event === 'conflict' && !entry.conflict) { entry.conflict = true; entry.state = 'conflict'; report(); }
      if (e.event === 'conflict_clear' && entry.conflict) { entry.conflict = false; entry.state = 'connected'; report(); }
      // A1: 연결 실패는 바로 알리고 이유 코드(토큰 거절 등)도 함께 — 화면이 "토큰 없음"으로 잘못 보이지 않게.
      // 공개 중계(카카오·라인용)를 두지 않은 PC형: 오류가 아니라 "중계 없이 쓰는 중" — 카카오·라인만 쓰지 않고 나머지는 그대로(신산님 2026-11-12).
      if (e.event === 'open_error' && RELAY_OFF.has(String(e.error))) { entry.state = 'relay_off'; entry.detail = null; report(); log({ ...e, botId: b.botId }); return; }
      if (['open_error', 'closed_fatal'].includes(e.event)) { entry.state = 'error'; entry.detail = /^[\w.:-]{1,40}$/.test(String(e.error ?? '')) ? String(e.error) : 'error'; report(); }
      log({ ...e, botId: b.botId });
    };
    runner({ ...b.tokens, settings: settings(), signal: entry.controller.signal, log: botLog,
      onMessage: async (m, send) => {
        if (!entry.bridge.allowed(m)) await refreshAllowed();
        // U5: 화면의 6자리 숫자만 보낸 글은 먼저 주인 등록 숫자인지 확인한다(숫자는 기록하지 않음).
        // 이미 허용된 사람(주인)이 보내도 확인한다 — 화면이 "이 숫자를 보내세요"라고 하므로, 질문으로 대화에 들어가지 않게.
        // 기다리는 숫자가 없으면(404) 허용된 사람의 글은 지금처럼 일반 글로 처리한다.
        if (m.userId && /^\s*\d{6}\s*$/.test(String(m.text ?? ''))) {
          const already = entry.bridge.allowed(m);
          const r = await opts.api({ method: 'POST', path: '/v1/messenger/claim', body: { platform: b.platform, botId: b.botId, userId: String(m.userId),
            name: m.userName ?? m.name ?? null, code: String(m.text).trim(), ...(already ? { allowed: true } : {}) } }).catch(() => null);
          log({ platform: b.platform, botId: b.botId, event: 'claim', ok: r?.status === 200 });
          if (r?.status === 200 && already) return send('이미 허용된 분이라 따로 등록하지 않았어요. 화면에 완료로 표시돼요.');
          if (r?.status === 200) {
            refreshedAt = -Infinity; await refreshAllowed();
            return send('주인으로 등록됐어요. 이제 질문하면 이어서 답해요. /sessions로 대화를 고를 수 있어요.');
          }
          if (r?.status === 403) return send(r.body?.error === 'claim_locked' ? '숫자를 여러 번 틀려 막혔어요. 이어온 화면에서 숫자를 새로 받으세요.' : '숫자가 맞지 않아요. 이어온 화면의 숫자를 다시 확인하세요.');
        }
        const ok = entry.bridge.allowed(m);
        log({ platform: b.platform, botId: b.botId, event: 'message', allowed: ok });
        // W2: 허용 목록에 없는 사람은 서버에 알려 웹에서 "이 사람 허용"을 누를 수 있게 한다(내용은 보내지 않음).
        if (!ok && m.userId) opts.api({ method: 'POST', path: '/v1/messenger/denied', body: { platform: b.platform, botId: b.botId, userId: String(m.userId), name: m.userName ?? m.name ?? null } }).catch(() => {});
        return entry.bridge.handle({ ...m, botId: b.botId }, send);
      } });
    running.set(key, entry);
    return 'starting';
  }

  function stop(key) {
    running.get(key)?.controller.abort();
    running.delete(key);
  }

  async function sync() {
    const defs = await definitions();
    if (!defs) return null;
    peers = defs;
    const prevKakao = JSON.stringify(serverCfg.kakao);
    serverCfg = await loadServerConfig();
    // 카카오 중계 주소·제한 시간이 웹에서 바뀌면 카카오 봇만 다시 연결한다(허용 사용자는 다음 메시지부터 바로 반영).
    if (JSON.stringify(serverCfg.kakao) !== prevKakao) for (const key of [...running.keys()]) if (key.startsWith('kakao:')) stop(key);
    // W2: 웹에서 넣은 토큰을 매번 다시 읽는다(메신저를 다시 켜지 않아도 1분 안에 반영).
    const env = opts.loadEnv ? opts.loadEnv() : opts.env;
    const resolved = resolveBotTokens(defs, env);
    const wanted = new Set();
    const statuses = [];
    for (const b of resolved) {
      const key = `${b.platform}:${b.botId}`;
      wanted.add(key);
      if (b.status !== 'ready') {
        stop(key);
        statuses.push({ platform: b.platform, botId: b.botId, state: b.status, missing: b.missing });
        continue;
      }
      let cur = running.get(key);
      // 토큰이 바뀌었으면 그 봇만 다시 연결한다.
      if (cur && JSON.stringify(cur.def.tokens) !== JSON.stringify(b.tokens)) { stop(key); cur = null; }
      if (cur) cur.def = b; // 이름·역할·부르는 이름·허용 사용자는 연결을 다시 열지 않고 바꾼다.
      else start(key, b);
      const e = running.get(key);
      statuses.push({ platform: b.platform, botId: b.botId, state: e ? e.state : 'platform_not_supported', missing: [],
        username: e?.username ?? null, canReadAll: e?.canReadAll ?? null, detail: e?.detail ?? null });
    }
    for (const key of [...running.keys()]) if (!wanted.has(key)) stop(key); // 꺼지거나 지워진 봇
    await opts.api({ method: 'POST', path: '/v1/messenger/bots/status', body: { bots: statuses } }).catch(() => {});
    return statuses;
  }

  async function deliverNotices() {
    let n = 0;
    for (const e of running.values()) n += await e.bridge.deliverNotices().catch(() => 0);
    return n;
  }

  return { sync, deliverNotices, running, stopAll: () => [...running.keys()].forEach(stop), roomStore };
}