// SV1(SERVER_SESSIONS 2-8 결정 A): 엔진 칸 = PC 한 대처럼(설정 만들기·사용 방식 ②·1회용 초대로 자동 짝짓기),
// 대화 목록 출처(sourceKinds), 엔진 칸 작업 모드는 컨테이너가 경계(승인 카드는 그대로), 칸 compose·ieun.sh 안전. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareEngine, pairIfNeeded, enginePaths } from '../../src/engine/run.mjs';
import { listCodexThreads, THREAD_SOURCES } from '../../src/pilot/codex-threads.mjs';
import { appServerTurn, containerBoundary } from '../../src/pilot/adapters/codex-thread.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-sv1-')).replaceAll('\\', '/'); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('엔진 칸 준비: PC와 같은 설정(토큰은 해시만)·사용 방식 ②, 두 번째에는 아무것도 바꾸지 않는다', (t) => {
  const d = tmp(t);
  const made = prepareEngine(d);
  assert.ok(made.includes('s2/server.json') && made.includes('s2/user-token'));
  const p = enginePaths(d);
  const server = JSON.parse(readFileSync(p.server, 'utf8'));
  const token = readFileSync(join(d, '.local/s2/user-token'), 'utf8');
  assert.ok(!JSON.stringify(server).includes(token), '설정에는 토큰 원문이 없다');
  assert.equal(JSON.parse(readFileSync(p.mode, 'utf8')).mode, 'hub');
  assert.equal(JSON.parse(readFileSync(p.connector, 'utf8')).live, false, 'AI 응답은 꺼진 채로 시작(허브 화면에서 켬)');
  const before = readFileSync(p.server, 'utf8');
  assert.deepEqual(prepareEngine(d), []);
  assert.equal(readFileSync(p.server, 'utf8'), before, '토큰이 바뀌지 않음');
});

test('자동 짝짓기: 초대가 있으면 그 초대로 한 번 짝짓고 초대 파일은 지운다(실패해도 지움), 이미 짝지었으면 아무것도 안 함', async (t) => {
  const d = tmp(t);
  prepareEngine(d);
  assert.equal(await pairIfNeeded(d, { hubUrl: 'https://hub.example.kr', name: '서버 · law' }), 'no_invite');
  writeFileSync(join(d, 'invite'), 'INV-1\n');
  const seen = [];
  const okLink = ({ dir }) => { let st = 'none'; return { connect: async (a) => { seen.push(a); st = 'paired'; writeFileSync(join(dir, 'hub.json'), '{}'); }, status: () => ({ state: st }), pollOnce: async () => {}, close: () => {} }; };
  const { mkdirSync } = await import('node:fs'); mkdirSync(enginePaths(d).hubDir, { recursive: true });
  assert.equal(await pairIfNeeded(d, { hubUrl: 'https://hub.example.kr', name: '서버 · law', linkImpl: okLink }), 'paired_now');
  assert.deepEqual(seen, [{ hubUrl: 'https://hub.example.kr', name: '서버 · law', invite: 'INV-1' }]);
  assert.equal(existsSync(join(d, 'invite')), false, '쓴 초대는 지움');
  assert.equal(await pairIfNeeded(d, { hubUrl: 'https://hub.example.kr', name: 'x', linkImpl: () => { throw new Error('부르면 안 됨'); } }), 'paired');
  // 실패: 초대는 그래도 지운다(1회용)
  const d2 = tmp(t); prepareEngine(d2); writeFileSync(join(d2, 'invite'), 'INV-2');
  const bad = () => ({ connect: async () => { throw Object.assign(new Error('bad_invite'), { http: 502 }); }, status: () => ({ state: 'none' }), close: () => {} });
  assert.equal(await pairIfNeeded(d2, { hubUrl: 'https://hub.example.kr', name: 'x', linkImpl: bad }), 'pair_failed');
  assert.equal(existsSync(join(d2, 'invite')), false);
});

test('대화 목록: 출처(sourceKinds)를 정해 이어온·SDK로 만든 대화(exec)도 나오게 한다(SV0 실측)', async () => {
  const sent = [];
  const spawnImpl = () => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {};
    c.stdin = { write: (line) => { const m = JSON.parse(line); sent.push(m);
      const reply = (o) => setImmediate(() => c.stdout.emit('data', JSON.stringify(o) + '\n'));
      if (m.id === 1) reply({ id: 1, result: {} });
      if (m.id === 2) reply({ id: 2, result: { data: [] } }); }, end: () => {} };
    return c;
  };
  await listCodexThreads({ codex: { command: 'x' }, spawnImpl });
  const list = sent.find((m) => m.method === 'thread/list');
  assert.deepEqual(list.params.sourceKinds, ['cli', 'vscode', 'exec', 'appServer']);
  assert.deepEqual([...THREAD_SOURCES].sort(), ['appServer', 'cli', 'exec', 'vscode']);
  assert.deepEqual(list.params.excludedThreadIds, ['01a0dadd-739f-74d2-93c5-9c405cc1019b'], '업무 대화는 여전히 뺀다');
});

function transport() {
  const sent = []; let h = () => {};
  return { sent, onMessage: (f) => { h = f; }, close: () => {}, send(m) {
    sent.push(m);
    const reply = (result) => queueMicrotask(() => h({ jsonrpc: '2.0', id: m.id, result }));
    if (m.method === 'initialize' || m.method === 'thread/resume') reply({});
    if (m.method === 'turn/start') { reply({ turn: { id: 't1' } }); queueMicrotask(() => h({ method: 'turn/completed', params: { threadId: 'th', turnId: 't1', turn: { status: 'completed' } } })); }
  } };
}

test('엔진 칸 작업 모드: 컨테이너가 경계(엔진 샌드박스 끔) — 승인은 여전히 사람(untrusted·user), PC·허브 자체에서는 그대로 작업 폴더 쓰기', async () => {
  const prev = process.env.IEON_CONTAINER_BOUNDARY;
  try {
    delete process.env.IEON_CONTAINER_BOUNDARY;
    assert.equal(containerBoundary(), false);
    let tr = transport();
    await appServerTurn(tr, { threadId: 'th', question: 'q', cwd: '/w', approve: null });
    let start = tr.sent.find((m) => m.method === 'turn/start').params;
    assert.deepEqual([tr.sent.find((m) => m.method === 'thread/resume').params.sandbox, start.sandboxPolicy.type], ['workspace-write', 'workspaceWrite']);
    process.env.IEON_CONTAINER_BOUNDARY = '1';
    tr = transport();
    await appServerTurn(tr, { threadId: 'th', question: 'q', cwd: '/w', approve: null });
    start = tr.sent.find((m) => m.method === 'turn/start').params;
    assert.deepEqual([tr.sent.find((m) => m.method === 'thread/resume').params.sandbox, start.sandboxPolicy.type], ['danger-full-access', 'dangerFullAccess']);
    assert.deepEqual([start.approvalPolicy, start.approvalsReviewer], ['untrusted', 'user'], '명령·파일 수정은 여전히 승인 카드로');
  } finally { if (prev === undefined) delete process.env.IEON_CONTAINER_BOUNDARY; else process.env.IEON_CONTAINER_BOUNDARY = prev; }
});

test('엔진 칸 compose·ieun.sh: 권한 없음·공개 포트 없음·허브 네트워크에 안 붙음·이름 검사·초대는 화면에 안 나옴', () => {
  const c = readFileSync(new URL('../../deploy/hub/engine.compose.yaml', import.meta.url), 'utf8');
  for (const s of ['cap_drop: [ALL]', 'no-new-privileges:true', 'user: "1001:1001"', 'IEON_CONTAINER_BOUNDARY: "1"', '../../engines/${ENGINE_NAME}/data:/data', 'src/engine/run.mjs']) assert.ok(c.includes(s), s);
  for (const s of ['ports:', 'proxy-network', 'docker.sock', 'privileged']) assert.ok(!c.includes(s), '없어야 함: ' + s);
  const sh = readFileSync(new URL('../../deploy/hub/ieun.sh', import.meta.url), 'utf8');
  assert.ok(sh.includes("grep -Eq '^[a-z0-9][a-z0-9-]{0,19}$'"), '칸 이름 검사');
  assert.ok(sh.includes('node src/hub/invite.mjs /data > "engines/$name/data/invite"'), '초대는 파일로 바로');
  assert.ok(sh.includes('umask 077') && sh.includes('chmod 700'), '초대·데이터는 주인만');
  assert.ok(!/echo[^\n]*invite/.test(sh.replace(/# .*\n/g, '')), '초대 값을 화면에 찍지 않음');
  const inv = readFileSync(new URL('../../src/hub/invite.mjs', import.meta.url), 'utf8');
  assert.ok(inv.includes('http://127.0.0.1:') && !/stdout\.write\([^)]*token/.test(inv), '컨테이너 안 서버에만, 토큰은 출력 안 함');
});
