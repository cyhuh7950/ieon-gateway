// 2026-11-23 인수 시험(신산님 "답변이 오는 시간이 너무 걸리는데" → "둘 다 진행하자"):
// ① 연결부 질문 가져가기 0.7초, Windows 잠금 검사는 띄워 둔 검사기로(실패하면 예전 방식)
// ② 빠른 응답(warm): 대화 전용 Codex(app-server)를 미리 띄워 두고 질문마다 차례만 연다 — 연결 방식 값 'warm', 허브에서 고르면 그 PC 설정에도. 모델 호출 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appServerTurn, codexThreadAdapter, closeWarm } from '../../src/pilot/adapters/codex-thread.mjs';
import { warmHere } from '../../src/pilot/connector.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { CONNECT_MODES } from '../../src/pilot/store.mjs';
import { probeWindowsAsync } from '../../src/pilot/lock-probe.mjs';
import { koView } from './web-page.mjs';

const TID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-fast-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

// 가짜 app-server: 요청을 기록하고 turn/start에 답 한 줄로 끝낸다
function fakeServer() {
  const sent = []; let handler = () => {};
  const t = { ready: false, alive: true, closed: 0, sent,
    send(m) {
      sent.push(m);
      if (m.id === undefined) return;
      const reply = (result) => queueMicrotask(() => handler({ id: m.id, result }));
      if (m.method === 'turn/start') {
        reply({ turn: { id: 'turn-1' } });
        queueMicrotask(() => {
          handler({ method: 'item/completed', params: { threadId: m.params.threadId, turnId: 'turn-1', item: { type: 'agentMessage', text: '확인' } } });
          handler({ method: 'turn/completed', params: { threadId: m.params.threadId, turnId: 'turn-1', turn: { status: 'completed' } } });
        });
      } else reply({});
    },
    onMessage(fn) { handler = fn; }, close() { t.closed += 1; t.alive = false; } };
  return t;
}

test('appServerTurn: read 정책은 읽기 전용·묻지 않음, keep이면 닫지 않고 initialize는 한 번만', async () => {
  const t = fakeServer();
  const r1 = await appServerTurn(t, { threadId: TID, question: 'q', policy: 'read', keep: true, model: 'gpt-6.1-sol' });
  const r2 = await appServerTurn(t, { threadId: TID, question: 'q2', policy: 'read', keep: true });
  assert.equal(r1.answer, '확인'); assert.equal(r2.answer, '확인');
  assert.equal(t.sent.filter((m) => m.method === 'initialize').length, 1);
  const resume = t.sent.find((m) => m.method === 'thread/resume').params;
  const start = t.sent.find((m) => m.method === 'turn/start').params;
  assert.deepEqual([resume.sandbox, resume.approvalPolicy], ['read-only', 'never']);
  assert.deepEqual([start.sandboxPolicy, start.approvalPolicy, start.model], [{ type: 'readOnly' }, 'never', 'gpt-6.1-sol']);
  assert.equal(t.closed, 0);
});

test('어댑터 warm: 띄워 둔 Codex로 보내고 잠금 검사 안 함, 같은 대화 동시 질문은 거절', async () => {
  const t = fakeServer(); let probes = 0; let made = 0;
  const a = codexThreadAdapter({ live: true, allowlist: [TID], probe: () => { probes += 1; return 'NO_LOCK_FILE'; }, loadSdk: async () => ({}), modes: { [TID]: 'warm' },
    warmTransport: () => { made += 1; return t; } });
  const r = await a.run({ engine: 'codex_thread', sessionRef: TID, question: 'q', connectMode: 'warm' });
  assert.deepEqual([r.answer, probes, made, t.closed], ['확인', 0, 1, 0]);
  // warmup: 빠른 응답으로 정한 대화만 미리 띄움
  const ups = [];
  const b = codexThreadAdapter({ live: true, allowlist: [TID, '01a18790-0000-4000-8000-000000000001'], loadSdk: async () => ({}), modes: { [TID]: 'warm', '01a18790-0000-4000-8000-000000000001': 'alternate' },
    warmUp: async (id) => { ups.push(id); } });
  assert.deepEqual(b.warmup(), [TID]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ups, [TID]);
  closeWarm();
});

test('연결부: 질문을 받는 쪽만 미리 띄움(사용 방식 hub면 허브 연결부, pc면 이 PC 연결부, 없으면 그대로)', (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, '{}');
  assert.equal(warmHere(cfg, 'http://127.0.0.1:28760'), true);
  writeFileSync(join(d, 'mode.json'), JSON.stringify({ mode: 'hub' }));
  assert.deepEqual([warmHere(cfg, 'https://hub.example.com'), warmHere(cfg, 'http://127.0.0.1:28760')], [true, false]);
  writeFileSync(join(d, 'mode.json'), JSON.stringify({ mode: 'pc' }));
  assert.deepEqual([warmHere(cfg, 'https://hub.example.com'), warmHere(cfg, 'http://127.0.0.1:28760')], [false, true]);
});

test('연결 방식 값 warm: 서버 허용, 기기 명령 device.codex.mode(허용 목록의 대화만, 작업 폴더 그대로)', async (t) => {
  assert.ok(CONNECT_MODES.includes('warm'));
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json');
  writeFileSync(cfg, JSON.stringify({ codex: { allowlist: [TID], workingDirectories: { [TID]: 'C:/w' } } }));
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null });
  assert.equal((await pc.run('device.codex.mode', { threadId: TID, mode: 'warm' })).status, 200);
  const c = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.deepEqual([c.codex.modes[TID], c.codex.workingDirectories[TID]], ['warm', 'C:/w']);
  assert.equal((await pc.run('device.codex.mode', { threadId: '01a18790-0000-4000-8000-000000000009', mode: 'warm' })).body.error, 'not_found');
  assert.equal((await pc.run('device.codex.mode', { threadId: TID, mode: 'fast' })).body.error, 'bad_mode');
});

test('잠금 검사기: 업무 대화는 거절, 검사기가 실패하면 예전 방식으로', async () => {
  await assert.rejects(probeWindowsAsync('01a0dadd-739f-74d2-93c5-9c405cc1019b'), /EXCLUDED_THREAD/);
});

test('화면: 연결 설정에 "빠른 응답" 고르기와 Codex 앱 동시 사용 안내, PC 설정 연결 방식에도', () => {
  const A = koView('app.html'); const S = koView('settings.html');
  assert.ok(A.includes('name="mode" value="warm"') && A.includes('Codex 앱에서 이 대화를 함께 쓰지 마세요'));
  assert.ok(S.includes('<option value="warm">'));
});
