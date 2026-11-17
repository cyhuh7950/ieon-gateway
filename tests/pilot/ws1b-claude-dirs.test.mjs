// WS1-b(신산님 2026-11-18 "WS1-b 진행", 설계 WORKSPACES 2-4·3-1): Claude(서버 기존 대화·새 세션)에 붙인 폴더를 --add-dir로 더하고,
// 공유(읽기만)는 --settings의 Edit 거부 규칙으로 고치기를 막는다(--restricted가 그 밖 파일 도구를 막음 — WS0 실측). 새 세션에도 공유 폴더를 붙인다
// (개인 폴더는 자동 작업 폴더, 기기에는 "new:<이름>"), Codex 새 세션은 공유(쓰기)를 additionalDirectories로. 막는 정도는 Claude=차단, full 권한=정리만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { addFolder, attachWorkspace, workspaceFor, claudeDirArgs, rulePath, blockLevel, workspacesView } from '../../src/pilot/workspaces.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { buildAdapters } from '../../src/pilot/adapters/index.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { HUB_SELF_OPS } from '../../src/pilot/device-admin.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const A = '11111111-2222-4333-8444-555555555555';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const fwd = (p) => p.replaceAll('\\', '/');
function dirs(t) {
  mkdirSync(join(ROOT, '.local'), { recursive: true });
  const d = mkdtempSync(join(ROOT, '.local', 'ws1b-'));
  t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } });
  for (const n of ['law', 'shared', 'docs']) mkdirSync(join(d, n));
  return d;
}

test('Claude 인자: 붙인 폴더는 --add-dir, 읽기만 공유는 Edit 거부 규칙(Windows·리눅스 경로 형식), 막는 정도', () => {
  assert.equal(rulePath('D:\\staff\\docs\\'), '//d/staff/docs/**');
  assert.equal(rulePath('/data/workspaces/docs'), '//data/workspaces/docs/**');
  assert.deepEqual(claudeDirArgs(null), []);
  assert.deepEqual(claudeDirArgs({ personal: null, write: ['D:/s'], read: [] }), ['--add-dir', 'D:/s']);
  const args = claudeDirArgs({ personal: 'D:/me', write: ['D:/s'], read: ['D:/docs'] });
  assert.deepEqual(args.slice(0, 6), ['--add-dir', 'D:/me', '--add-dir', 'D:/s', '--add-dir', 'D:/docs']);
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { permissions: { deny: ['Edit(//d/docs/**)'] } });
  assert.equal(blockLevel('claude_cli').write, 'blocked');
  assert.equal(blockLevel('claude_cli').read, 'blocked', '--restricted + 명령 도구 없음 → 밖 읽기도 막힘(WS0)');
  assert.equal(blockLevel('claude_cli', { full: true }).write, 'organize', 'full(Bash)은 우회되므로 정리만');
  assert.equal(blockLevel('codex_thread', { newSession: true }).write, 'blocked', 'Codex 새 세션은 승인 없이 샌드박스만');
  assert.equal(blockLevel('codex_thread').write, 'approval', '기존 대화 작업 모드는 허용할 때만(WS1-a 실측)');
});

test('새 세션에 붙이기: "new:<이름>"으로 허용 목록 없이, 개인 폴더는 거절(자동 폴더), 이름 형식 검사', (t) => {
  const d = dirs(t);
  const c = { codex: { allowlist: [] } };
  const s = addFolder(c, { name: '공유', path: join(d, 'shared') });
  const r = addFolder(c, { name: '자료', path: join(d, 'docs') });
  attachWorkspace(c, { engine: 'claude_cli', sessionRef: 'new:law-bot', shared: [{ id: s, write: true }, { id: r }] });
  assert.deepEqual(workspaceFor(c, 'claude_cli', 'new:law-bot'), { personal: null, write: [fwd(join(d, 'shared'))], read: [fwd(join(d, 'docs'))] });
  assert.throws(() => attachWorkspace(c, { engine: 'claude_cli', sessionRef: 'new:law-bot', personal: s }), /new_session_auto_folder/);
  assert.throws(() => attachWorkspace(c, { engine: 'claude_cli', sessionRef: 'new:../x', shared: [{ id: s }] }), /bad_session/);
  assert.throws(() => attachWorkspace(c, { engine: 'agy_cli', sessionRef: 'new:law-bot', shared: [{ id: s }] }), /bad_session/);
  attachWorkspace(c, { engine: 'codex_thread', sessionRef: 'new:Code-Bot', shared: [{ id: s, write: true }] });
  assert.ok(workspaceFor(c, 'codex_thread', 'new:Code-Bot'), '새 세션 이름은 대소문자 그대로');
  const v = workspacesView(c);
  assert.equal(v.attached.find((a) => a.sessionRef === 'new:Code-Bot').level.write, 'blocked');
  assert.equal(v.fullLevels.claude_cli.write, 'organize');
});

function fakeClaude() {
  const calls = [];
  return { calls, spawnClaude: async (args, input, { cwd }) => { calls.push({ args, input, cwd });
    const id = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : args[args.indexOf('--session-id') + 1];
    return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: id, permission_denials: [] }) }; } };
}

test('실행: Claude 기존 대화·새 세션 모두 붙인 폴더를 --add-dir(없어진 폴더는 뺌)·읽기만은 거부 규칙, 붙이지 않으면 지금과 같음, 머리말도', async (t) => {
  const d = dirs(t);
  const ns = { enabled: true, workspaceRoot: join(d, 'ws') };
  const nsPath = join(d, 'ns.json'); writeFileSync(nsPath, JSON.stringify(ns));
  const c = { live: true, newSessions: { configPath: nsPath, createdPath: join(d, 'created.jsonl') }, cliEngines: { claude_cli: { allowlist: [A], workingDirectories: { [A]: fwd(join(d, 'law')) } } } };
  const s = addFolder(c, { name: '공유', path: join(d, 'shared') });
  const r = addFolder(c, { name: '자료', path: join(d, 'docs') });
  attachWorkspace(c, { engine: 'claude_cli', sessionRef: A, shared: [{ id: s, write: true }, { id: r }] });
  attachWorkspace(c, { engine: 'claude_cli', sessionRef: 'new:law-bot', shared: [{ id: s, write: true }] });
  const fake = fakeClaude();
  const ad = (await buildAdapters(c)).claude_cli;
  // buildAdapters가 만든 어댑터의 실행 함수를 시험용으로 바꿀 수 없으므로, 같은 옵션으로 직접 만든다
  const direct = claudeCliAdapter({ live: true, spawnClaude: fake.spawnClaude, allowlist: [A], workingDirectories: { [A]: fwd(join(d, 'law')) }, busy: () => 'free',
    newSessions: { config: (await import('../../src/pilot/new-sessions.mjs')).loadNewSessionsConfig(ns), created: { has: () => false, add() {} } },
    workspaceOf: (ref) => workspaceFor(c, 'claude_cli', ref) });
  await direct.run({ sessionRef: A, question: 'q' });
  const a1 = fake.calls[0].args;
  assert.equal(fake.calls[0].cwd, fwd(join(d, 'law')), '기존 대화는 그 대화의 폴더 그대로(바꾸면 이어지지 않음)');
  assert.ok(a1.includes('--restricted'));
  assert.deepEqual(a1.filter((x, i) => a1[i - 1] === '--add-dir'), [fwd(join(d, 'shared')), fwd(join(d, 'docs'))]);
  assert.equal(JSON.parse(a1[a1.indexOf('--settings') + 1]).permissions.deny[0], `Edit(${rulePath(join(d, 'docs'))})`);
  await direct.run({ sessionRef: 'pending:x', question: 'q', newSession: { name: 'law-bot', profile: 'workspace', workspace: join(d, 'ws', 'law-bot') } });
  const a2 = fake.calls[1].args;
  assert.deepEqual(a2.filter((x, i) => a2[i - 1] === '--add-dir'), [fwd(join(d, 'shared'))]);
  assert.ok(!a2.includes('--settings'), '읽기만 공유가 없으면 규칙도 없음');
  rmSync(join(d, 'docs'), { recursive: true });
  await direct.run({ sessionRef: A, question: 'q' });
  assert.ok(!fake.calls[2].args.includes('--settings') && !fake.calls[2].args.includes(fwd(join(d, 'docs'))), '없어진 폴더는 뺌');
  const plain = claudeCliAdapter({ live: true, spawnClaude: fake.spawnClaude, allowlist: [A], workingDirectories: { [A]: fwd(join(d, 'law')) }, busy: () => 'free' });
  await plain.run({ sessionRef: A, question: 'q' });
  assert.ok(!fake.calls[3].args.includes('--add-dir'), '붙이지 않은 직원은 지금과 같음');
  assert.equal(ad.engine, 'claude_cli');
});

test('Codex 새 세션: 공유(쓰기) 폴더를 additionalDirectories로(새로 만들 때·이어 갈 때), read_only 권한이면 넣지 않음', async (t) => {
  const d = dirs(t);
  const { loadNewSessionsConfig } = await import('../../src/pilot/new-sessions.mjs');
  const config = loadNewSessionsConfig({ enabled: true, workspaceRoot: join(d, 'ws') });
  const seen = [];
  const loadSdk = async () => ({ Codex: class { startThread(o) { seen.push(['start', o]); return this.t(); } resumeThread(id, o) { seen.push(['resume', o]); return this.t(id); }
    t(id = 'th_new') { return { id, runStreamed: async () => ({ events: (async function* () { yield { type: 'thread.started', thread_id: id }; yield { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }; yield { type: 'turn.completed', usage: {} }; })() }) }; } } });
  const created = new Set(['th_old']);
  const mk = () => codexThreadAdapter({ live: true, allowlist: [], probe: () => 'NO_LOCK_FILE', loadSdk,
    newSessions: { config, created: { has: (x) => created.has(x), add: (x) => created.add(x) } }, newSessionDirs: (name) => (name === 'code-bot' ? [fwd(join(d, 'shared')), fwd(join(d, 'gone'))] : []) });
  await mk().run({ sessionRef: 'pending:1', question: 'q', newSession: { name: 'code-bot', profile: 'workspace', workspace: join(d, 'ws', 'code-bot') } }).catch(() => {});
  assert.deepEqual(seen[0][1].additionalDirectories, [fwd(join(d, 'shared'))], '없는 폴더는 뺌');
  await mk().run({ sessionRef: 'pending:2', question: 'q', newSession: { name: 'code-bot', profile: 'read_only', workspace: join(d, 'ws', 'code-bot') } }).catch(() => {});
  assert.equal(seen[1][1].additionalDirectories, undefined, '읽기 전용 권한에는 쓰기 폴더를 더하지 않음');
});

test('서버: 새 세션에도 공유 폴더 붙이기(개인 폴더는 거절), 허브 자체 새 세션 폴더는 허브 화면에서, 화면 문구', async (t) => {
  const d = dirs(t);
  const cfg = join(d, 'connector.json'); writeFileSync(cfg, JSON.stringify({ codex: { allowlist: [] } }));
  const nsPath = join(d, 'ns.json'); writeFileSync(nsPath, JSON.stringify({ enabled: true, workspaceRoot: join(d, 'ws') }));
  const app = createApp({ dbPath: join(d, 'p.db'), connectorConfigPath: cfg, claudeAuthDir: null, newSessionsConfigPath: nsPath,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const call = (path, { method = 'GET', body } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const ns = await call('/v1/sessions', { method: 'POST', body: { engine: 'claude', name: 'law-bot' } });
  assert.equal(ns.status, 201, JSON.stringify(ns.body));
  const conversationId = ns.body.conversationId;
  const f = await call('/v1/admin/local/run', { method: 'POST', body: { op: 'workspace.folder.add', args: { name: '공유', path: join(d, 'shared') } } });
  assert.equal((await call('/v1/admin/workspaces/attach', { method: 'POST', body: { conversationId, personal: f.body.id } })).body.error, 'new_session_auto_folder');
  const ok = await call('/v1/admin/workspaces/attach', { method: 'POST', body: { conversationId, shared: [{ id: f.body.id, write: true }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(JSON.parse(readFileSync(cfg, 'utf8')).workspaces.attach['claude_cli:new:law-bot'], { personal: null, shared: [{ id: f.body.id, write: true }] });
  const conv = (await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === conversationId);
  assert.deepEqual([conv.workspace.shared, conv.workspace.level.write], [[{ name: '공유', write: true }], 'blocked']);
  assert.ok(['workspace.get', 'workspace.folder.add', 'workspace.folder.delete'].every((o) => HUB_SELF_OPS.has(o)) && !HUB_SELF_OPS.has('workspace.attach'));
  const set = readFileSync(join(ROOT, 'src/pilot/web/settings.html'), 'utf8');
  assert.ok(set.includes("['hub', '허브 자체(허브에서 만든 새 세션)']") && set.includes('공유 폴더만 붙일 수 있어요'));
});
