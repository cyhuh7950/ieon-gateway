// W6: 설치 1회 — 설정 준비(처음·기존), 자식 프로세스 부모 감시, 설치 스크립트 미리보기(모델 0, 시스템 변경 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initLocal, prepareWebFirst } from '../../scripts/ieon-init.mjs';
import { watchParent } from '../../src/pilot/parent-watch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-w6-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const json = (d, p) => JSON.parse(readFileSync(join(d, '.local', p), 'utf8'));

test('처음 설치: 설정·내부 토큰을 만들고, 서버가 연결부·메신저를 띄우며 봇 토큰은 웹 입력 파일로', (t) => {
  const d = tmp(t);
  const changes = prepareWebFirst(d);
  assert.ok(changes.includes('created:s2/server.json') && changes.includes('created:messenger/config.json'));
  const s = json(d, 's2/server.json');
  const posix = d.replaceAll('\\', '/');
  assert.equal(s.connectorConfigPath, `${posix}/.local/s2/connector.json`);
  assert.equal(s.manageLocalConnector, true);
  assert.equal(s.manageMessenger, true);
  assert.equal(s.secretsFile, `${posix}/.local/messenger/bots.env`);
  const msg = readFileSync(join(d, '.local/messenger/token'), 'utf8');
  assert.equal(s.users.find((u) => u.appId === 'app_messenger').tokenSha256, createHash('sha256').update(msg).digest('hex'));
  assert.equal(json(d, 'messenger/config.json').envFile, s.secretsFile);
  assert.match(readFileSync(join(d, '.local/messenger/bots.env'), 'utf8'), /^# 봇 토큰은 웹 화면/);
  assert.equal(json(d, 's2/connector.json').live, true, '규칙 점검 5: AI 응답은 켠 채로 설치');
  if (process.platform !== 'win32') assert.equal(statSync(join(d, '.local/messenger/bots.env')).mode & 0o077, 0);
  assert.deepEqual(prepareWebFirst(d), []); // 다시 해도 바뀌는 것 없음
});

test('기존 설치 업데이트: 있던 토큰·메신저 설정·봇 토큰 파일 위치는 그대로 두고 빠진 항목만 보탠다', (t) => {
  const d = tmp(t);
  initLocal(d);
  const userToken = readFileSync(join(d, '.local/s2/user-token'), 'utf8');
  mkdirSync(join(d, '.local/messenger'), { recursive: true });
  writeFileSync(join(d, '.local/messenger/config.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:28760', envFile: 'D:/x/.local/old.env' }));
  const before = json(d, 's2/server.json');
  const changes = prepareWebFirst(d);
  assert.deepEqual(changes.sort(), ['connector:claude', 'created:c1/.mcp.json', 'created:c1/token', 'server:connectorConfigPath', 'server:manageLocalConnector', 'server:manageMessenger', 'server:messengerConfigPath', 'server:secretsFile']);
  const s = json(d, 's2/server.json');
  assert.equal(s.secretsFile, 'D:/x/.local/old.env'); // 기존 메신저가 쓰던 파일
  assert.deepEqual(s.users, before.users);
  assert.equal(readFileSync(join(d, '.local/s2/user-token'), 'utf8'), userToken);
  assert.ok(!existsSync(join(d, '.local/messenger/token')));
});

test('부모 감시: 부모 PID가 없으면 아무것도 안 하고, 부모가 사라지면 끝낸다', async () => {
  assert.equal(watchParent({ env: {} }), null);
  let exited = false; let alive = true;
  watchParent({ env: { IEON_PARENT_PID: '12345' }, intervalMs: 10, alive: () => alive, exit: () => { exited = true; } });
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(exited, false);
  alive = false;
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(exited, true);
});

test('설치 스크립트: 문법 오류 없고, 미리보기는 아무것도 바꾸지 않는다', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'scripts/install.ps1'), '-DryRun'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ieon-gateway/);
  const u = spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'scripts/install.ps1'), '-Uninstall', '-DryRun'], { encoding: 'utf8' });
  assert.equal(u.status, 0, u.stderr);
});

test('부품 확인: 잠금 파일과 설치된 부품을 비교한다(선택 부품은 없어도 됨)', async (t) => {
  const { depsState } = await import('../../scripts/deps-check.mjs');
  const d = tmp(t);
  const a = 'node_modules/a';
  const opt = 'node_modules/other-os';
  const lock = (packages) => writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ packages: { '': { name: 'x' }, ...packages } }));
  const installed = (packages) => writeFileSync(join(d, 'node_modules/.package-lock.json'), JSON.stringify({ packages }));
  lock({ [a]: { version: '1.0.0' }, [opt]: { version: '1.0.0', optional: true } });
  assert.equal(depsState(d), 'install');
  mkdirSync(join(d, a), { recursive: true });
  installed({ [a]: { version: '1.0.0' } });
  assert.equal(depsState(d), 'ok');
  lock({ [a]: { version: '2.0.0' } });
  assert.equal(depsState(d), 'stale', '버전이 바뀜');
  lock({ [a]: { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' } });
  assert.equal(depsState(d), 'stale', '부품이 늘어남');
  lock({});
  assert.equal(depsState(d), 'stale', '부품이 줄어듦');
  lock({ [a]: { version: '1.0.0' } });
  rmSync(join(d, a), { recursive: true });
  assert.equal(depsState(d), 'stale', '폴더가 지워짐');
});

test('설치 스크립트: 부품이 없으면 미리보기에서 설치가 필요하다고 알리고 아무것도 설치하지 않는다', { skip: process.platform !== 'win32' }, (t) => {
  const d = tmp(t);
  mkdirSync(join(d, 'scripts'));
  for (const f of ['scripts/install.ps1', 'scripts/deps-check.mjs', 'package-lock.json']) writeFileSync(join(d, f), readFileSync(join(root, f)));
  const r = spawnSync('pwsh', ['-NoProfile', '-File', join(d, 'scripts/install.ps1'), '-DryRun'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /npm ci/);
  assert.ok(!existsSync(join(d, 'node_modules')));
});

test('공개 중계 비밀 파일이 있으면 카카오 중계 PC 토큰을 내부에서 채운다(값 출력 없음)', async (t) => {
  const { readEnvFile } = await import('../../src/pilot/secrets-file.mjs');
  const d = tmp(t);
  mkdirSync(join(d, '.local', 'relay'), { recursive: true });
  writeFileSync(join(d, '.local/relay/relay.secrets'), 'IEON_RELAY_PC_TOKEN=pc-token-0123456789abcdef\nIEON_RELAY_KAKAO_SECRET=s\n');
  const changes = prepareWebFirst(d);
  assert.ok(changes.includes('secrets:KAKAO_RELAY_TOKEN'));
  assert.ok(!changes.join(' ').includes('pc-token'));
  assert.equal(readEnvFile(join(d, '.local/messenger/bots.env')).KAKAO_RELAY_TOKEN, 'pc-token-0123456789abcdef');
  assert.deepEqual(prepareWebFirst(d), []);
});