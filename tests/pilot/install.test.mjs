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
  assert.equal(json(d, 's2/connector.json').live, false);
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
  assert.deepEqual(changes.sort(), ['server:connectorConfigPath', 'server:manageLocalConnector', 'server:manageMessenger', 'server:messengerConfigPath', 'server:secretsFile']);
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
