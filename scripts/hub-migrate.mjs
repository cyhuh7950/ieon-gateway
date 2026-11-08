// W0: 옮긴 허브 데이터의 설정 경로를 컨테이너 경로로 바꾼다. 사용: node scripts/hub-migrate.mjs <데이터 폴더> [이전 .local 경로]
// - 설정 JSON(server·connector·messenger·new-sessions)의 이전 경로 문자열을 /data로 바꾼다(토큰·DB 내용은 건드리지 않는다).
// - server.json: Unix 소켓 대신 publicListen(0.0.0.0:28770), trustedProxies에서 "unix" 제거.
// - new-sessions.json: 작업 폴더를 /data/workspaces로, Codex 로그인 전이라 새 세션은 끈다(웹 Codex 로그인 후 다시 켬, WEB_FIRST W5).
// - 바꾸기 전 파일은 같은 이름 .bak-w0로 남긴다. 값은 출력하지 않는다.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function migrateHubData(data, oldLocal = '/home/ieon/deploy/ieon-gateway/.local', newLocal = '/data') {
  const swap = (v) => (typeof v === 'string' && v.startsWith(oldLocal) ? newLocal + v.slice(oldLocal.length) : v);
  const deep = (o) => (Array.isArray(o) ? o.map(deep) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : swap(o));
  const changed = [];
  const rewrite = (rel, fn) => {
    const p = join(data, rel);
    if (!existsSync(p)) return;
    const before = JSON.parse(readFileSync(p, 'utf8'));
    const after = fn(deep(before));
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    if (!existsSync(p + '.bak-w0')) copyFileSync(p, p + '.bak-w0');
    writeFileSync(p, JSON.stringify(after, null, 2) + '\n');
    changed.push(rel);
  };
  rewrite('s2/server.json', (c) => {
    delete c.listenSocket;
    c.publicListen = { host: '0.0.0.0', port: 28770 };
    if (c.webAccess?.trustedProxies) c.webAccess.trustedProxies = c.webAccess.trustedProxies.filter((x) => x !== 'unix');
    return c;
  });
  rewrite('s2/connector.json', (c) => c);
  rewrite('messenger/config.json', (c) => c);
  rewrite('new-sessions.json', (c) => ({ ...c, enabled: false, workspaceRoot: `${newLocal}/workspaces` }));
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = migrateHubData(process.argv[2] ?? '/data', process.argv[3]);
  console.log(`허브 데이터 경로 변경: ${changed.join(', ') || '없음'}`);
}
