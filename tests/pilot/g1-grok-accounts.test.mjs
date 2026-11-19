// G1 Grok(신산님 2026-11-20 "grok을 설치하고 테스트만 하면 사용할 수 있어야"): 새 세션(처음 -r 없이 → 받은 세션 ID로 이어 쓰기)과
// 이어온 Grok 계정(API 키 → XAI_API_KEY, 만든 계정으로 계속), 기기 명령·화면 칸. 실제 Grok 호출 0(구독 전 — 실제 시험은 TO_VERIFY).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grokAccountHealth, grokHomeOf, grokRunFor } from '../../src/pilot/grok-accounts.mjs';
import { cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';
import { createDeviceAdmin, HUB_SELF_OPS, OPS } from '../../src/pilot/device-admin.mjs';
import { loadNewSessionsConfig, NEW_ENGINES } from '../../src/pilot/new-sessions.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-g1-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const KEY = 'xai-' + 'k'.repeat(40);

test('실행 준비: PC 기본이면 null, 없는 계정·키 없음은 보내기 전에 거절, 키는 XAI_API_KEY로(원래 값은 지움)', (t) => {
  const d = tmp(t); const dir = join(d, 'acc');
  const c = { grokAccounts: { accounts: [{ id: 'k1', label: '개인' }], defaultAccount: 'k1' } };
  assert.equal(grokRunFor({}, dir, null), null);
  assert.throws(() => grokRunFor(c, dir, 'zz'), /account_missing/);
  mkdirSync(grokHomeOf(dir, 'k1'), { recursive: true });
  assert.throws(() => grokRunFor(c, dir, null), /account_not_logged_in/);
  writeFileSync(join(grokHomeOf(dir, 'k1'), 'api-key'), KEY);
  const r = grokRunFor(c, dir, null, { env: { XAI_API_KEY: 'leak', PATH: 'p' } });
  assert.deepEqual([r.accountId, r.env.XAI_API_KEY, r.env.PATH], ['k1', KEY, 'p']);
});

test('새 세션: 처음은 -r 없이 새 대화, 받은 ID로 적고(계정까지), 다음부터 -r ID — 기본을 바꿔도 만든 계정 키로', async (t) => {
  const root = tmp(t);
  const cfg = loadNewSessionsConfig({ enabled: true, workspaceRoot: root });
  const ids = new Map(); const accs = new Map();
  const created = { has: (id) => ids.has(id), add: (id, name, a) => { ids.set(id, name); if (a) accs.set(id, a); }, account: (id) => accs.get(id) ?? null };
  let def = 'k1'; const runs = [];
  const adapter = cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: [], bin: 'grok', newSessions: { config: cfg, created },
    newEnv: (acc) => { const id = acc ?? def; return id === 'pc_default' ? null : { accountId: id, env: { XAI_API_KEY: 'key-' + id } }; },
    run: async (bin, args, o) => { runs.push({ args, key: o.env.XAI_API_KEY }); return { code: 0, stdout: JSON.stringify({ session_id: 'gs-0001', result: '답' }), stderr: '' }; } });
  const job = (ref) => ({ sessionRef: ref, question: 'q', newSession: { name: 'gk', profile: 'workspace', workspace: join(root, 'gk') } });
  const r = await adapter.run(job('pending:x'));
  assert.deepEqual([r.sessionRef, r.answer, runs[0].args.includes('-r'), runs[0].key, accs.get('gs-0001')], ['gs-0001', '답', false, 'key-k1', 'k1']);
  def = 'k2';
  await adapter.run(job('gs-0001'));
  assert.deepEqual([runs[1].args.slice(-2), runs[1].key], [['-r', 'gs-0001'], 'key-k1']);
  // 만들지 않은 세션 ID는 거절
  await assert.rejects(adapter.run(job('gs-other')), /session_not_allowed/);
});

test('새 세션 엔진·기기 명령·허브 자신 허용·화면 칸', async (t) => {
  assert.equal(NEW_ENGINES.grok, 'grok_cli');
  for (const op of ['grok.accounts.get', 'grok.accounts.add', 'grok.accounts.apikey', 'grok.accounts.logout', 'grok.accounts.delete', 'grok.accounts.use']) { assert.ok(OPS[op], op); assert.ok(HUB_SELF_OPS.has(op), op); }
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, '{}');
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null });
  const add = await pc.run('grok.accounts.add', { label: '회사' });
  assert.equal(add.status, 201); const id = add.body.id;
  assert.equal(typeof add.body.installed, 'boolean');
  assert.equal((await pc.run('grok.accounts.apikey', { id, key: 'short' })).body.error, 'bad_api_key');
  const k = await pc.run('grok.accounts.apikey', { id, key: KEY });
  assert.deepEqual([k.status, k.body.accounts[0].kind], [200, 'api']);
  assert.ok(!JSON.stringify(k.body).includes(KEY), '키는 내지 않음');
  assert.equal((await pc.run('grok.accounts.use', { accountId: id })).body.defaultAccount, id);
  assert.equal((await pc.run('grok.accounts.logout', { id })).body.accounts[0].kind, null);
  assert.equal((await pc.run('grok.accounts.delete', { id })).body.accounts.length, 0);
  const SET = readFileSync(new URL('../../src/pilot/web/settings.html', import.meta.url), 'utf8');
  const APP = readFileSync(new URL('../../src/pilot/web/app.html', import.meta.url), 'utf8');
  assert.ok(SET.includes('id="gkBox"') && SET.includes("acRun('grok.accounts.get')") && SET.includes('id="nsGrok"') && SET.includes('name="rEng" value="grok"'));
  assert.ok(APP.includes('<option value="grok">'));
});

test('상태 보고: Grok 새 세션별 계정 이름표와 기본 이름표', (t) => {
  const d = tmp(t); const f = join(d, 'created.jsonl');
  writeFileSync(f, JSON.stringify({ id: 'gs-0001', name: 'gk', account: 'k1' }) + '\n');
  const h = grokAccountHealth({ grokAccounts: { accounts: [{ id: 'k1', label: '개인' }], defaultAccount: 'k1' }, newSessions: { createdPath: f } });
  assert.deepEqual(h, { grokAccounts: { 'gs-0001': '개인' }, grokDefault: '개인' });
});

// 2026-11-20 실측(Antigravity 1.5.12): 머리 없는 실행에서 허락이 필요한 도구가 자동 거부되면 SUCCESS인데 답이 비어 온다 — 빈 답 대신 이유 한 줄
test('자동 거부로 빈 답이면 이유 한 줄, 그 밖의 빈 답·보통 답은 그대로', async () => {
  const mk = (stdout, stderr) => cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: ['9e943423-0000-4000-8000-0000000000e1'], bin: 'agy', probe: () => 'NO_LOCK_FILE',
    run: async () => ({ code: 0, stdout, stderr }) });
  const id = '9e943423-0000-4000-8000-0000000000e1';
  const ok = JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '' });
  assert.match((await mk(ok, 'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.').run({ sessionRef: id, question: 'q' })).answer, /허락이 필요한 작업이 막혀/);
  assert.equal((await mk(ok, '').run({ sessionRef: id, question: 'q' })).answer, '');
  assert.equal((await mk(JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '답' }), 'auto-denied').run({ sessionRef: id, question: 'q' })).answer, '답');
});
