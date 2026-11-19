// 연결부 설정으로 엔진별 어댑터를 만든다. live는 설정에서 명시적으로 켠 경우만 true다.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { codexThreadAdapter } from './codex-thread.mjs';
import { claudeChannelAdapter } from './claude-channel.mjs';
import { claudeCliAdapter } from './claude-cli.mjs';
import { loadNewSessionsConfig } from '../new-sessions.mjs';
import { codexEnvFor } from '../accounts.mjs';
import { cliOnceAdapter } from './cli-once.mjs';
import { readWorkspaces, workspaceFor, workspaceLine } from '../workspaces.mjs';
import { claudeEnvFor } from '../claude-accounts.mjs';
import { agyRunFor } from '../agy-accounts.mjs';
import { grokRunFor } from '../grok-accounts.mjs';

// WS1-a: 작업 공간을 붙인 세션의 질문 앞에 폴더 한 줄(안내 — 차단은 엔진 샌드박스가 따로). 붙이지 않은 세션·새 세션은 그대로.
export function withWorkspaceLine(adapter, config) {
  return { ...adapter, run(job, ctx) {
    const ws = workspaceFor(config, adapter.engine ?? job.engine, job.newSession ? `new:${job.newSession.name}` : job.sessionRef); // WS1-b: 새 세션은 이름으로
    return adapter.run(ws ? { ...job, question: workspaceLine(ws) + job.question } : job, ctx);
  } };
}
// WS1-a: Codex 세션의 개인 폴더 = 그 세션의 작업 폴더(cwd), 공유(쓰기) 폴더 = 작업 모드 writableRoots에 더함
export function codexWorkspaceDirs(config) {
  const dirs = { ...(config.codex?.workingDirectories ?? {}) }; const extra = {};
  for (const key of Object.keys(readWorkspaces(config).attach)) {
    if (!key.startsWith('codex_thread:')) continue;
    const id = key.slice('codex_thread:'.length); const ws = workspaceFor(config, 'codex_thread', id);
    if (ws?.personal) dirs[id] = ws.personal;
    if (ws?.write.length) extra[id] = ws.write;
  }
  return { workingDirectories: dirs, writableExtra: extra };
}

// 이 연결부가 새 세션용으로 만든 엔진 세션 ID 기록(한 줄에 하나, 추가만 한다).
// A3: account — 그 새 세션을 만든 이어온 계정(Antigravity 계정 폴더에 대화가 있으므로 계속 그 계정으로)
export function createdLog(path) {
  const rows = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const ids = new Map(rows.map((r) => [r.id, r.name]));
  const acc = new Map(rows.filter((r) => r.account).map((r) => [r.id, r.account]));
  return {
    has: (id) => ids.has(id),
    account: (id) => acc.get(id) ?? null,
    add(id, name, account = null) {
      if (ids.has(id)) return;
      appendFileSync(path, JSON.stringify({ id, name, ...(account ? { account } : {}), at: new Date().toISOString() }) + '\n');
      ids.set(id, name); if (account) acc.set(id, account);
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
  const wsDirs = codexWorkspaceDirs(config);
  const adapters = {
    codex_thread: codexThreadAdapter({ live, allowlist: config.codex?.allowlist ?? [], modes: config.codex?.modes, shared: config.codex?.shared,
      workingDirectories: wsDirs.workingDirectories, writableExtra: wsDirs.writableExtra, newSessions,
      newSessionDirs: (name) => workspaceFor(config, 'codex_thread', `new:${name}`)?.write ?? [], // WS1-b: Codex 새 세션의 공유(쓰기) 폴더
      // A2: 이어온 전용 Codex 계정(설정 파일 경로를 아는 연결부가 accountsDir를 채워 준다)
      accountEnv: config.accountsDir ? (threadId) => codexEnvFor(config, config.accountsDir, threadId) : undefined }),
    claude_channel: claudeChannelAdapter({ live, baseUrl: config.claude?.baseUrl, tokenFile: config.claude?.tokenFile }),
    // SV2: 새 세션 + 서버 칸에서 고른 기존 Claude 대화(허용 목록·대화별 작업 폴더)
    claude_cli: claudeCliAdapter({ live, newSessions, allowlist: config.cliEngines?.claude_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.claude_cli?.workingDirectories,
      workspaceOf: (ref) => workspaceFor(config, 'claude_cli', ref), // WS1-b
      accountEnv: config.accountsDir ? (ref, o = {}) => claudeEnvFor(config, config.accountsDir, { ref, existing: o.existing === true }) : undefined }), // A2-b: PC의 이어온 전용 Claude 계정(없으면 지금처럼)
    // E1·E2: 세션 쪽은 그 PC의 허용 목록, 토큰 쪽은 지금 PC 기본 로그인(API 키 변수는 실행 때 지움)
    agy_cli: cliOnceAdapter({ live, engine: 'agy_cli', allowlist: config.cliEngines?.agy_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.agy_cli?.workingDirectories, newSessions, // E4: 새 세션도
      agyRun: config.accountsDir ? (acc) => agyRunFor(config, config.accountsDir, acc) : undefined }), // A3: 새 세션은 이어온 Antigravity 계정 폴더로
    grok_cli: cliOnceAdapter({ live, engine: 'grok_cli', allowlist: config.cliEngines?.grok_cli?.allowlist ?? [], workingDirectories: config.cliEngines?.grok_cli?.workingDirectories, newSessions, // G1: 새 세션도
      newEnv: config.accountsDir ? (acc) => grokRunFor(config, config.accountsDir, acc) : undefined }), // G1: 새 세션은 이어온 Grok 계정 키로
  };
  for (const k of ['codex_thread', 'claude_cli', 'agy_cli', 'grok_cli']) adapters[k] = withWorkspaceLine(adapters[k], config);
  return adapters;
}
