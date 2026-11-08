// 이어온 최소 설정 만들기(Linux/WSL용, BEGINNER_GUIDE 1-5의 PowerShell 블록에 대응). 사용: node scripts/ieon-init.mjs <이어온 폴더>
// - .local/s2에 웹·연결부 시험 토큰(무작위 32바이트, 권한 600)과 server.json·connector.json, .local/new-sessions.json을 만든다.
// - 서버에는 토큰 원문 대신 sha256 해시만 적는다. 토큰 값은 출력하지 않는다.
// - 기존 세션 등록 없음(새 세션만 쓴다), 메신저·Claude 채널 설정 없음, live는 꺼 둔다. 이미 server.json이 있으면 거부한다(토큰이 바뀌지 않게).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function initLocal(rootDir, { workspaceRoot = '~/ieon-workspaces', port = 28760 } = {}) {
  const root = resolve(rootDir);
  const posix = root.replaceAll('\\', '/');
  const L = join(root, '.local');
  const s2 = join(L, 's2');
  if (existsSync(join(s2, 'server.json'))) throw new Error('already_initialized');
  mkdirSync(s2, { recursive: true });
  mkdirSync(join(L, 'run'), { recursive: true });

  const token = (path) => {
    const t = randomBytes(32).toString('hex');
    writeFileSync(path, t, { flag: 'wx', mode: 0o600 });
    return createHash('sha256').update(t).digest('hex');
  };
  const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

  const webHash = token(join(s2, 'user-token'));
  const devHash = token(join(s2, 'device-token'));
  const nsPath = `${posix}/.local/new-sessions.json`;
  json(join(L, 'new-sessions.json'), { enabled: true, workspaceRoot });
  json(join(s2, 'server.json'), {
    port, dbPath: `${posix}/.local/s2/pilot.db`,
    users: [{ userId: 'u_sinsan', appId: 'app_web', tokenSha256: webHash }],
    devices: [{ hostId: 'h_sinsan', tokenSha256: devHash }],
    bindings: [],
    newSessionsConfigPath: nsPath,
  });
  json(join(s2, 'connector.json'), {
    serverUrl: `http://127.0.0.1:${port}`, deviceTokenFile: `${posix}/.local/s2/device-token`,
    receiptPath: `${posix}/.local/s2/receipts.jsonl`, live: false,
    codex: { allowlist: [], modes: {}, workingDirectories: {} },
    newSessions: { configPath: nsPath, createdPath: `${posix}/.local/s2/new-threads.jsonl` },
  });
  return ['s2/user-token', 's2/device-token', 's2/server.json', 's2/connector.json', 'new-sessions.json'];
}

// W6: 웹 중심 설치(설계 WEB_FIRST). 처음이면 initLocal로 만들고, 이미 있으면 필요한 것만 보탠다(기존 토큰·설정은 바꾸지 않음).
// - 메신저: 메신저 사용자 토큰(.local/messenger/token)과 봇 토큰 파일(bots.env, 비어 있음)·설정을 만들고 서버에 해시만 등록.
// - 서버 설정: 연결부 설정 경로·연결부와 메신저를 서버가 직접 띄우기·봇 토큰 파일(웹 입력용).
// 토큰 값은 출력하지 않는다. 바뀐 항목 이름만 돌려준다.
export function prepareWebFirst(rootDir) {
  const root = resolve(rootDir);
  const posix = root.replaceAll('\\', '/');
  const L = join(root, '.local');
  const changes = [];
  if (!existsSync(join(L, 's2', 'server.json'))) changes.push(...initLocal(root).map((f) => 'created:' + f));
  const serverPath = join(L, 's2', 'server.json');
  const server = JSON.parse(readFileSync(serverPath, 'utf8'));
  const M = join(L, 'messenger');
  const mcfgPath = join(M, 'config.json');
  let mcfg = existsSync(mcfgPath) ? JSON.parse(readFileSync(mcfgPath, 'utf8')) : null;
  if (!mcfg) {
    mkdirSync(M, { recursive: true });
    const token = randomBytes(32).toString('hex');
    writeFileSync(join(M, 'token'), token, { flag: 'wx', mode: 0o600 });
    if (!existsSync(join(M, 'bots.env'))) writeFileSync(join(M, 'bots.env'), '# 봇 토큰은 웹 화면(봇 관리 → 토큰)에서 넣는다. 이 파일을 직접 고치지 않는다.\n', { mode: 0o600 });
    const web = server.users.find((u) => u.appId === 'app_web');
    if (!server.users.some((u) => u.appId === 'app_messenger')) {
      server.users.push({ userId: web?.userId ?? 'u_sinsan', appId: 'app_messenger', tokenSha256: createHash('sha256').update(token).digest('hex') });
      changes.push('server:app_messenger');
    }
    mcfg = { serverUrl: `http://127.0.0.1:${server.port ?? 28760}`, userTokenFile: `${posix}/.local/messenger/token`,
      envFile: `${posix}/.local/messenger/bots.env`, roomsPath: `${posix}/.local/messenger/rooms.json`, allowedUsers: {} };
    writeFileSync(mcfgPath, JSON.stringify(mcfg, null, 2) + '\n', { flag: 'wx' });
    changes.push('created:messenger/config.json');
  }
  const want = {
    connectorConfigPath: `${posix}/.local/s2/connector.json`,
    manageLocalConnector: true,
    messengerConfigPath: `${posix}/.local/messenger/config.json`,
    manageMessenger: true,
    secretsFile: mcfg.envFile,
  };
  for (const [k, v] of Object.entries(want)) if (server[k] === undefined) { server[k] = v; changes.push('server:' + k); }
  if (changes.some((c) => c.startsWith('server:'))) writeFileSync(serverPath, JSON.stringify(server, null, 2) + '\n');
  return changes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === '--web-first') {
    const changes = prepareWebFirst(process.argv[3] ?? '.');
    console.log(`웹 중심 설정 준비(값은 출력하지 않음): ${changes.join(', ') || '바꿀 것 없음'}`);
    process.exit(0);
  }
  try {
    const made = initLocal(process.argv[2] ?? '.');
    console.log(`설정을 만들었습니다(.local/ 아래, 토큰 값은 출력하지 않음): ${made.join(', ')}`);
  } catch (e) {
    console.error(e.message === 'already_initialized' ? '.local/s2/server.json 이 이미 있습니다. 다시 만들면 토큰이 바뀌므로 하지 않습니다.' : String(e.message));
    process.exit(1);
  }
}
