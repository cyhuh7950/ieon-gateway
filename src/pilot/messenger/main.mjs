// 메신저 봇 실행. 사용: node src/pilot/messenger/main.mjs <configPath>
// 설정(.local/messenger/config.json): serverUrl, userTokenFile(메신저 토큰), envFile, roomsPath, allowedUsers(공통), kakaoRelayUrl(카카오 중계 주소, 선택), kakaoCallbackLimitMs(콜백 제한 시간, 선택, 5000~120000, 기본 55000)
// 봇 목록·이름·역할은 웹 봇 관리에서 정의하고(서버 DB), 토큰은 envFile에 규칙 이름으로 둔다(docs/design/MULTI_BOTS.md).
// envFile의 토큰은 이 프로세스 안에서만 읽고 출력·기록하지 않는다. 토큰이 있는 봇만 켠다.
import { readFileSync } from 'node:fs';
import { serverApi } from './bridge.mjs';
import { runTelegram, runDiscord, runSlack } from './platforms.mjs';
import { runKakao } from './kakao.mjs';
import { runLine } from './line.mjs';
import { createBotRunner } from './runner.mjs';

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

(await import('../parent-watch.mjs')).watchParent(); // W6: 서버가 띄운 경우, 서버가 사라지면 함께 끝난다
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = parseEnv(readFileSync(config.envFile, 'utf8'));
const log = (e) => process.stderr.write(JSON.stringify({ ch: 'messenger', at: new Date().toISOString(), ...e }) + '\n');
const runner = createBotRunner({
  api: serverApi(config.serverUrl, config.userTokenFile),
  apiFor: (platform, botId) => serverApi(config.serverUrl, config.userTokenFile, `${platform}:${botId}`),
  env, loadEnv: () => { try { return parseEnv(readFileSync(config.envFile, 'utf8')); } catch { return env; } },
  allowedUsers: config.allowedUsers ?? {}, roomsPath: config.roomsPath,
  runners: { telegram: runTelegram, discord: runDiscord, slack: runSlack,
    // 카카오는 공개 수신 중계(Oracle)에서 질문을 가져온다. 중계 주소(비밀 아님)는 설정 파일의 kakaoRelayUrl, 토큰은 .env.
    // 웹 설정(o.settings.kakao)이 있으면 그 값, 없으면 이 파일 값(P1).
    kakao: (o) => {
      const relayUrl = o.settings?.kakao?.relayUrl ?? config.kakaoRelayUrl;
      const limit = o.settings?.kakao?.callbackLimitMs ?? config.kakaoCallbackLimitMs;
      return relayUrl ? runKakao({ ...o, relayUrl, ...(Number.isFinite(limit) ? { callbackLimitMs: Math.min(120_000, Math.max(5_000, limit)) } : {}) })
        : o.log({ platform: 'kakao', event: 'open_error', error: 'kakaoRelayUrl_missing' });
    },
    // L1 라인: 카카오와 같은 공개 중계(또는 허브 내장 중계)에서 ?channel=line으로 가져온다. 중계 주소·중계 토큰은 카카오와 같은 것,
    // 채널 액세스 토큰·채널 비밀 값은 그 봇의 토큰(웹에서 입력).
    line: (o) => {
      const relayUrl = o.settings?.kakao?.relayUrl ?? config.kakaoRelayUrl;
      let relayToken = null; try { relayToken = parseEnv(readFileSync(config.envFile, 'utf8')).KAKAO_RELAY_TOKEN ?? null; } catch { relayToken = env.KAKAO_RELAY_TOKEN ?? null; }
      if (!relayUrl || !relayToken) return o.log({ platform: 'line', event: 'open_error', error: 'relay_missing' });
      return runLine({ ...o, relayUrl, relayToken });
    } },
  log,
});

// 봇 상태: 봇 ID·상태·빠진 토큰 이름만(값 없음).
const report = (st) => st && log({ event: 'bots', bots: st.map((b) => ({ bot: `${b.platform}:${b.botId}`, state: b.state, ...(b.missing?.length ? { missing: b.missing } : {}) })) });
report(await runner.sync());
// 웹에서 봇을 추가·수정·끄면 1분 안에 반영한다. 새 토큰을 .env에 넣었으면 messenger를 다시 켠다.
setInterval(() => runner.sync().then(report).catch((e) => log({ event: 'sync_error', error: String(e.message).slice(0, 80) })), 60 * 1000);
// 새 세션 보관 예고를 10분마다 확인해 연결된 대화방에 보낸다.
setInterval(() => runner.deliverNotices().catch(() => {}), 10 * 60 * 1000).unref();
setInterval(() => runner.deliverScheduled().catch(() => {}), 60 * 1000).unref(); // W3 예약 질문의 답