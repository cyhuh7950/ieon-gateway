// W4: PC 로컬 웹의 기기 설정 — 실제 실행·Codex 허용 목록·작업 폴더. 허브 웹·다른 곳에서는 못 바꾼다(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createLocalConnector, readDevice, upsertCodexThread } from '../../src/pilot/device-settings.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];

function connectorFile(dir) {
  const p = join(dir, 'connector.json');
  writeFileSync(p, JSON.stringify({ serverUrl: 'http://127.0.0.1:1', deviceTokenFile: 'x', live: false,
    codex: { allowlist: [], modes: {}, workingDirectories: {}, shared: { endpoint: 'ws://127.0.0.1:2' } }, claude: { baseUrl: 'http://127.0.0.1:3' } }));
  return p;
}

test('기기 설정 파일: 허용 목록 추가·빼기, 업무 대화·없는 폴더·상대 경로 거절, 다른 항목은 그대로', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w4-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const p = connectorFile(d);
  mkdirSync(join(d, 'work'));
  upsertCodexThread(p, { threadId: T1.toUpperCase(), mode: 'shared_server', workingDirectory: join(d, 'work') });
  const dev = readDevice(p);
  assert.deepEqual(dev.codexThreads, [{ threadId: T1, mode: 'shared_server', workingDirectory: join(d, 'work').replaceAll('\\', '/') }]);
  assert.throws(() => upsertCodexThread(p, { threadId: '01a0dadd-739f-74d2-93c5-9c405cc1019b' }), /excluded_session/);
  assert.throws(() => upsertCodexThread(p, { threadId: 'nope' }), /bad_thread_id/);
  assert.throws(() => upsertCodexThread(p, { threadId: T1, workingDirectory: 'relative/dir' }), /bad_working_directory/);
  assert.throws(() => upsertCodexThread(p, { threadId: T1, workingDirectory: join(d, 'missing') }), /working_directory_missing/);
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(raw.serverUrl, 'http://127.0.0.1:1');
  assert.equal(raw.claude.baseUrl, 'http://127.0.0.1:3');
});

async function pc(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w4s-'));
  const cfg = connectorFile(dir);
  const app = createApp({ dbPath: join(dir, 'pc.db'), users, devices: [], bindings: [], connectorConfigPath: cfg, ...extra });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, xff } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  return { call, cfg, app };
}

test('PC 로컬 웹: 실제 실행 스위치와 허용 목록을 바꾸고(연결부를 이 서버가 띄우지 않으면 다시 시작 필요라고 알림), 앞단을 거친 요청은 바꿀 수 없다', async (t) => {
  const s = await pc(t);
  let r = await s.call('/v1/admin/local/device');
  assert.deepEqual({ ...r.body }, { live: false, codexThreads: [], sharedServer: true, claudeChannel: true, managed: false, running: null,
    codexAccounts: [], codexDefaultAccount: 'pc_default', codexAccountFor: {}, cliSessions: [], claudeAccounts: [], claudeDefaultAccount: 'pc_default', claudeAccountFor: {} }); // A2: 계정 칸, A2-b: Claude 계정
  r = await s.call('/v1/admin/local/device/live', { method: 'PUT', body: { live: true } });
  assert.deepEqual(r.body, { live: true, restarted: false, restartRequired: true });
  assert.equal(JSON.parse(readFileSync(s.cfg, 'utf8')).live, true);
  assert.equal((await s.call('/v1/admin/local/device/live', { method: 'PUT', body: { live: 'yes' } })).body.error, 'bad_live');
  r = await s.call(`/v1/admin/local/device/codex/${T1}`, { method: 'PUT', body: { mode: 'alternate' } });
  assert.equal(r.body.codexThreads[0].threadId, T1);
  assert.equal((await s.call('/v1/admin/local/device/codex/01a0dadd-739f-74d2-93c5-9c405cc1019b', { method: 'PUT', body: {} })).body.error, 'excluded_session');
  // 규칙 점검 4: Tailscale·앞단을 거친 요청도 로그인한 웹 화면이면 바꿀 수 있음
  assert.equal((await s.call('/v1/admin/local/device/live', { method: 'PUT', xff: '100.100.1.2', body: { live: 'yes' } })).body.error, 'bad_live');
  assert.equal((await s.call('/v1/admin/local/device', { xff: '100.100.1.2' })).status, 200);
  r = await s.call(`/v1/admin/local/device/codex/${T1}`, { method: 'DELETE' });
  assert.deepEqual(r.body.codexThreads, []);
});

test('허브에는 기기 설정 화면이 없다(원칙 6), 연결부 설정이 없는 PC는 안내만', async (t) => {
  const hub = await pc(t, { webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  assert.equal((await hub.call('/v1/admin/local/device', { xff: '198.51.100.9' })).status, 404);
  const none = await pc(t, { connectorConfigPath: undefined });
  assert.equal((await none.call('/v1/admin/local/device')).body.error, 'no_connector_config');
});

test('로컬 연결부 관리: 띄우고, 다시 시작하면 끄고 새로 띄우며, 멈추면 다시 띄우지 않는다', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w4c-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const cfg = connectorFile(d);
  const spawned = [];
  const spawnImpl = (_bin, args) => { const p = new EventEmitter(); p.args = args; p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', 0)); }; spawned.push(p); return p; };
  const lc = createLocalConnector({ connectorConfigPath: cfg, spawnImpl });
  assert.equal(lc.start(), true);
  assert.deepEqual(spawned[0].args, ['src/pilot/connector.mjs', cfg]);
  await lc.restart();
  assert.ok(spawned[0].killed);
  assert.equal(spawned.length, 2);
  await lc.stop();
  assert.equal(lc.running(), false);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(spawned.length, 2);
});
