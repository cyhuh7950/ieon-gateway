// WS1-a 작업공간(신산님 2026-11-18 "WS1-a 진행", 설계 WORKSPACES 2절·3-1 실측): 그 PC의 폴더를 사람이 등록하고 AI 직원에 개인·공유(읽기/쓰기) 폴더를 붙인다.
// 붙이지 않은 직원은 그대로(보존), 붙인 Codex 직원만 작업 폴더·writableRoots가 바뀜, 임시 폴더 아래·업무 대화·허용 목록 밖은 거절,
// 붙이기는 전용 주소로만(기록 180일, 내용 없음), 메신저 /status는 폴더 이름만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { addFolder, attachWorkspace, removeFolder, workspaceFor, workspaceLine, blockLevel, workspacesView } from '../../src/pilot/workspaces.mjs';
import { removeCodexThread } from '../../src/pilot/device-settings.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { codexWorkspaceDirs, withWorkspaceLine } from '../../src/pilot/adapters/index.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
const KO = loadDict('ko');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const T1 = '01a18790-0000-7000-8000-000000000001';
const T2 = '01a18790-0000-7000-8000-000000000002';
const WORK = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const sha = (s) => createHash('sha256').update(s).digest('hex');
// 임시 폴더 아래는 등록이 거절되므로 시험 폴더는 저장소의 .local(git 무시) 아래에 둔다
function dirs(t) {
  mkdirSync(join(ROOT, '.local'), { recursive: true });
  const d = mkdtempSync(join(ROOT, '.local', 'ws1-'));
  t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } });
  for (const n of ['staffA', 'shared', 'docs']) mkdirSync(join(d, n));
  return d;
}
const fwd = (p) => p.replaceAll('\\', '/');

test('폴더 등록: 그 PC에 있는 절대 경로만·이름 붙이기, 임시 폴더 아래·같은 폴더·같은 이름은 거절, 직원이 쓰는 폴더는 빼지 못함', (t) => {
  const d = dirs(t);
  const c = { codex: { allowlist: [T1] } };
  const a = addFolder(c, { name: '보험-개인', path: join(d, 'staffA') });
  assert.match(a, /^f[0-9a-f]{8}$/);
  assert.equal(c.workspaces.folders[0].path, fwd(join(d, 'staffA')));
  assert.throws(() => addFolder(c, { name: 'x', path: 'relative/dir' }), /bad_folder_path/);
  assert.throws(() => addFolder(c, { name: 'x', path: join(d, 'nope') }), /folder_missing/);
  assert.throws(() => addFolder(c, { name: '', path: join(d, 'shared') }), /bad_folder_name/);
  assert.throws(() => addFolder(c, { name: '보험-개인', path: join(d, 'shared') }), /folder_name_taken/);
  assert.throws(() => addFolder(c, { name: 'y', path: join(d, 'staffA') }), /folder_already_added/);
  const tmp = mkdtempSync(join(tmpdir(), 'ieon-ws1-')); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  assert.throws(() => addFolder(c, { name: '임시', path: tmp }), /folder_in_temp/, 'Codex가 임시 폴더는 늘 쓰기 허용(WS0) → 직원끼리 막히지 않음');
  attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1, personal: a });
  assert.throws(() => removeFolder(c, a), /folder_in_use/);
  attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1 }); // 떼기
  assert.deepEqual(c.workspaces.attach, {});
  removeFolder(c, a);
  assert.equal(c.workspaces.folders.length, 0);
});

test('붙이기: 그 기기 허용 목록의 세션만, 업무 대화·없는 폴더·같은 폴더 두 번은 거절, 실행 모양과 머리말 한 줄, 허용 목록에서 빼면 같이 떨어짐', (t) => {
  const d = dirs(t);
  const cfg = join(d, 'connector.json');
  const c = { codex: { allowlist: [T1, T2], workingDirectories: { [T2]: 'D:/orig' } }, cliEngines: { agy_cli: { allowlist: [T2] } } };
  const p = addFolder(c, { name: '개인', path: join(d, 'staffA') });
  const s = addFolder(c, { name: '공유', path: join(d, 'shared') });
  const r = addFolder(c, { name: '자료', path: join(d, 'docs') });
  assert.throws(() => attachWorkspace(c, { engine: 'codex_thread', sessionRef: WORK, personal: p }), /excluded_session/);
  assert.throws(() => attachWorkspace(c, { engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-00000000000f', personal: p }), /session_not_allowed/);
  assert.throws(() => attachWorkspace(c, { engine: 'claude_channel', sessionRef: 'ieon', personal: p }), /bad_engine/);
  assert.throws(() => attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1, personal: 'fdeadbeef' }), /bad_folder/);
  assert.throws(() => attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1, personal: p, shared: [{ id: p, write: true }] }), /bad_folder/);
  attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1.toUpperCase(), personal: p, shared: [{ id: s, write: true }, { id: r }] });
  const ws = workspaceFor(c, 'codex_thread', T1);
  assert.deepEqual(ws, { personal: fwd(join(d, 'staffA')), write: [fwd(join(d, 'shared'))], read: [fwd(join(d, 'docs'))] });
  assert.equal(workspaceLine(ws), `[작업 공간] 개인: ${ws.personal} · 공유(쓰기): ${ws.write[0]} · 공유(읽기만): ${ws.read[0]}\n\n`);
  assert.equal(workspaceFor(c, 'codex_thread', T2), null, '붙이지 않은 직원은 없음');
  // 화면용: 이름·권한·막는 정도
  const v = workspacesView(c);
  assert.deepEqual(v.attached[0].summary, { personal: '개인', shared: [{ name: '공유', write: true }, { name: '자료', write: false }] });
  assert.equal(v.attached[0].level.write, 'approval', '2026-11-18 실측: 사람이 허용하면 작업 폴더 밖도 써짐 — 차단이 아니라 허용 필요');
  assert.equal(v.attached[0].level.read, 'organize', 'Codex는 읽기를 막지 못함(WS0) — 정리만으로 표시');
  assert.equal(v.levels.claude_cli.write, 'blocked', 'WS1-b: Claude는 --restricted·--add-dir로 차단');
  assert.equal(blockLevel('codex_thread', { boundary: true }).write, 'limited', '엔진 칸은 컨테이너가 경계');
  // 허용 목록에서 빼면 작업 공간도 뗀다
  writeFileSync(cfg, JSON.stringify(c));
  removeCodexThread(cfg, T1);
  assert.deepEqual(JSON.parse(readFileSync(cfg, 'utf8')).workspaces.attach, {});
});

test('실행: 붙인 Codex 직원만 작업 폴더 = 개인 폴더, 작업 모드 writableRoots에 공유(쓰기) 더함 — 읽기만·없어진 폴더는 넣지 않음, 머리말은 붙인 직원·기존 대화만', async (t) => {
  const d = dirs(t);
  const c = { live: true, codex: { allowlist: [T1, T2], workingDirectories: { [T2]: fwd(join(d, 'docs')) } } };
  const p = addFolder(c, { name: '개인', path: join(d, 'staffA') });
  const s = addFolder(c, { name: '공유', path: join(d, 'shared') });
  const r = addFolder(c, { name: '자료', path: join(d, 'docs') });
  attachWorkspace(c, { engine: 'codex_thread', sessionRef: T1, personal: p, shared: [{ id: s, write: true }, { id: r, write: false }] });
  const wd = codexWorkspaceDirs(c);
  assert.equal(wd.workingDirectories[T1], fwd(join(d, 'staffA')));
  assert.equal(wd.workingDirectories[T2], fwd(join(d, 'docs')), '붙이지 않은 직원은 원래 작업 폴더 그대로');
  assert.deepEqual(wd.writableExtra, { [T1]: [fwd(join(d, 'shared'))] });
  // 작업 모드 차례: app-server에 넘기는 쓰기 허용 폴더
  const sent = [];
  const fake = () => { let h = () => {}; const emit = (m) => setTimeout(() => h(m), 1);
    return { onMessage: (fn) => { h = fn; }, close() {}, send: (m) => { sent.push(m);
      if (m.method === 'initialize' || m.method === 'thread/resume') emit({ id: m.id, result: {} });
      else if (m.method === 'turn/start') { emit({ id: m.id, result: { turn: { id: 'turn_1' } } }); emit({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: 'turn_1', status: 'completed' } } }); } } }; };
  const adapter = codexThreadAdapter({ live: true, allowlist: [T1, T2], probe: () => 'NO_LOCK_FILE', ...wd, appServer: fake });
  await adapter.run({ sessionRef: T1, question: 'q', connectMode: 'alternate', workMode: true });
  const start = sent.find((m) => m.method === 'turn/start').params;
  assert.equal(start.cwd, fwd(join(d, 'staffA')));
  assert.deepEqual(start.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [fwd(join(d, 'staffA')), fwd(join(d, 'shared'))], networkAccess: false });
  sent.length = 0;
  await adapter.run({ sessionRef: T2, question: 'q', connectMode: 'alternate', workMode: true });
  assert.deepEqual(sent.find((m) => m.method === 'turn/start').params.sandboxPolicy.writableRoots, [fwd(join(d, 'docs'))], '붙이지 않은 직원은 지금과 같음');
  rmSync(join(d, 'shared'), { recursive: true });
  sent.length = 0;
  await adapter.run({ sessionRef: T1, question: 'q', connectMode: 'alternate', workMode: true });
  assert.deepEqual(sent.find((m) => m.method === 'turn/start').params.sandboxPolicy.writableRoots, [fwd(join(d, 'staffA'))], '없어진 공유 폴더는 빼고 보냄');
  // 머리말 한 줄
  const seen = [];
  const wrapped = withWorkspaceLine({ engine: 'codex_thread', run: async (job) => { seen.push(job.question); return {}; } }, c);
  await wrapped.run({ sessionRef: T1, question: '질문' });
  await wrapped.run({ sessionRef: T2, question: '질문' });
  await wrapped.run({ sessionRef: 'pending:x', question: '질문', newSession: { name: 'n' } });
  assert.ok(seen[0].startsWith('[작업 공간] 개인: ') && seen[0].endsWith('\n\n질문'));
  assert.deepEqual(seen.slice(1), ['질문', '질문']);
});

test('서버: 붙이기는 전용 주소로만(대화 주인·세션 확인 → 그 PC가 검사·저장), 대화 목록·기록에 이름·권한만, 새 세션·채널은 거절', async (t) => {
  const d = dirs(t);
  const cfg = join(d, 'connector.json');
  writeFileSync(cfg, JSON.stringify({ live: false, codex: { allowlist: [T1] } }));
  const app = createApp({ dbPath: join(d, 'p.db'), connectorConfigPath: cfg, claudeAuthDir: null,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c_cl', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'ieon' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const run = (op, args) => call('/v1/admin/local/run', { method: 'POST', body: { op, args } });
  const f1 = await run('workspace.folder.add', { name: '개인', path: join(d, 'staffA') });
  assert.equal(f1.status, 201);
  const f2 = await run('workspace.folder.add', { name: '공유', path: join(d, 'shared') });
  assert.equal((await run('workspace.attach', { engine: 'codex_thread', sessionRef: T1, personal: f1.body.id })).body.error, 'use_workspace_route', '기록 없이 붙이지 못함');
  assert.equal((await call('/v1/admin/workspaces/attach', { method: 'POST', body: { conversationId: 'c_cl', personal: f1.body.id } })).body.error, 'workspace_engine_unsupported');
  assert.equal((await call('/v1/admin/workspaces/attach', { method: 'POST', token: 'other', body: { conversationId: 'c1', personal: f1.body.id } })).status, 404);
  const ok = await call('/v1/admin/workspaces/attach', { method: 'POST', body: { conversationId: 'c1', personal: f1.body.id, shared: [{ id: f2.body.id, write: false }] } });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).workspaces.attach[`codex_thread:${T1}`].personal, f1.body.id, '그 PC 설정에 저장');
  const conv = (await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c1');
  assert.deepEqual([conv.workspace.personal, conv.workspace.shared, conv.workspace.level.write], ['개인', [{ name: '공유', write: false }], 'approval']);
  assert.ok(!JSON.stringify(conv).includes(fwd(d)), '대화 목록에 폴더 경로 없음');
  const log = (await call('/v1/admin/workspaces/log/c1')).body.log;
  assert.deepEqual([log[0].userId, log[0].personal], ['u_sinsan', '개인']);
  assert.equal((await call('/v1/admin/workspaces/log/c1', { token: 'other' })).status, 404);
  // 떼기 → 표시도 사라지고 기록은 남음
  await call('/v1/admin/workspaces/attach', { method: 'POST', body: { conversationId: 'c1' } });
  assert.equal((await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c1').workspace, undefined);
  assert.equal((await call('/v1/admin/workspaces/log/c1')).body.log[0].detached, true);
});

test('메신저 /status·설정 화면: 작업 공간은 폴더 이름만, 설정 화면에 작업 폴더 탭과 승인 확인', () => {
  assert.ok(KO['messenger.describe.workspace'].includes('작업 공간: {ws}'));
  const set = readFileSync(join(ROOT, 'src/pilot/web/settings.html'), 'utf8');
  assert.ok(set.includes('data-atab="work" hidden aria-label="작업 폴더"') && set.includes("'/v1/admin/workspaces/attach'") && set.includes('승인할까요?'));
});

test('기기 명령: workspace.* 는 PC형·허브형 같은 명령(허브 자신은 폴더 등록·보기만, WS1-b)', async (t) => {
  const d = dirs(t);
  const cfg = join(d, 'connector.json'); writeFileSync(cfg, JSON.stringify({ codex: { allowlist: [T1] } }));
  const adm = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, applyDevice: async () => ({ restarted: true }) });
  const f = await adm.run('workspace.folder.add', { name: '개인', path: join(d, 'staffA') });
  const a = await adm.run('workspace.attach', { engine: 'codex_thread', sessionRef: T1, personal: f.body.id });
  assert.deepEqual([a.status, a.body.restarted, a.body.attached.length], [200, true, 1]);
  assert.equal((await adm.run('workspace.folder.delete', { id: f.body.id })).body.error, 'folder_in_use');
  const { HUB_SELF_OPS } = await import('../../src/pilot/device-admin.mjs');
  assert.ok(HUB_SELF_OPS.has('workspace.folder.add') && !HUB_SELF_OPS.has('workspace.attach'));
});
