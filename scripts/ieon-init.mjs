// 이어온 최소 설정 만들기(Linux/WSL용, BEGINNER_GUIDE 1-5의 PowerShell 블록에 대응). 사용: node scripts/ieon-init.mjs <이어온 폴더>
// - .local/s2에 웹·연결부 시험 토큰(무작위 32바이트, 권한 600)과 server.json·connector.json, .local/new-sessions.json을 만든다.
// - 서버에는 토큰 원문 대신 sha256 해시만 적는다. 토큰 값은 출력하지 않는다.
// - 기존 세션 등록 없음(새 세션만 쓴다), 메신저·Claude 채널 설정 없음, live는 꺼 둔다. 이미 server.json이 있으면 거부한다(토큰이 바뀌지 않게).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const made = initLocal(process.argv[2] ?? '.');
    console.log(`설정을 만들었습니다(.local/ 아래, 토큰 값은 출력하지 않음): ${made.join(', ')}`);
  } catch (e) {
    console.error(e.message === 'already_initialized' ? '.local/s2/server.json 이 이미 있습니다. 다시 만들면 토큰이 바뀌므로 하지 않습니다.' : String(e.message));
    process.exit(1);
  }
}
