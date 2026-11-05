// 메신저 봇 실행. 사용: node src/pilot/messenger/main.mjs <configPath>
// 설정(.local/messenger/config.json): serverUrl, userTokenFile(메신저 토큰), envFile, roomsPath, allowedUsers(공통), kakaoRelayUrl(카카오 중계 주소, 선택), kakaoCallbackLimitMs(콜백 제한 시간, 선택, 5000~120000, 기본 55000)
// 봇 목록·이름·역할은 웹 봇 관리에서 정의하고(서버 DB), 토큰은 envFile에 규칙 이름으로 둔다(docs/design/MULTI_BOTS.md).
// envFile의 토큰은 이 프로세스 안에서만 읽고 출력·기록하지 않는다. 토큰이 있는 봇만 켠다.
import { readFileSync } from 'node:fs';
import { serverApi } from './bridge.mjs';
import { runTelegram, runDiscord, runSlack } from './platforms.mjs';
import { runKakao } from './kakao.mjs';
import { createBotRunner } from './runner.mjs';

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = parseEnv(readFileSync(config.envFile, 'utf8'));
const log = (e) => process.stderr.write(JSON.stringify({ ch: 'messenger', at: new Date().toISOString(), ...e }) + '\n');
const runner = createBotRunner({
  api: serverApi(config.serverUrl, config.userTokenFile),
  apiFor: (platform, botId) => serverApi(config.serverUrl, config.userTokenFile, `${platform}:${botId}`),
  env, allowedUsers: config.allowedUsers ?? {}, roomsPath: config.roomsPath,
  runners: { telegram: runTelegram, discord: runDiscord, slack: runSlack,
    // 카카오는 공개 수신 중계(Oracle)에서 질문을 가져온다. 중계 주소(비밀 아님)는 설정 파일의 kakaoRelayUrl, 토큰은 .env.
    kakao: (o) => (config.kakaoRelayUrl ? runKakao({ ...o, relayUrl: config.kakaoRelayUrl, ...(Number.isFinite(config.kakaoCallbackLimitMs) ? { callbackLimitMs: Math.min(120_000, Math.max(5_000, config.kakaoCallbackLimitMs)) } : {}) }) : o.log({ platform: 'kakao', event: 'open_error', error: 'kakaoRelayUrl_missing' })) },
  log,
});

// 봇 상태: 봇 ID·상태·빠진 토큰 이름만(값 없음).
const report = (st) => st && log({ event: 'bots', bots: st.map((b) => ({ bot: `${b.platform}:${b.botId}`, state: b.state, ...(b.missing?.length ? { missing: b.missing } : {}) })) });
report(await runner.sync());
// 웹에서 봇을 추가·수정·끄면 1분 안에 반영한다. 새 토큰을 .env에 넣었으면 messenger를 다시 켠다.
setInterval(() => runner.sync().then(report).catch((e) => log({ event: 'sync_error', error: String(e.message).slice(0, 80) })), 60 * 1000);
// 새 세션 보관 예고를 10분마다 확인해 연결된 대화방에 보낸다.
setInterval(() => runner.deliverNotices().catch(() => {}), 10 * 60 * 1000).unref();
