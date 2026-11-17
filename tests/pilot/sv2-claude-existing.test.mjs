// SV2 기존 대화(신산님 2026-11-17 "서버 Claude 기존 대화 고르기 진행"): 서버 엔진 칸에서 사람이 연 Claude 대화를 고르고 같은 세션으로 이어 쓴다.
// 목록(제목·폴더·시간만, 업무 대화·이어온 새 세션 제외) → [연결](칸 허용 목록 + 허브 대화 등록 한 번에) → 질문은 그 폴더에서 --resume 같은 ID,
// 사람이 그 폴더에서 Claude를 열어 두면 보내지 않음, 다른 ID로 답하면 결과 불명. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { claudeBusy, findClaudeSession, listClaudeSessions } from '../../src/pilot/claude-sessions.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { validateBinding } from '../../src/pilot/settings.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-sv2x-')); t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } }); return d; };
const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-3333-4444-8555-666666666666';
const WORK = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const NEW = '33333333-4444-4555-8666-777777777777';

// 가짜 Claude 대화 기록 폴더: projects/<폴더>/<ID>.jsonl
function projects(d, cwd) {
  const dir = join(d, 'projects'); const p = join(dir, '-data-workspaces-law'); mkdirSync(p, { recursive: true });
  const line = (o) => JSON.stringify(o) + '\n';
  writeFileSync(join(p, `${A}.jsonl`), line({ type: 'user', isMeta: true, cwd, message: { role: 'user', content: '<command-name>/init</command-name>' } })
    + line({ type: 'user', cwd, sessionId: A, message: { role: 'user', content: [{ type: 'text', text: '계약서 3조 검토해 줘 — 손해배상 범위가 너무 넓어요. 그리고 나머지 조항도 같이 봐 주세요.' }] } })
    + line({ type: 'assistant', message: { role: 'assistant', content: '비밀 본문 답' } }));
  writeFileSync(join(p, `${B}.jsonl`), line({ type: 'summary', summary: '임대차 분쟁 정리' }) + line({ type: 'user', cwd, message: { role: 'user', content: 'q' } }));
  writeFileSync(join(p, `${WORK}.jsonl`), line({ type: 'user', cwd, message: { role: 'user', content: '업무' } }));
  writeFileSync(join(p, `${NEW}.jsonl`), line({ type: 'user', cwd, message: { role: 'user', content: '이어온 새 세션' } }));
  const old = new Date(Date.now() - 3600_000); utimesSync(join(p, `${A}.jsonl`), old, old);
  return dir;
}

test('목록: 최근 순·제목(요약 또는 첫 질문 60자)·작업 폴더만, 업무 대화와 이어온 새 세션은 빼고 본문(답)은 내지 않음', (t) => {
  const d = tmp(t); const cwd = join(d, 'law'); mkdirSync(cwd);
  const dir = projects(d, cwd);
  const list = listClaudeSessions({ dir, skip: new Set([NEW]) });
  assert.deepEqual(list.map((x) => x.sessionId), [B, A]);
  assert.equal(list[0].title, '임대차 분쟁 정리');
  assert.equal(list[1].title, '계약서 3조 검토해 줘 — 손해배상 범위가 너무 넓어요. 그리고 나머지 조항도 같이 봐 주세요.'.slice(0, 60), '메타(명령) 줄은 건너뜀');
  assert.equal(list[1].cwd, cwd);
  assert.ok(!JSON.stringify(list).includes('비밀 본문') && !JSON.stringify(list).includes(WORK));
  assert.equal(findClaudeSession(WORK, dir), null, '업무 대화는 찾지도 않음');
  assert.equal(findClaudeSession(A, dir).cwd, cwd);
  assert.deepEqual(listClaudeSessions({ dir: join(d, 'none') }), []);
  assert.equal(claudeBusy(cwd, { platform: 'win32' }), 'unknown', '리눅스가 아니면 판별하지 않음');
});

test('기기 명령: 서버 칸에서만 목록·연결 — 연결하면 그 칸 허용 목록(Claude)에 그 대화의 작업 폴더와 함께, 사람이 쓰는 중 표시', async (t) => {
  const d = tmp(t); const cwd = join(d, 'law'); mkdirSync(cwd);
  const dir = projects(d, cwd);
  const created = join(d, 'created.jsonl'); writeFileSync(created, JSON.stringify({ id: NEW, name: 'n' }) + '\n');
  const cfg = join(d, 'connector.json'); writeFileSync(cfg, JSON.stringify({ newSessions: { createdPath: created } }));
  const cell = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: join(d, 'shared'), claudeProjects: dir, busyOf: (c) => (c === cwd ? 'busy' : 'free'),
    applyDevice: async () => ({ restarted: true }) });
  assert.equal((await cell.run('device.get')).body.claudeServer, true);
  const s = (await cell.run('claude.sessions')).body.sessions;
  assert.deepEqual(s.map((x) => [x.sessionId, x.connected, x.busy]), [[B, false, true], [A, false, true]]);
  assert.deepEqual((await cell.run('claude.connect', { sessionId: WORK })).body, { error: 'session_not_found' });
  const r = await cell.run('claude.connect', { sessionId: A });
  assert.deepEqual([r.status, r.body.sessionId, r.body.cwd, r.body.restarted], [200, A, cwd, true]);
  const c = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.deepEqual(c.cliEngines.claude_cli.allowlist, [A]);
  assert.equal(c.cliEngines.claude_cli.workingDirectories[A], cwd.replaceAll('\\', '/'));
  assert.equal((await cell.run('claude.sessions')).body.sessions.find((x) => x.sessionId === A).connected, true);
  // PC(같이 쓰는 Claude 로그인이 없는 곳)는 고르지 않음 — PC Claude는 채널 그대로
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, claudeProjects: dir });
  assert.equal((await pc.run('claude.sessions')).body.error, 'claude_not_server');
  assert.equal((await pc.run('device.get')).body.claudeServer, false);
});

function fakeClaude(sessionId) {
  const calls = [];
  return { calls, spawnClaude: async (args, input, { cwd }) => { calls.push({ args, input, cwd });
    const id = sessionId ?? args[args.indexOf('--resume') + 1];
    return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '이어서 답', session_id: id, permission_denials: [], usage: { input_tokens: 5, output_tokens: 2 } }) }; } };
}
test('질문: 고른 대화는 그 작업 폴더에서 같은 ID로 --resume(새 세션 규칙과 같은 안전 옵션), 허용 목록 밖·사람이 사용 중·폴더 없음은 보내지 않음, 다른 ID면 결과 불명', async (t) => {
  const d = tmp(t); const cwd = join(d, 'law'); mkdirSync(cwd);
  let busy = 'free';
  const cl = fakeClaude();
  const adapter = claudeCliAdapter({ live: true, spawnClaude: cl.spawnClaude, allowlist: [A], workingDirectories: { [A]: cwd }, busy: () => busy });
  const r = await adapter.run({ sessionRef: A, question: 'q' });
  const { args, input, cwd: ran } = cl.calls[0];
  assert.deepEqual([r.answer, r.sessionRef, ran, input], ['이어서 답', A, cwd, 'q']);
  assert.equal(args[args.indexOf('--resume') + 1], A);
  for (const f of ['-p', '--restricted', '--strict-mcp-config']) assert.ok(args.includes(f), f);
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,Edit,Write', '명령(Bash)은 열지 않음');
  assert.ok(!args.includes('--session-id') && !args.includes('--dangerously-skip-permissions') && !args.includes('--fork-session'));
  await assert.rejects(adapter.run({ sessionRef: B, question: 'q' }), { code: 'session_not_allowed' });
  busy = 'busy';
  await assert.rejects(adapter.run({ sessionRef: A, question: 'q' }), { code: 'session_in_use' });
  assert.equal(cl.calls.length, 1, '사용 중이면 실행하지 않음');
  busy = 'free';
  const gone = claudeCliAdapter({ live: true, spawnClaude: cl.spawnClaude, allowlist: [A], workingDirectories: { [A]: join(d, 'gone') }, busy: () => 'free' });
  await assert.rejects(gone.run({ sessionRef: A, question: 'q' }), { code: 'working_directory_missing' });
  const off = claudeCliAdapter({ live: false, spawnClaude: cl.spawnClaude, allowlist: [A], workingDirectories: { [A]: cwd }, busy: () => 'free' });
  await assert.rejects(off.run({ sessionRef: A, question: 'q' }), { code: 'live_disabled' });
  const forked = claudeCliAdapter({ live: true, spawnClaude: fakeClaude(B).spawnClaude, allowlist: [A], workingDirectories: { [A]: cwd }, busy: () => 'free' });
  await assert.rejects(forked.run({ sessionRef: A, question: 'q' }), (e) => e.unknownCode === 'session_forked');
});

const sha = (s) => createHash('sha256').update(s).digest('hex');
test('허브: 칸에 [연결]을 맡기면 결과가 오는 대로 이어온 대화로 등록(같은 대화를 다시 연결하면 그대로), Claude 대화 등록 형식 검사', async (t) => {
  const d = tmp(t);
  const app = createApp({ dbPath: join(d, 'p.db'), claudeAuthDir: null, adminTimeoutMs: 5000, webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('cell'), hostId: 'h_cell' }], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' } }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
  await call('/v1/device/jobs', { token: 'cell' }); // 칸이 붙어 있음
  // 칸 흉내: 맡긴 명령을 가져가 결과를 보냄
  const answer = async () => {
    for (let i = 0; i < 50; i++) {
      const c = await call('/v1/device/admin', { token: 'cell' });
      if (c.status === 200) { assert.equal(c.body.op, 'claude.connect'); return call(`/v1/device/admin/${c.body.id}/result`, { method: 'POST', token: 'cell', body: { status: 200, body: { sessionId: A, title: '계약서 검토', cwd: '/data/workspaces/law' } } }); }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('no admin job');
  };
  const [r] = await Promise.all([call('/v1/admin/hosts/h_cell/run', { method: 'POST', body: { op: 'claude.connect', args: { sessionId: A } } }), answer()]);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.created, r.body.sessionId], [true, A]);
  const conv = (await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === r.body.conversationId);
  assert.deepEqual([conv.engine, conv.label], ['claude_cli', '계약서 검토']);
  const [again] = await Promise.all([call('/v1/admin/hosts/h_cell/run', { method: 'POST', body: { op: 'claude.connect', args: { sessionId: A } } }), answer()]);
  assert.deepEqual([again.body.conversationId, again.body.created], [r.body.conversationId, false]);
  assert.throws(() => validateBinding('c_x', { engine: 'claude_cli', label: 'x', hostId: 'h', sessionRef: 'nope' }, ['h']), /bad_session_ref/);
  assert.throws(() => validateBinding('c_x', { engine: 'claude_cli', label: 'x', hostId: 'h', sessionRef: WORK }, ['h']), /excluded_session/);
});
