// 여러 봇 실행기(MULTI_BOTS M1). 웹에 정의된 봇과 .env의 규칙 이름 토큰으로 봇마다 메신저 연결을 띄운다.
// - 봇마다 공통 대화방 연결 파일을 함께 쓰고(키에 봇 ID), 서버에는 메신저 토큰 + x-ieon-bot으로 그 봇으로 접속한다.
// - 허용 사용자: 공통(웹 설정, 없으면 config allowedUsers) + 봇별 추가(웹). 카카오 설정도 웹 값이 있으면 그 값(P1).
// - sync()를 주기적으로 부르면 봇 추가·끄기·이름·허용 사용자 변경이 반영된다. 토큰이 바뀌면 메신저를 다시 켠다.
// - 상태(토큰 있음·없음·중복·연결됨·실제 봇 이름)만 서버에 보고한다. 토큰 값은 보고·기록하지 않는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createBridge } from './bridge.mjs';
import { DEFAULT_BOT, migrateRooms, resolveBotTokens } from '../bots.mjs';

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
      botInfo: () => ({ name: entry.def.name, callNames: entry.def.callNames ?? [], role: entry.def.role ?? null,
        // 같은 메신저의 다른 봇을 부르는 이름(부르는 이름이 없으면 봇 ID). 그 이름으로 부른 글은 이 봇이 받지 않는다.
        otherCallNames: [...peers].filter((p) => p.platform === b.platform && p.botId !== b.botId)
          .flatMap((p) => (p.callNames?.length ? p.callNames : [p.botId])),
        // 같은 메신저의 다른 우리 봇 사용자 ID(슬랙 멘션 구분용)
        otherBotUserIds: [...running.values()].filter((o) => o !== entry && o.def.platform === b.platform && o.userId).map((o) => o.userId) }),
      isAllowed: (m) => [...commonUsers(b.platform), ...(entry.def.extraUsers ?? [])].map(String).includes(String(m.userId)) });
    // 상태가 바뀌면 다음 주기(1분)를 기다리지 않고 바로 보고한다.
    const report = () => opts.api({ method: 'POST', path: '/v1/messenger/bots/status', body: { bots: [{ platform: b.platform, botId: b.botId,
      state: entry.state, missing: [], username: entry.username, canReadAll: entry.canReadAll }] } }).catch(() => {});
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
      if (['open_error', 'closed_fatal'].includes(e.event)) entry.state = 'error';
      log({ ...e, botId: b.botId });
    };
    runner({ ...b.tokens, settings: settings(), signal: entry.controller.signal, log: botLog,
      onMessage: async (m, send) => {
        if (!entry.bridge.allowed(m)) await refreshAllowed();
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
        username: e?.username ?? null, canReadAll: e?.canReadAll ?? null });
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