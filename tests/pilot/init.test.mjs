// scripts/ieon-init.mjs 시험(모델 호출 없음, 임시 폴더만 사용).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initLocal } from '../../scripts/ieon-init.mjs';
import { buildAdapters } from '../../src/pilot/adapters/index.mjs';
import { loadNewSessionsConfig } from '../../src/pilot/new-sessions.mjs';
import { openStore } from '../../src/pilot/store.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-init-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const read = (d, p) => readFileSync(join(d, '.local', p), 'utf8');

test('토큰·설정을 만들고 서버에는 토큰 해시만 적는다', (t) => {
  const d = tmp(t);
  const made = initLocal(d);
  assert.ok(made.includes('s2/server.json'));
  const server = JSON.parse(read(d, 's2/server.json'));
  assert.equal(server.users[0].tokenSha256, createHash('sha256').update(read(d, 's2/user-token')).digest('hex'));
  assert.equal(server.devices[0].tokenSha256, createHash('sha256').update(read(d, 's2/device-token')).digest('hex'));
  assert.match(read(d, 's2/user-token'), /^[0-9a-f]{64}$/);
  assert.notEqual(read(d, 's2/user-token'), read(d, 's2/device-token'));
  // 서버 설정 어디에도 토큰 원문이 없다.
  for (const f of ['s2/server.json', 's2/connector.json', 'new-sessions.json']) {
    assert.ok(!read(d, f).includes(read(d, 's2/user-token')) && !read(d, f).includes(read(d, 's2/device-token')), f);
  }
  if (process.platform !== 'win32') assert.equal(statSync(join(d, '.local/s2/user-token')).mode & 0o077, 0); // 소유자만 읽기
});

test('만든 설정이 실제 서버·연결부 코드가 받아들이는 형식이다(live 꺼짐, 기존 세션 없음, 메신저 설정 없음)', (t) => {
  const d = tmp(t);
  initLocal(d);
  const connector = JSON.parse(read(d, 's2/connector.json'));
  assert.equal(connector.live, false);
  const ns = loadNewSessionsConfig(JSON.parse(read(d, 'new-sessions.json')));
  assert.equal(ns.enabled, true);
  openStore(join(d, 'pilot.db')).close(); // 열리는지만 확인하고 바로 닫는다(Windows는 열린 파일을 지울 수 없다)
  const server = JSON.parse(read(d, 's2/server.json'));
  assert.deepEqual(server.bindings, []);
  assert.equal(server.extraHosts, undefined); // 127.0.0.1 전용
  assert.equal(existsSync(join(d, '.local/messenger')), false);
  return buildAdapters(connector).then((a) => assert.deepEqual(Object.keys(a).sort(), ['claude_channel', 'claude_cli', 'codex_thread']));
});

test('이미 설정이 있으면 거부하고 기존 토큰을 바꾸지 않는다', (t) => {
  const d = tmp(t);
  initLocal(d);
  const before = read(d, 's2/user-token');
  assert.throws(() => initLocal(d), /already_initialized/);
  assert.equal(read(d, 's2/user-token'), before);
});

test('CLI는 토큰 값을 출력하지 않고, 두 번째 실행은 종료 코드 1', (t) => {
  const d = tmp(t);
  const script = fileURLToPath(new URL('../../scripts/ieon-init.mjs', import.meta.url));
  const a = spawnSync('node', [script, d], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.ok(!(a.stdout + a.stderr).includes(read(d, 's2/user-token')));
  const b = spawnSync('node', [script, d], { encoding: 'utf8' });
  assert.equal(b.status, 1);
  assert.match(b.stderr, /이미 있습니다/);
});

test('기존 파일이 일부 남아 있어도 덮어쓰지 않는다(wx)', (t) => {
  const d = tmp(t);
  initLocal(d);
  rmSync(join(d, '.local/s2/server.json'));
  writeFileSync(join(d, '.local/new-sessions.json'), '{"enabled":false}');
  assert.throws(() => initLocal(d));
  assert.equal(read(d, 'new-sessions.json'), '{"enabled":false}');
});
