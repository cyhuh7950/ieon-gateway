// W0: 허브 Docker 이전 — 데이터 경로 바꾸기, 컨테이너 안 프로세스 관리(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateHubData } from '../../scripts/hub-migrate.mjs';
import { hubCommands, supervise } from '../../src/hub/run.mjs';

const OLD = '/home/ieon/deploy/ieon-gateway/.local';

test('데이터 이전: 이전 경로를 /data로 바꾸고, 소켓 대신 공개 포트, 새 세션은 끄며 원본은 .bak-w0로 남긴다', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w0-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 's2')); mkdirSync(join(d, 'messenger'));
  const server = { port: 28760, dbPath: `${OLD}/s2/pilot.db`, users: [{ tokenSha256: 'ab' }], devices: [], bindings: [],
    newSessionsConfigPath: `${OLD}/new-sessions.json`, listenSocket: '/home/ieon/run/ieun-hub.sock',
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9/32'], trustedProxies: ['unix', '172.19.0.0/16'] },
    relay: { envFile: `${OLD}/messenger/bots.env` } };
  writeFileSync(join(d, 's2/server.json'), JSON.stringify(server));
  writeFileSync(join(d, 's2/connector.json'), JSON.stringify({ deviceTokenFile: `${OLD}/s2/device-token`, live: false, newSessions: { configPath: `${OLD}/new-sessions.json` } }));
  writeFileSync(join(d, 'messenger/config.json'), JSON.stringify({ userTokenFile: `${OLD}/messenger/token`, envFile: `${OLD}/messenger/bots.env` }));
  writeFileSync(join(d, 'new-sessions.json'), JSON.stringify({ enabled: true, workspaceRoot: '~/ieon-workspaces' }));
  const changed = migrateHubData(d);
  assert.deepEqual(changed.sort(), ['messenger/config.json', 'new-sessions.json', 's2/connector.json', 's2/server.json']);
  const s = JSON.parse(readFileSync(join(d, 's2/server.json'), 'utf8'));
  assert.equal(s.dbPath, '/data/s2/pilot.db');
  assert.equal(s.relay.envFile, '/data/messenger/bots.env');
  assert.equal(s.listenSocket, undefined);
  assert.deepEqual(s.publicListen, { host: '0.0.0.0', port: 28770 });
  assert.deepEqual(s.webAccess.trustedProxies, ['172.19.0.0/16']);
  assert.equal(s.users[0].tokenSha256, 'ab');
  assert.equal(JSON.parse(readFileSync(join(d, 's2/connector.json'), 'utf8')).deviceTokenFile, '/data/s2/device-token');
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'new-sessions.json'), 'utf8')), { enabled: false, workspaceRoot: '/data/workspaces' });
  assert.ok(existsSync(join(d, 's2/server.json.bak-w0')));
  assert.ok(!readFileSync(join(d, 's2/server.json'), 'utf8').includes('/home/ieon'));
  assert.deepEqual(migrateHubData(d), []); // 두 번 돌려도 같다
});

test('프로세스 관리: 서버·연결부·메신저를 띄우고, 하나가 끝나면 그것만 다시 켜며, 멈추면 모두 끈다', async () => {
  assert.deepEqual(hubCommands('/data').map((c) => [c.name, c.args[1]]),
    [['server', '/data/s2/server.json'], ['connector', '/data/s2/connector.json'], ['messenger', '/data/messenger/config.json']]);
  const spawned = [];
  const spawnImpl = (_bin, args) => { const p = new EventEmitter(); p.args = args; p.kill = () => { p.killed = true; }; spawned.push(p); return p; };
  const s = supervise([{ name: 'a', args: ['a.mjs'], delayMs: 0 }, { name: 'b', args: ['b.mjs'], delayMs: 0 }], { spawnImpl, log: () => {}, maxBackoffMs: 20 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(spawned.length, 2);
  spawned[0].emit('exit', 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(spawned.length, 3);
  assert.equal(spawned[2].args[0], 'a.mjs');
  s.stop();
  assert.ok(spawned[1].killed && spawned[2].killed);
});
