// 연결부 설정으로 엔진별 어댑터를 만든다. live는 설정에서 명시적으로 켠 경우만 true다.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { codexThreadAdapter } from './codex-thread.mjs';
import { claudeChannelAdapter } from './claude-channel.mjs';
import { claudeCliAdapter } from './claude-cli.mjs';
import { loadNewSessionsConfig } from '../new-sessions.mjs';
import { codexEnvFor } from '../accounts.mjs';
import { cliOnceAdapter } from './cli-once.mjs';

// 이 연결부가 새 세션용으로 만든 엔진 세션 ID 기록(한 줄에 하나, 추가만 한다).
export function createdLog(path) {
  const ids = new Map(existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.name]) : []);
  return {
    has: (id) => ids.has(id),
    add(id, name) {
      if (ids.has(id)) return;
      appendFileSync(path, JSON.stringify({ id, name, at: new Date().toISOString() }) + '\n');
      ids.set(id, name);
    },
  };
}

export async function buildAdapters(config) {
  const live = config.live === true;
  // 새 세션 만들기: connector.json의 newSessions { configPath, createdPath }가 있으면 준비한다.
  // 켜고 끄기는 서버가 판단한다(파일 값 위에 웹 설정을 겹침). 파일의 enabled로 막으면 웹에서 켜도 연결부가 거절한다(2026-11-08 허브 시험).
  const nsCfg = config.newSessions?.configPath && existsSync(config.newSessions.configPath)
    ? loadNewSessionsConfig(JSON.parse(readFileSync(config.newSessions.configPath, 'utf8'))) : null;
  const newSessions = nsCfg && config.newSessions.createdPath
    ? { config: nsCfg, created: createdLog(config.newSessions.createdPath) } : undefined;
  return {
    codex_thread: codexThreadAdapter({ live, allowlist: config.codex?.allowlist ?? [], modes: config.codex?.modes, shared: config.codex?.shared,
      workingDirectories: config.codex?.workingDirectories, newSessions,
      // A2: 이어온 전용 Codex 계정(설정 파일 경로를 아는 연결부가 accountsDir를 채워 준다)
      accountEnv: config.accountsDir ? (threadId) => codexEnvFor(config, config.accountsDir, threadId) : undefined }),
    claude_channel: claudeChannelAdapter({ live, baseUrl: config.claude?.baseUrl, tokenFile: config.claude?.tokenFile }),
    // SV2: 새 세션 + 서버 칸에서 고른 기존 Claude 대화(허용 목록·대화별 작업 폴더)
    claude_cli: claudeCliAdapter({ live, newSessions, allowlist: config.cliEngines?.claude_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.claude_cli?.workingDirectories }),
    // E1·E2: 세션 쪽은 그 PC의 허용 목록, 토큰 쪽은 지금 PC 기본 로그인(API 키 변수는 실행 때 지움)
    agy_cli: cliOnceAdapter({ live, engine: 'agy_cli', allowlist: config.cliEngines?.agy_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.agy_cli?.workingDirectories }),
    grok_cli: cliOnceAdapter({ live, engine: 'grok_cli', allowlist: config.cliEngines?.grok_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.grok_cli?.workingDirectories }),
  };
}
