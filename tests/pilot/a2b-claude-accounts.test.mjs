// A2-b(신산님 2026-11-19 "PC마다 여러 개"): PC의 이어온 전용 Claude 계정 — 계정 폴더(CLAUDE_CONFIG_DIR) + 세션 기록 연결,
// 공식 claude auth login(주소·코드)·API 키, 엔진 기본 고르기, 실행 환경(구독/API가 섞이지 않게), 서버는 같이 쓰는 로그인 그대로. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeEnvFor, createClaudeAccountLogin, createClaudeHome, removeClaudeHome, claudeHomeOf } from '../../src/pilot/claude-accounts.mjs';
import { createDeviceAdmin, OPS } from '../../src/pilot/device-admin.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-a2b-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const FAKE_KEY = 'sk-ant-api03-' + 'x'.repeat(40);

test('계정 폴더: 세션 기록(projects)은 원래 Claude 폴더와 같은 곳, 지워도 원래 기록은 남음', (t) => {
  const d = tmp(t); const desktop = join(d, 'desk'); mkdirSync(join(desktop, 'projects', 'p1'), { recursive: true });
  writeFileSync(join(desktop, 'projects', 'p1', 's.jsonl'), 'x');
  const home = createClaudeHome(join(d, 'acc'), 'c1', { desktop });
  assert.ok(existsSync(join(home, 'projects', 'p1', 's.jsonl')), '계정 폴더에서 같은 세션 기록이 보임');
  assert.throws(() => createClaudeHome(join(d, 'acc'), 'c1', { desktop }), /account_exists/);
  removeClaudeHome(join(d, 'acc'), 'c1');
  assert.ok(!existsSync(home));
  assert.ok(existsSync(join(desktop, 'projects', 'p1', 's.jsonl')), '원래 세션 기록은 그대로');
});

test('실행 환경: PC 기본이면 그대로, 구독은 그 계정 폴더(API 키 변수 지움), API 키는 키만, 로그인 전·없는 계정은 보내기 전에 거절', (t) => {
  const d = tmp(t); const dir = join(d, 'acc');
  const env = { PATH: 'p', ANTHROPIC_API_KEY: 'leak', CLAUDE_CODE_OAUTH_TOKEN: 'leak2' };
  assert.equal(claudeEnvFor({}, dir, { env }), null);
  const c = { claudeAccounts: { accounts: [{ id: 'c1', label: '개인' }], defaultAccount: 'c1' } };
  assert.throws(() => claudeEnvFor({ claudeAccounts: { accounts: [], defaultAccount: 'c9' } }, dir, { env }), /account_missing/);
  mkdirSync(claudeHomeOf(dir, 'c1'), { recursive: true });
  assert.throws(() => claudeEnvFor(c, dir, { env }), /account_not_logged_in/);
  writeFileSync(join(claudeHomeOf(dir, 'c1'), '.credentials.json'), '{}');
  const sub = claudeEnvFor(c, dir, { env });
  assert.equal(sub.CLAUDE_CONFIG_DIR, claudeHomeOf(dir, 'c1'));
  assert.ok(!('ANTHROPIC_API_KEY' in sub) && !('CLAUDE_CODE_OAUTH_TOKEN' in sub), '구독일 때 키 변수로 새지 않음');
  writeFileSync(join(claudeHomeOf(dir, 'c1'), 'api-key'), FAKE_KEY + '\n');
  const api = claudeEnvFor(c, dir, { env });
  assert.equal(api.ANTHROPIC_API_KEY, FAKE_KEY);
  assert.ok(!('CLAUDE_CONFIG_DIR' in api) && !('CLAUDE_CODE_OAUTH_TOKEN' in api));
});

function fakeSpawn(home) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { written: '', write(s) { this.written += s; } }; child.kill = () => {};
    calls.push({ cmd, args, env: opts.env, child });
    setImmediate(() => child.stdout.emit('data', 'Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&x=1\nPaste code here if prompted > '));
    return child;
  };
  return { spawnImpl, calls, finish: (code = 0) => { writeFileSync(join(home, '.credentials.json'), '{}'); calls.at(-1).child.emit('close', code); } };
}

test('로그인: 공식 claude auth login을 그 계정 폴더로 띄워 주소를 보이고, 코드를 넣고, 끝나면 로그인됨', async (t) => {
  const d = tmp(t); const home = join(d, 'h'); mkdirSync(home);
  const f = fakeSpawn(home);
  const login = createClaudeAccountLogin({ home, spawnImpl: f.spawnImpl });
  login.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.calls[0].args, ['auth', 'login', '--claudeai']);
  assert.equal(f.calls[0].env.CLAUDE_CONFIG_DIR, home);
  assert.match(login.view().url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
  assert.equal(login.code('x').error, 'bad_code');
  assert.equal(login.code('abcDEF123#state-1').codeSent, true);
  assert.equal(f.calls[0].child.stdin.written, 'abcDEF123#state-1\n');
  f.finish(0);
  assert.equal(login.view().state, 'done');
});

test('기기 명령: Claude 계정 추가·로그인·코드·API 키·기본 고르기·지우기, 서버(같이 쓰는 로그인)에서는 거절, 화면이 모든 명령을 씀', async (t) => {
  const d = tmp(t); const cfg = join(d, 's2', 'connector.json'); mkdirSync(join(d, 's2'));
  writeFileSync(cfg, JSON.stringify({})); mkdirSync(join(d, 'desk'));
  const logins = []; const outs = [];
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, claudeDesktop: join(d, 'desk'),
    claudeAccountLogin: (home) => { const s = { state: 'idle', home, codes: [] }; logins.push(s); return { start() { s.state = 'waiting'; }, code(v) { s.codes.push(v); return {}; }, cancel() { s.state = 'cancelled'; }, view() { return { state: s.state }; } }; },
    claudeLogoutImpl: async (home) => { outs.push(home); rmSync(join(home, '.credentials.json'), { force: true }); rmSync(join(home, 'api-key'), { force: true }); return true; } });
  assert.equal((await pc.run('claude.accounts.add', { label: '' })).body.error, 'bad_label');
  const add = await pc.run('claude.accounts.add', { label: '회사' });
  assert.equal(add.status, 201);
  const id = add.body.id;
  const home = join(d, 'accounts', 'claude', id);
  assert.ok(existsSync(join(home, 'projects')), '계정 폴더·세션 연결이 생김');
  let g = await pc.run('claude.get');
  assert.deepEqual(g.body.pc.accounts.map((a) => [a.label, a.kind]), [['회사', null]]);
  assert.equal(g.body.pc.defaultAccount, 'pc_default');
  assert.equal((await pc.run('claude.accounts.login', { id })).status, 200);
  assert.equal(logins[0].home, home);
  await pc.run('claude.accounts.code', { id, code: 'abcdefgh' }); assert.deepEqual(logins[0].codes, ['abcdefgh']);
  assert.equal((await pc.run('claude.accounts.login', { id: 'nope' })).status, 404);
  assert.equal((await pc.run('claude.accounts.apikey', { id, key: 'bad' })).body.error, 'bad_api_key');
  assert.equal((await pc.run('claude.accounts.apikey', { id, key: FAKE_KEY })).body.accounts[0].kind, 'api');
  assert.equal(readFileSync(join(home, 'api-key'), 'utf8').trim(), FAKE_KEY);
  assert.equal((await pc.run('claude.accounts.use', { accountId: 'zz' })).body.error, 'bad_account');
  assert.equal((await pc.run('claude.accounts.use', { accountId: id })).body.defaultAccount, id);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).claudeAccounts.defaultAccount, id);
  assert.equal((await pc.run('claude.accounts.logout', { id })).body.accounts[0].kind, null);
  const del = await pc.run('claude.accounts.delete', { id });
  assert.equal(del.status, 200);
  assert.deepEqual([del.body.accounts, del.body.defaultAccount], [[], 'pc_default'], '지우면 기본은 PC 기본 로그인으로');
  assert.ok(!existsSync(home));
  // 서버(허브·칸): 같이 쓰는 로그인 하나 — PC 계정 명령은 거절
  const server = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: join(d, 'shared') });
  assert.equal((await server.run('claude.accounts.add', { label: 'x' })).body.error, 'claude_shared_login');
  assert.equal((await server.run('claude.get')).body.pc, undefined);
  const SET = readFileSync(new URL('../../src/pilot/web/settings.html', import.meta.url), 'utf8');
  for (const op of Object.keys(OPS).filter((o) => o.startsWith('claude.accounts.'))) assert.ok(SET.includes(`Run('${op}'`), op);
});

test('Claude 실행: 고른 계정의 환경으로, 로그인 전이면 실행하지 않고 거절', async (t) => {
  const d = tmp(t); const cwd = join(d, 'w'); mkdirSync(cwd);
  const ID = '0b0e0000-0000-4000-8000-000000000001';
  const runs = [];
  const run = async (args, input, o) => { runs.push(o.env ?? null); return { code: 0, stdout: JSON.stringify({ session_id: ID, subtype: 'success', result: 'ok', usage: {} }), stopped: false }; };
  const ok = claudeCliAdapter({ live: true, spawnClaude: run, allowlist: [ID], workingDirectories: { [ID]: cwd }, busy: () => 'free', accountEnv: () => ({ CLAUDE_CONFIG_DIR: 'acc' }) });
  await ok.run({ sessionRef: ID, question: 'q' });
  assert.equal(runs[0].CLAUDE_CONFIG_DIR, 'acc');
  const pcDefault = claudeCliAdapter({ live: true, spawnClaude: run, allowlist: [ID], workingDirectories: { [ID]: cwd }, busy: () => 'free', accountEnv: () => null });
  await pcDefault.run({ sessionRef: ID, question: 'q' });
  assert.equal(runs[1], null, 'PC 기본이면 지금처럼(환경을 바꾸지 않음)');
  const notIn = claudeCliAdapter({ live: true, spawnClaude: run, allowlist: [ID], workingDirectories: { [ID]: cwd }, busy: () => 'free',
    accountEnv: () => { throw Object.assign(new Error('account_not_logged_in'), { http: 409 }); } });
  await assert.rejects(notIn.run({ sessionRef: ID, question: 'q' }), (e) => e.code === 'account_not_logged_in' || e.message === 'account_not_logged_in');
  assert.equal(runs.length, 2, '거절할 때는 Claude를 부르지 않음');
});

test('채널 창(ieon.ps1 claude): 고른 계정으로 연다(구독은 계정 폴더, API 키는 키, 로그인 전이면 열지 않음)', () => {
  const ps = readFileSync(new URL('../../scripts/ieon.ps1', import.meta.url), 'utf8');
  assert.ok(ps.includes('$cfg.claudeAccounts.defaultAccount') && ps.includes('`$env:CLAUDE_CONFIG_DIR') && ps.includes('`$env:ANTHROPIC_API_KEY = (Get-Content -Raw'));
  assert.ok(ps.includes("($pre + 'claude --dangerously-load-development-channels server:ieon')"));
});
