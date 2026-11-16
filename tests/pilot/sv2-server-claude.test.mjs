// SV2(SERVER_SESSIONS 2-12, 신산님 2026-11-17 "SV2 칸 안 Claude", 제1원칙): 서버 Claude 로그인은 이어온 화면에서 한 번 — 허브·모든 엔진 칸이 같이 씀.
// 구독(공식 setup-token: 주소 → 승인 → 코드 붙여 넣기)·API 키 둘 다, 값은 화면·응답·로그에 내지 않음. 새 세션을 만들 곳(엔진 칸) 고르기. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { claudeAuthEnv, claudeKind, createClaudeLogin, parseSetupToken, saveClaudeLogin } from '../../src/pilot/claude-login.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { healthHeader } from '../../src/pilot/connector.mjs';

const tmp = (t, p = 'ieon-sv2-') => { const d = mkdtempSync(join(tmpdir(), p)); t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } }); return d; };
const FAKE_TOKEN = 'sk-ant-oat01-' + 'A'.repeat(60);
const FAKE_KEY = 'sk-ant-api03-' + 'B'.repeat(40);

test('같이 쓰는 로그인 → 실행 환경: API 키가 있으면 그것만, 구독 토큰이면 그것만, 폴더가 없으면(PC) 그대로', (t) => {
  const d = tmp(t);
  const base = { PATH: 'x', ANTHROPIC_API_KEY: 'old', CLAUDE_CODE_OAUTH_TOKEN: 'old2' };
  assert.deepEqual(claudeAuthEnv(base, null), base, 'PC는 그 PC의 로그인 그대로');
  assert.deepEqual(claudeAuthEnv(base, d), base, '아직 로그인 없음 — 바꾸지 않음');
  assert.equal(claudeKind(d), null);
  saveClaudeLogin(d, 'subscription', FAKE_TOKEN);
  let e = claudeAuthEnv(base, d);
  assert.deepEqual([e.CLAUDE_CODE_OAUTH_TOKEN, e.ANTHROPIC_API_KEY, e.PATH], [FAKE_TOKEN, undefined, 'x']);
  assert.equal(claudeKind(d), 'subscription');
  saveClaudeLogin(d, 'api', FAKE_KEY);
  e = claudeAuthEnv(base, d);
  assert.deepEqual([e.ANTHROPIC_API_KEY, e.CLAUDE_CODE_OAUTH_TOKEN], [FAKE_KEY, undefined]);
  assert.equal(claudeKind(d), 'api');
  assert.ok(!existsSync(join(d, 'oauth-token')), 'API 키를 넣으면 구독 토큰은 지움(어느 계정인지 하나로)');
  if (process.platform !== 'win32') assert.equal(statSync(join(d, 'api-key')).mode & 0o777, 0o600);
});

test('setup-token 화면에서 주소(터미널 링크 안의 전체 주소)와 토큰을 찾는다', () => {
  const url = 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz';
  const screen = `\x1b[1mWelcome\x1b[0m\r\nBrowser didn't open?\r\n\x1b]8;id=9;${url}\x07${url.slice(0, 30)}\x1b]8;;\x07\r\nPaste code here if prompted >`;
  assert.deepEqual(parseSetupToken(screen), { url, token: null });
  assert.equal(parseSetupToken(screen + `\r\n\x1b[32mYour OAuth token (valid for 1 year):\x1b[0m\r\n${FAKE_TOKEN}\r\n`).token, FAKE_TOKEN);
});

// 가짜 `script -qfc "claude setup-token"`: 주소를 내고, 코드를 받으면 토큰을 낸다
function fakeSetupToken({ url = 'https://claude.ai/oauth/authorize?x=1', token = FAKE_TOKEN } = {}) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null)); };
    calls.push({ cmd, args, env: opts.env, child });
    setImmediate(() => child.stdout.write(`Browser didn't open? Use the url below\r\n\x1b]8;id=1;${url}\x07${url}\x1b]8;;\x07\r\nPaste code here if prompted > `));
    let got = '';
    child.stdin.on('data', (d) => { got += d; if (got.endsWith('\r')) { child.code = got.trim(); setImmediate(() => child.stdout.write(`\r\nYour OAuth token:\r\n${token}\r\n`)); } });
    return child;
  };
  return { calls, spawnImpl };
}
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('구독 로그인: 주소를 보여 주고, 붙여 넣은 코드를 넣으면 토큰을 같이 쓰는 폴더에 저장(화면엔 토큰 없음)', async (t) => {
  const d = tmp(t);
  const fake = fakeSetupToken();
  const logs = [];
  const login = createClaudeLogin({ dir: d, spawnImpl: fake.spawnImpl, log: (e) => logs.push(e) });
  login.start();
  await until(() => login.view().url);
  assert.equal(login.view().url, 'https://claude.ai/oauth/authorize?x=1');
  assert.equal(fake.calls[0].cmd, 'script');
  assert.match(fake.calls[0].args.join(' '), /claude setup-token/);
  assert.notEqual(fake.calls[0].env.HOME, process.env.HOME, '임시 HOME — 서버의 다른 Claude 설정을 건드리지 않음');
  assert.deepEqual(login.code('bad code!'), { error: 'bad_code' });
  login.code('abc123#state456');
  assert.equal(fake.calls[0].child.code, 'abc123#state456');
  await until(() => login.view().state === 'done');
  assert.equal(login.view().state, 'done');
  assert.equal(readFileSync(join(d, 'oauth-token'), 'utf8').trim(), FAKE_TOKEN);
  assert.ok(!JSON.stringify(login.view()).includes('sk-ant'), '화면 응답에 토큰 없음');
  assert.ok(!JSON.stringify(logs).includes('sk-ant') && !JSON.stringify(logs).includes('abc123'), '로그에 토큰·코드 없음');
});

test('기기 관리 명령: 허브(쓸 수 있음)에서 API 키·로그아웃, 같이 쓰는 폴더가 없는 PC는 그 PC 로그인 그대로(바꾸기는 허브에서)', async (t) => {
  const d = tmp(t);
  const hub = createDeviceAdmin({ connectorConfigPath: join(d, 'none.json'), claudeDir: join(d, 'shared') });
  assert.deepEqual((await hub.run('claude.get')).body, { shared: true, canLogin: true, kind: null, login: { state: 'idle' } });
  assert.deepEqual((await hub.run('claude.apikey', { key: 'sk-proj-nope' })).body, { error: 'bad_api_key' });
  const r = await hub.run('claude.apikey', { key: FAKE_KEY });
  assert.deepEqual([r.status, r.body.kind], [200, 'api']);
  assert.ok(!JSON.stringify(r.body).includes('sk-ant'), '응답에 키 없음');
  assert.equal((await hub.run('claude.logout')).body.kind, null);
  // PC: 같이 쓰는 폴더 없음 → 그 PC의 Claude 로그인 그대로
  const pc = createDeviceAdmin({ connectorConfigPath: join(d, 'none.json'), claudeDir: null });
  assert.deepEqual((await pc.run('claude.get')).body.shared, false);
  assert.equal((await pc.run('claude.apikey', { key: FAKE_KEY })).body.error, 'claude_login_on_hub');
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
test('새 세션을 만들 곳(엔진 칸)을 고를 수 있고, 목록에 없는 곳은 거부 · 서버 Claude 계정 종류가 대화에 보이고 서비스 봇 판단에 쓰임', async (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'ns.json'), JSON.stringify({ enabled: true, workspaceRoot: join(d, 'ws') }));
  const app = createApp({ dbPath: join(d, 'p.db'), newSessionsConfigPath: join(d, 'ns.json'), claudeAuthDir: null,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('hub'), hostId: 'h_hub' }, { tokenSha256: sha('cell'), hostId: 'h_cell' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const mk = await call('/v1/sessions', { method: 'POST', body: { engine: 'claude', name: 'law', hostId: 'h_cell' } });
  assert.equal(mk.status, 201);
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'claude', name: 'nope', hostId: 'h_unknown' } })).body.error, 'unknown_host');
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'dflt' } })).status, 201, '고르지 않으면 지금처럼 기본');
  // 칸 연결부가 서버 Claude 로그인 종류를 알림 → 대화의 계정 표시
  await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer cell', 'x-ieon-health': healthHeader({ codexShared: 'not_configured', claudeChannel: 'not_configured', codexAccounts: {}, codexDefault: null, claudeKind: 'subscription' }) } });
  const conv = (await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === mk.body.conversationId);
  assert.deepEqual([conv.account.mode, conv.account.kind], ['hub_login', 'subscription']);
  assert.match(conv.account.label, /같이 씀/);
});
