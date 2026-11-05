// 메신저 봇 실행. 사용: node src/pilot/messenger/main.mjs <configPath>
// 설정(.local/messenger/config.json): serverUrl, userTokenFile, envFile, roomsPath, allowedUsers
// envFile의 봇 토큰은 이 프로세스 안에서만 읽고 출력·기록하지 않는다. 있는 메신저만 켠다.
import { readFileSync } from 'node:fs';
import { createBridge, serverApi } from './bridge.mjs';
import { runTelegram, runDiscord, runSlack } from './platforms.mjs';

const NAMES = {
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN'],
  discord: ['DISCORD_BOT_TOKEN', 'DISCORD_TOKEN'],
  slackApp: ['SLACK_APP_TOKEN'],
  slackBot: ['SLACK_BOT_TOKEN'],
};

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
const pick = (env, keys) => keys.map((k) => env[k]).find(Boolean);

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = parseEnv(readFileSync(config.envFile, 'utf8'));
const log = (e) => process.stderr.write(JSON.stringify({ ch: 'messenger', at: new Date().toISOString(), ...e }) + '\n');
const bridge = createBridge({
  api: serverApi(config.serverUrl, config.userTokenFile),
  allowedUsers: config.allowedUsers ?? {},
  roomsPath: config.roomsPath,
});
const onMessage = (m, send) => {
  log({ platform: m.platform, event: 'message', allowed: (config.allowedUsers?.[m.platform] ?? []).map(String).includes(String(m.userId)) });
  return bridge.handle(m, send);
};

// 새 세션 보관 예고를 10분마다 확인해 연결된 대화방에 보낸다(기능이 꺼져 있으면 서버가 403을 주고 아무것도 하지 않는다).
setInterval(() => bridge.deliverNotices().catch(() => {}), 10 * 60 * 1000).unref();

const enabled = [];
const telegram = pick(env, NAMES.telegram);
if (telegram) { runTelegram({ token: telegram, onMessage, log }); enabled.push('telegram'); }
const discord = pick(env, NAMES.discord);
if (discord) { runDiscord({ token: discord, onMessage, log }); enabled.push('discord'); }
const slackApp = pick(env, NAMES.slackApp);
const slackBot = pick(env, NAMES.slackBot);
if (slackApp && slackBot) { runSlack({ appToken: slackApp, botToken: slackBot, onMessage, log }); enabled.push('slack'); }
log({ event: 'enabled', platforms: enabled, missing: Object.entries(NAMES).filter(([, keys]) => !pick(env, keys)).map(([k]) => k) });
