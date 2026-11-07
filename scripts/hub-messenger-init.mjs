// P5: 허브(ieun)에서 메신저를 처음 준비한다(카카오부터). 사용: node scripts/hub-messenger-init.mjs <이어온 폴더>
// - 메신저 사용자 토큰(.local/messenger/token, 600)을 만들고 server.json users에 해시만 추가한다(server.json은 먼저 백업).
// - 허브 내장 카카오 수신 비밀 파일(.local/messenger/bots.env, 600)에 KAKAO_RELAY_TOKEN·IEON_RELAY_KAKAO_SECRET을 무작위로 만든다.
//   서버(server.json relay.envFile)와 메신저(envFile)가 같은 파일을 읽는다. 다른 봇 토큰은 신산님이 이 파일에 직접 넣는다.
// - 메신저 설정(.local/messenger/config.json): 서버·카카오 수신 모두 이 기계의 127.0.0.1. 허용 사용자는 허브 웹 설정에서 정한다.
// - 토큰·비밀 값은 출력하지 않는다. 이미 메신저 설정이 있으면 거부한다.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function initHubMessenger(rootDir, { now = new Date() } = {}) {
  const root = resolve(rootDir);
  const posix = root.replaceAll('\\', '/');
  const L = join(root, '.local');
  const M = join(L, 'messenger');
  const serverPath = join(L, 's2', 'server.json');
  if (!existsSync(serverPath)) throw new Error('server_json_missing');
  if (existsSync(join(M, 'config.json'))) throw new Error('already_initialized');
  const server = JSON.parse(readFileSync(serverPath, 'utf8'));
  if (server.users.some((u) => u.appId === 'app_messenger')) throw new Error('messenger_user_exists');
  const owner = server.users.find((u) => u.appId === 'app_web')?.userId;
  if (!owner) throw new Error('web_user_missing');
  mkdirSync(M, { recursive: true });

  const hex = () => randomBytes(32).toString('hex');
  const token = hex();
  writeFileSync(join(M, 'token'), token, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(M, 'bots.env'), `# 허브 메신저 비밀 파일(권한 600). 값은 출력·복사하지 않는다.\n# 카카오 스킬 URL: https://<허브 주소>/kakao/skill/<IEON_RELAY_KAKAO_SECRET 값>\nKAKAO_RELAY_TOKEN=${hex()}\nIEON_RELAY_KAKAO_SECRET=${hex()}\n`, { flag: 'wx', mode: 0o600 });

  const backup = `${serverPath}.bak-p5-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  copyFileSync(serverPath, backup);
  server.users.push({ userId: owner, appId: 'app_messenger', tokenSha256: createHash('sha256').update(token).digest('hex') });
  server.relay = { envFile: `${posix}/.local/messenger/bots.env` };
  writeFileSync(serverPath, JSON.stringify(server, null, 2) + '\n');

  const base = `http://127.0.0.1:${server.port ?? 28760}`;
  writeFileSync(join(M, 'config.json'), JSON.stringify({
    serverUrl: base, userTokenFile: `${posix}/.local/messenger/token`, envFile: `${posix}/.local/messenger/bots.env`,
    roomsPath: `${posix}/.local/messenger/rooms.json`, kakaoRelayUrl: base, allowedUsers: {},
  }, null, 2) + '\n', { flag: 'wx' });
  return { backup, files: ['.local/messenger/token', '.local/messenger/bots.env', '.local/messenger/config.json', '.local/s2/server.json'] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = initHubMessenger(process.argv[2] ?? '.');
  console.log(`허브 메신저 준비 완료(값은 출력하지 않음): ${r.files.join(', ')} · server.json 백업 ${r.backup}`);
  console.log('다음: 서버 재시작 → 메신저 시작 → 허브 웹 설정에서 카카오 허용 사용자 → 오픈빌더 스킬 URL(신산님이 bots.env의 비밀 값으로 직접)');
}
