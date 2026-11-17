// SV4(신산님 2026-11-17 "SV4 진행해", 설계 SERVER_SESSIONS 2-1·4절): 새 리눅스 서버에 처음 설치할 때 허브 데이터(/data)를 만든다.
// 지금 허브(sinsan-server)는 PC 데이터를 옮겨(hub-migrate) 만들었는데, 새 서버는 옮길 것이 없으므로 컨테이너가 처음 켜질 때 여기서 만든다.
// - 내부 토큰(웹·연결부·메신저)은 무작위 32바이트, 파일 권한 600, 설정에는 sha256 해시만. 값은 출력하지 않는다.
// - 웹 접속 제한(허브 필수)은 설치 때 받은 주소(보통 설치한 사람의 SSH 접속 주소)로. 처음 화면에서 관리자 비밀번호를 만든다.
// - 쓰임: server(① 서버 설치형 — PC 연결 화면 숨김) | hub(② 허브형). 나중에 설정 화면에서 바꿀 수 있다(데이터 그대로).
// - 이미 server.json이 있으면 아무것도 바꾸지 않는다(토큰이 바뀌지 않게).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTALL_KINDS = Object.freeze(['server', 'hub']);
const CIDR = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-fA-F]*:[0-9a-fA-F:.]*(\/\d{1,3})?)$/; // IPv4(/n) 또는 IPv6

// "1.2.3.4, 10.0.0.0/8" 같은 글을 목록으로(형식이 틀린 것은 뺀다)
export const parseList = (s) => String(s ?? '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => x && CIDR.test(x));

export function initHubData(data, { ipAllowlist = [], trustedProxies = [], installKind = 'server', live = true } = {}) {
  const D = data.replaceAll('\\', '/');
  if (existsSync(posix.join(D, 's2/server.json'))) return [];
  if (!INSTALL_KINDS.includes(installKind)) throw new Error('bad_install_kind');
  if (!ipAllowlist.length) throw new Error('need_ip_allowlist');
  for (const d of ['s2', 'messenger', 'workspaces', 'home', 'codex']) mkdirSync(posix.join(D, d), { recursive: true, mode: 0o700 });
  const token = (rel) => {
    const t = randomBytes(32).toString('hex');
    writeFileSync(posix.join(D, rel), t, { flag: 'wx', mode: 0o600 });
    return createHash('sha256').update(t).digest('hex');
  };
  const json = (rel, v, mode = 0o644) => writeFileSync(posix.join(D, rel), JSON.stringify(v, null, 2) + '\n', { flag: 'wx', mode });
  const web = token('s2/user-token');
  const dev = token('s2/device-token');
  const msg = token('messenger/token');
  // 내장 카카오 중계(이 서버가 카카오를 바로 받음)의 열쇠: 서버(중계)와 메신저가 같은 값을 쓴다. 없으면 서버가 시작하지 못한다.
  const relayPc = randomBytes(32).toString('hex');
  writeFileSync(posix.join(D, 'messenger/bots.env'), '# 봇 토큰은 웹 화면(설정 → 메신저)에서 넣는다. 이 파일을 직접 고치지 않는다.\n'
    + `IEON_RELAY_PC_TOKEN=${relayPc}\nKAKAO_RELAY_TOKEN=${relayPc}\nIEON_RELAY_KAKAO_SECRET=${randomBytes(24).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  json('new-sessions.json', { enabled: true, workspaceRoot: posix.join(D, 'workspaces') });
  json('s2/server.json', {
    port: 28760, dbPath: posix.join(D, 's2/pilot.db'),
    users: [{ userId: 'u_sinsan', appId: 'app_web', tokenSha256: web }, { userId: 'u_sinsan', appId: 'app_messenger', tokenSha256: msg }],
    devices: [{ hostId: 'h_hub', tokenSha256: dev }],
    bindings: [],
    newSessionsConfigPath: posix.join(D, 'new-sessions.json'), newSessionsHostId: 'h_hub',
    webAccess: { modes: ['ip_allowlist'], ipAllowlist, trustedProxies },
    relay: { envFile: posix.join(D, 'messenger/bots.env') },
    publicListen: { host: '0.0.0.0', port: 28770 },
    installKind,
  });
  json('s2/connector.json', {
    serverUrl: 'http://127.0.0.1:28760', deviceTokenFile: posix.join(D, 's2/device-token'), receiptPath: posix.join(D, 's2/receipts.jsonl'),
    live, codex: { allowlist: [], modes: {}, workingDirectories: {} },
    newSessions: { configPath: posix.join(D, 'new-sessions.json'), createdPath: posix.join(D, 's2/new-threads.jsonl') },
  });
  json('messenger/config.json', {
    serverUrl: 'http://127.0.0.1:28760', userTokenFile: posix.join(D, 'messenger/token'), envFile: posix.join(D, 'messenger/bots.env'),
    roomsPath: posix.join(D, 'messenger/rooms.json'), allowedUsers: {},
    kakaoRelayUrl: 'http://127.0.0.1:28760', // 카카오는 중계 없이 이 서버가 바로 받는다(공개 https 주소가 이 서버를 가리켜야 함)
  });
  return ['s2/user-token', 's2/device-token', 'messenger/token', 'messenger/bots.env', 'new-sessions.json', 's2/server.json', 's2/connector.json', 'messenger/config.json'];
}

// 컨테이너 첫 실행: 환경 변수(설치 때 .env에 적은 값)로 만든다.
export function initFromEnv(data, env = process.env) {
  return initHubData(data, {
    ipAllowlist: parseList(env.IEON_WEB_ALLOW),
    trustedProxies: parseList(env.IEON_TRUSTED_PROXIES),
    installKind: env.IEON_INSTALL_KIND || 'server',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const made = initFromEnv(process.argv[2] ?? '/data');
  console.log(made.length ? `처음 설정을 만들었어요(값은 출력하지 않음): ${made.join(', ')}` : '이미 설정이 있어요 — 바꾸지 않았어요');
}
