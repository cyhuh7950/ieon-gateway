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
  const SET = koView('settings.html');
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

// --- A2-b 마무리(2026-11-19 신산님 "1번 진행하자"): 대화별 Claude 계정, 어느 계정으로 나가는지 화면·메신저에 표시 ---
import { claudeAccountHealth, claudeAccountId } from '../../src/pilot/claude-accounts.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { createHash } from 'node:crypto';
import { healthHeader } from '../../src/pilot/connector.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음
// I18N-b: 이름표에 붙는 키(labelKey·labelVars)는 빼고 비교 — 키는 i18n-viewer 시험이 확인
const noKey = (a) => a && Object.fromEntries(Object.entries(a).filter(([k]) => k !== "labelKey" && k !== "labelVars"));
const SID = '0b0e0000-0000-4000-8000-0000000000a1';
const SID2 = '0b0e0000-0000-4000-8000-0000000000a2';

test('대화별 Claude 계정: 대화에 고른 것 → 기본 → PC 기본, 실행 환경도 그 계정, 상태 보고는 이름표·종류만', (t) => {
  const d = tmp(t); const dir = join(d, 'acc');
  const c = { claudeAccounts: { accounts: [{ id: 'c1', label: '개인' }, { id: 'c2', label: '회사' }], defaultAccount: 'c1', accountFor: { [SID]: 'c2' } } };
  assert.equal(claudeAccountId(c, SID), 'c2'); assert.equal(claudeAccountId(c, SID2), 'c1'); assert.equal(claudeAccountId(c, null), 'c1');
  for (const id of ['c1', 'c2']) { mkdirSync(claudeHomeOf(dir, id), { recursive: true }); }
  writeFileSync(join(claudeHomeOf(dir, 'c2'), '.credentials.json'), '{}');
  writeFileSync(join(claudeHomeOf(dir, 'c1'), 'api-key'), FAKE_KEY);
  assert.equal(claudeEnvFor(c, dir, { env: {}, ref: SID }).CLAUDE_CONFIG_DIR, claudeHomeOf(dir, 'c2'));
  assert.equal(claudeEnvFor(c, dir, { env: {}, ref: SID2 }).ANTHROPIC_API_KEY, FAKE_KEY);
  assert.deepEqual(claudeAccountHealth(c, dir), { claudeAccounts: { [SID]: '회사' }, claudeAccountKinds: { [SID]: 'subscription' }, claudeDefault: '개인', claudeDefaultKind: 'api' });
  assert.ok(!JSON.stringify(claudeAccountHealth(c, dir)).includes('sk-ant'), '상태 보고에 키가 섞이지 않음');
  assert.deepEqual(claudeAccountHealth({}, dir), { claudeAccounts: {}, claudeAccountKinds: {}, claudeDefault: null, claudeDefaultKind: null });
});

test('기기 명령: 대화별 Claude 계정은 이 PC의 Claude 새 세션·허용 목록 대화만, 기본 따름으로 되돌림, 계정을 지우면 그 선택도 지움', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); mkdirSync(join(d, 'desk'));
  const projects = join(d, 'projects'); mkdirSync(join(projects, 'p'), { recursive: true });
  writeFileSync(join(projects, 'p', `${SID}.jsonl`), JSON.stringify({ type: 'user', cwd: d, message: { role: 'user', content: 'q' } }) + '\n');
  const created = join(d, 'created.jsonl');
  writeFileSync(created, [JSON.stringify({ id: SID, name: '보고서' }), JSON.stringify({ id: SID2, name: 'Codex 새 세션(Claude 기록 없음)' })].join('\n') + '\n');
  const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, JSON.stringify({ newSessions: { createdPath: created } }));
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, claudeDesktop: join(d, 'desk'), claudeProjects: projects, claudeLogoutImpl: async () => true });
  const id = (await pc.run('claude.accounts.add', { label: '회사' })).body.id;
  let g = await pc.run('claude.get');
  assert.deepEqual(g.body.pc.sessions, [{ sessionId: SID, name: '보고서' }], 'Claude 세션 기록이 있는 새 세션만');
  assert.equal((await pc.run('claude.accounts.use', { sessionId: SID2, accountId: id })).body.error, 'session_not_allowed');
  assert.equal((await pc.run('claude.accounts.use', { sessionId: 'nope', accountId: id })).body.error, 'bad_session_id');
  assert.deepEqual((await pc.run('claude.accounts.use', { sessionId: SID, accountId: id })).body.accountFor, { [SID]: id });
  assert.deepEqual((await pc.run('claude.accounts.use', { sessionId: SID, accountId: 'inherit' })).body.accountFor, {});
  await pc.run('claude.accounts.use', { sessionId: SID, accountId: id });
  assert.deepEqual((await pc.run('claude.accounts.delete', { id })).body.accountFor, {}, '지운 계정을 가리키는 대화 선택은 지움');
});

test('Claude 실행: 대화별 계정을 묻는 열쇠는 세션 ID(처음 질문 전의 새 세션은 기본)', async (t) => {
  const d = tmp(t); const cwd = join(d, 'w'); mkdirSync(cwd);
  const refs = [];
  const run = async () => ({ code: 0, stdout: JSON.stringify({ session_id: SID, subtype: 'success', result: 'ok', usage: {} }), stopped: false });
  const a = claudeCliAdapter({ live: true, spawnClaude: run, allowlist: [SID], workingDirectories: { [SID]: cwd }, busy: () => 'free', accountEnv: (ref) => { refs.push(ref); return null; } });
  await a.run({ sessionRef: SID, question: 'q' });
  assert.deepEqual(refs, [SID]);
});

test('표시: 연결부가 알려 준 Claude 계정이 대화 목록의 계정 이름(대화별 → 기본), 채널 창은 새로 여는 창의 계정을 덧붙임', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-a2b-show-'));
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const app = createApp({ dbPath: join(d, 'p.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('pc'), hostId: 'h_pc' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  for (const [cid, ref, engine] of [['c_cl1', SID, 'claude_cli'], ['c_cl2', SID2, 'claude_cli'], ['c_ch', 'chan1', 'claude_channel']]) {
    assert.equal(app.store.saveBinding('u_sinsan', { conversationId: cid, label: cid, engine, hostId: 'h_pc', sessionRef: ref, appIds: ['app_web'] }).http, 200, cid);
  }
  const health = { claudeAccounts: { [SID]: '회사' }, claudeAccountKinds: { [SID]: 'subscription' }, claudeDefault: '개인', claudeDefaultKind: 'api' };
  await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer pc', 'x-ieon-health': healthHeader({ codexShared: 'not_configured', claudeChannel: 'up', codexAccounts: {}, codexDefault: null, ...health }) } });
  const list = await fetch(base + '/v1/conversations', { headers: { authorization: 'Bearer web' } }).then((r) => r.json());
  const acc = Object.fromEntries(list.conversations.map((c) => [c.conversationId, noKey(c.account)]));
  assert.deepEqual(acc.c_cl1, { mode: 'ieon_login', label: '이어온 계정 회사', kind: 'subscription' });
  assert.deepEqual(acc.c_cl2, { mode: 'ieon_login', label: '이어온 계정 개인', kind: 'api' });
  assert.match(acc.c_ch.label, /새로 여는 창은 이어온 계정 개인/);
});
