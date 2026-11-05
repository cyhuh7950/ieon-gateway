// 여러 봇 실행기(MULTI_BOTS M1). 웹에 정의된 봇과 .env의 규칙 이름 토큰으로 봇마다 메신저 연결을 띄운다.
// - 봇마다 공통 대화방 연결 파일을 함께 쓰고(키에 봇 ID), 서버에는 메신저 토큰 + x-ieon-bot으로 그 봇으로 접속한다.
// - 허용 사용자: 공통(config allowedUsers) + 봇별 추가(웹).
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
  const log = opts.log ?? (() => {});

  async function definitions() {
    try {
      const r = await opts.api({ method: 'GET', path: '/v1/messenger/bots' });
      if (r.status === 200) return r.body.bots;
    } catch { /* 서버가 꺼져 있으면 지난 정의를 유지한다 */ return null; }
    return LEGACY;
  }

  function start(key, b) {
    const runner = opts.runners[b.platform];
    if (!runner) return 'platform_not_supported';
    const entry = { def: b, controller: new AbortController(), state: 'starting', username: null, canReadAll: null };
    const common = (opts.allowedUsers?.[b.platform] ?? []).map(String);
    entry.bridge = createBridge({ ...opts.bridgeOpts, api: opts.apiFor(b.platform, b.botId), roomStore, botId: b.botId,
      botInfo: () => ({ name: entry.def.name, callNames: entry.def.callNames ?? [], role: entry.def.role ?? null }),
      isAllowed: (m) => [...common, ...(entry.def.extraUsers ?? []).map(String)].includes(String(m.userId)) });
    const botLog = (e) => {
      if (['started', 'ready'].includes(e.event)) {
        entry.state = 'connected';
        entry.username = e.bot ?? entry.username;
        if (typeof e.canReadAll === 'boolean') entry.canReadAll = e.canReadAll;
        // 연결되면 다음 주기(1분)를 기다리지 않고 바로 상태를 보고한다.
        opts.api({ method: 'POST', path: '/v1/messenger/bots/status', body: { bots: [{ platform: b.platform, botId: b.botId,
          state: entry.state, missing: [], username: entry.username, canReadAll: entry.canReadAll }] } }).catch(() => {});
      }
      if (['open_error', 'closed_fatal'].includes(e.event)) entry.state = 'error';
      log({ ...e, botId: b.botId });
    };
    runner({ ...b.tokens, signal: entry.controller.signal, log: botLog,
      onMessage: (m, send) => {
        log({ platform: b.platform, botId: b.botId, event: 'message', allowed: entry.bridge.allowed(m) });
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
    const resolved = resolveBotTokens(defs, opts.env);
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
      const cur = running.get(key);
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
