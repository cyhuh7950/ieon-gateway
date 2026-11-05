// 여러 봇(설계: docs/design/MULTI_BOTS.md) 규칙. 토큰은 .env에 규칙 이름으로만 두고, 이 모듈은 값을 기록·출력하지 않는다.
export const PLATFORMS = Object.freeze(['telegram', 'discord', 'slack', 'teams']);
export const DEFAULT_BOT = 'default';
// 부르는 이름으로 쓸 수 없는 말(명령어와 헷갈림)
const RESERVED = new Set(['help', 'start', 'sessions', 'use', 'status', 'review', 'whoami', 'new', 'sleep', 'archived', 'restore', 'close', 'limits']);

// 봇 ID: 영문 소문자·숫자·- 2~32자(앞뒤는 영문·숫자). 토큰 변수 이름·서버 앱 ID·대화방 키에 쓰므로 한 번 정하면 바꾸지 않는다.
export function validBotId(id) {
  return typeof id === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/.test(id);
}

// 부르는 이름: 한글·영문·숫자 1~20자, 명령어와 같은 말은 불가. 비교는 대소문자·공백 무시.
export const normalizeCallName = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
export function validCallName(name) {
  const n = normalizeCallName(name);
  return /^[0-9a-z가-힣]{1,20}$/.test(n) && !RESERVED.has(n);
}

// 봇의 토큰 변수 이름. default 봇은 기존 이름을 그대로 쓴다(지금 .env를 바꾸지 않아도 되게).
export function tokenEnvNames(platform, id) {
  if (id === DEFAULT_BOT) {
    return { telegram: { token: 'TELEGRAM_BOT_TOKEN' }, discord: { token: 'DISCORD_BOT_TOKEN' },
      slack: { appToken: 'SLACK_APP_TOKEN', botToken: 'SLACK_BOT_TOKEN' },
      teams: { appId: 'TEAMS_APP_ID', appPassword: 'TEAMS_APP_PASSWORD' } }[platform];
  }
  const ID = id.toUpperCase().replaceAll('-', '_');
  return { telegram: { token: `TELEGRAM_BOT_${ID}_TOKEN` }, discord: { token: `DISCORD_BOT_${ID}_TOKEN` },
    slack: { appToken: `SLACK_BOT_${ID}_APP_TOKEN`, botToken: `SLACK_BOT_${ID}_BOT_TOKEN` },
    teams: { appId: `TEAMS_BOT_${ID}_APP_ID`, appPassword: `TEAMS_BOT_${ID}_APP_PASSWORD` } }[platform];
}

// 서버 앱 ID. default 봇은 기존 app_messenger를 그대로 쓴다. 봇 ID는 메신저마다 따로라 메신저 이름을 넣는다.
export const botAppId = (platform, id) => (id === DEFAULT_BOT ? 'app_messenger' : `app_bot_${platform}_${id}`);

// 켜진 봇마다 .env에서 토큰을 찾는다. 없으면 token_missing, 같은 토큰 값이 둘 이상의 봇에 있으면 모두 duplicate_token.
// 돌려주는 status·missing에는 토큰 값이 없다. tokens는 연결을 띄우는 쪽에서만 쓴다.
export function resolveBotTokens(bots, env) {
  const out = bots.filter((b) => b.enabled).map((b) => {
    const names = tokenEnvNames(b.platform, b.botId);
    const missing = Object.values(names).filter((n) => !env[n]);
    const tokens = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, env[n]]));
    return { ...b, envNames: names, missing, tokens, status: missing.length ? 'token_missing' : 'ready' };
  });
  const seen = new Map();
  for (const b of out) {
    for (const v of Object.values(b.tokens)) {
      if (!v) continue;
      if (seen.has(v)) { seen.get(v).status = 'duplicate_token'; b.status = 'duplicate_token'; } else seen.set(v, b);
    }
  }
  return out;
}

// rooms.json: 옛 형식 { "<메신저>:<대화방>[:<주제>]": 세션 }을 { _v: 2, rooms: { "<메신저>:default:<대화방>[:<주제>]": 세션 } }로 바꾼다.
export function migrateRooms(data) {
  if (data?._v === 2) return { data, changed: false };
  const rooms = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    const [platform, ...rest] = k.split(':');
    rooms[[platform, DEFAULT_BOT, ...rest].join(':')] = v;
  }
  return { data: { _v: 2, rooms }, changed: true };
}
