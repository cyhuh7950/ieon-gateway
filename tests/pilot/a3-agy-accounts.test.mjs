// A3 Antigravity 계정(신산님 2026-11-19 "새 세션 범위로 만들기"): 계정 = 로그인 폴더(--gemini-dir), 새 세션은 그 폴더에서 ACP로 만들고
// 계속 그 계정으로(기본을 바꿔도), 기존 대화·PC 기본은 지금처럼. API 키는 ACP authenticate(gemini-api-key), 구독은 oauth-personal. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyHomeOf, agyRunFor } from '../../src/pilot/agy-accounts.mjs';
import { acpTurn } from '../../src/pilot/adapters/acp.mjs';
import { cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';
import { createDeviceAdmin, OPS } from '../../src/pilot/device-admin.mjs';
import { loadNewSessionsConfig } from '../../src/pilot/new-sessions.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-a3-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const KEY = 'AIza' + 'k'.repeat(35);
const NEW = '9e943423-0000-4000-8000-0000000000d1';

test('실행 준비: PC 기본이면 null, 없는 계정·로그인 전은 보내기 전에 거절, API 키·구독은 그 계정 폴더와 인증 방식', (t) => {
  const d = tmp(t); const dir = join(d, 'acc');
  const c = { agyAccounts: { accounts: [{ id: 'g1', label: '개인' }, { id: 'g2', label: '회사' }], defaultAccount: 'g1' } };
  assert.equal(agyRunFor({}, dir, null), null);
  assert.throws(() => agyRunFor(c, dir, 'zz'), /account_missing/);
  mkdirSync(agyHomeOf(dir, 'g1'), { recursive: true }); mkdirSync(agyHomeOf(dir, 'g2'), { recursive: true });
  assert.throws(() => agyRunFor(c, dir, null), /account_not_logged_in/);
  writeFileSync(join(agyHomeOf(dir, 'g1'), 'api-key'), KEY);
  const r = agyRunFor(c, dir, null, { env: { GOOGLE_API_KEY: 'leak' } });
  assert.deepEqual([r.accountId, r.geminiDir, r.authMethod, r.env.GEMINI_API_KEY, 'GOOGLE_API_KEY' in r.env], ['g1', agyHomeOf(dir, 'g1'), 'gemini-api-key', KEY, false]);
  writeFileSync(join(agyHomeOf(dir, 'g2'), 'kind'), 'subscription\n');
  const s = agyRunFor(c, dir, 'g2', { env: { GEMINI_API_KEY: 'leak' } });
  assert.deepEqual([s.authMethod, 'GEMINI_API_KEY' in s.env], ['oauth-personal', false]);
});

test('ACP 새 대화: 계정 폴더로 띄우고 인증 → session/new → 권한에 맞는 방식 → 질문, 새 대화 ID를 돌려줌', async () => {
  const seen = [];
  const spawnImpl = (bin, args) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stderr.resume = () => {}; child.kill = () => setImmediate(() => child.emit('close', 0));
    const out = (m) => setImmediate(() => child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'));
    child.stdin = { end() {}, write(s) { for (const l of String(s).split('\n').filter(Boolean)) { const m = JSON.parse(l); seen.push(m);
      if (m.method === 'initialize') out({ id: m.id, result: { agentCapabilities: { sessionCapabilities: { resume: {} } } } });
      else if (m.method === 'authenticate') out({ id: m.id, result: {} });
      else if (m.method === 'session/new') out({ id: m.id, result: { sessionId: NEW, modes: { availableModes: [{ id: 'plan' }, { id: 'accept-edits' }], currentModeId: 'plan' } } });
      else if (m.method === 'session/set_mode') out({ id: m.id, result: {} });
      else if (m.method === 'session/prompt') { out({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '확인' } } } }); out({ id: m.id, result: { stopReason: 'end_turn' } }); } } } };
    seen.args = args; return child;
  };
  const r = await acpTurn({ bin: 'agy', cwd: 'D:/w/ag', question: 'q', geminiDir: 'D:/acc/agy/g1', authMethod: 'gemini-api-key', newSession: true, mode: 'accept-edits', spawnImpl });
  assert.deepEqual([r.answer, r.sessionId], ['확인', NEW]);
  assert.deepEqual(seen.args, ['acp', '--gemini-dir', 'D:/acc/agy/g1', '--disable-telemetry']);
  assert.deepEqual(seen.map((m) => m.method).filter(Boolean), ['initialize', 'authenticate', 'session/new', 'session/set_mode', 'session/prompt']);
  assert.equal(seen.find((m) => m.method === 'authenticate').params.methodId, 'gemini-api-key');
  assert.equal(seen.find((m) => m.method === 'session/set_mode').params.modeId, 'accept-edits');
});

test('Antigravity 새 세션: 기본 계정이면 ACP로 만들고 그 계정을 적어 둠, 다음엔 그 계정으로 이어 감(기본을 바꿔도), PC 기본이면 지금처럼 한 번 실행', async (t) => {
  const root = tmp(t);
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: root });
  const ids = new Map(); const accs = new Map();
  const created = { has: (id) => ids.has(id), add: (id, name, a) => { ids.set(id, name); if (a) accs.set(id, a); }, account: (id) => accs.get(id) ?? null };
  let def = 'g1'; const asked = []; const acpCalls = []; const runs = [];
  const adapter = cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [], bin: 'agy', probe: () => 'NO_LOCK_FILE', newSessions: { config: cfg, created },
    agyRun: (acc) => { asked.push(acc); const id = acc ?? def; return id === 'pc_default' ? null : { accountId: id, geminiDir: 'G/' + id, authMethod: 'gemini-api-key', env: {} }; },
    acp: async (o) => { acpCalls.push(o); return { answer: '답', sessionId: o.newSession ? NEW : o.sessionId }; },
    run: async (bin, args) => { runs.push(args); return { code: 0, stdout: JSON.stringify({ conversation_id: NEW, status: 'SUCCESS', response: 'p답' }), stderr: '' }; } });
  const job = (ref) => ({ sessionRef: ref, question: 'q', newSession: { name: 'ag', profile: 'workspace', workspace: join(root, 'ag') } });
  const r = await adapter.run(job('pending:x'));
  assert.deepEqual([r.sessionRef, acpCalls[0].newSession, acpCalls[0].geminiDir, acpCalls[0].mode, accs.get(NEW)], [NEW, true, 'G/g1', 'accept-edits', 'g1']);
  def = 'g2'; // 기본을 바꿔도 이미 만든 새 세션은 만든 계정으로
  await adapter.run(job(NEW));
  assert.deepEqual([asked.at(-1), acpCalls[1].geminiDir, acpCalls[1].newSession, acpCalls[1].sessionId], ['g1', 'G/g1', false, NEW]);
  assert.equal(runs.length, 0);
  // PC 기본 계정이면 지금처럼 -p
  const ids2 = new Map(); const created2 = { has: (id) => ids2.has(id), add: (id, n) => ids2.set(id, n), account: () => null };
  const p = cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [], bin: 'agy', probe: () => 'NO_LOCK_FILE', newSessions: { config: cfg, created: created2 }, agyRun: () => null,
    acp: async () => { throw new Error('ACP를 쓰면 안 됨'); }, run: async (bin, args) => { runs.push(args); return { code: 0, stdout: JSON.stringify({ conversation_id: NEW, status: 'SUCCESS', response: 'p답' }), stderr: '' }; } });
  assert.equal((await p.run(job('pending:y'))).answer, 'p답');
});

test('기기 명령: Antigravity 계정 추가·API 키·구독 로그인·기본 고르기·로그아웃·지우기, 화면이 모든 명령을 씀', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, '{}');
  const logins = [];
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, agyLogin: (home) => { const s = { state: 'idle', home }; logins.push(s); return { start() { s.state = 'waiting'; }, cancel() { s.state = 'cancelled'; }, view: () => ({ state: s.state }) }; } });
  const id = (await pc.run('agy.accounts.add', { label: '회사' })).body.id;
  const home = join(d, 'accounts', 'agy', id);
  assert.ok(existsSync(home));
  assert.equal((await pc.run('agy.accounts.apikey', { id, key: 'x' })).body.error, 'bad_api_key');
  assert.equal((await pc.run('agy.accounts.apikey', { id, key: KEY })).body.accounts[0].kind, 'api');
  assert.equal(readFileSync(join(home, 'api-key'), 'utf8').trim(), KEY);
  await pc.run('agy.accounts.login', { id }); assert.equal(logins[0].home, home);
  assert.equal((await pc.run('agy.accounts.use', { accountId: id })).body.defaultAccount, id);
  assert.equal((await pc.run('agy.accounts.logout', { id })).body.accounts[0].kind, null);
  const del = await pc.run('agy.accounts.delete', { id });
  assert.deepEqual([del.body.accounts, del.body.defaultAccount, existsSync(home)], [[], 'pc_default', false]);
  const SET = readFileSync(new URL('../../src/pilot/web/settings.html', import.meta.url), 'utf8');
  for (const op of Object.keys(OPS).filter((o) => o.startsWith('agy.accounts.'))) assert.ok(SET.includes(`Run('${op}'`), op);
});
