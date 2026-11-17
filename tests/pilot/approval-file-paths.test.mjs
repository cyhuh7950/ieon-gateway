// 승인 카드에 파일 경로(신산님 2026-11-18 "고쳐 주세요", WORK_STATUS 0-198): 실제 Codex app-server의 파일 수정 승인 요청에는 경로가 없어
// 카드가 "파일 수정"뿐이었다 → 같은 차례의 fileChange 항목(item/started·patchUpdated)에서 경로를 가져와 붙이고, 작업 폴더·공유(쓰기) 폴더 밖이면 표시. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appServerTurn, approvalSummary, fileChangeSummary } from '../../src/pilot/adapters/codex-thread.mjs';

const T = '01a18790-0000-7000-8000-000000000001';

test('작업 패널: 겹친 그리기는 마지막 것만, 내용이 그대로면 다시 그리지 않음(누르는 사이 버튼이 바뀌어 클릭이 사라지던 문제), 승인 실패는 버튼에 표시', () => {
  const app = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
  assert.ok(app.includes('if (gen !== taskGen) return;') && app.includes('sig === taskSig') && app.includes("' — 다시 눌러 주세요('"));
});

test('요약: 경로(3개까지)·작업 폴더 밖 표시, 경로를 모르면 그렇다고 말함', () => {
  assert.equal(fileChangeSummary(['D:\\w\\a.txt'], ['D:/w']), '파일 수정 1개: D:/w/a.txt');
  assert.equal(fileChangeSummary(['D:/w/shared/a.txt', 'D:/out/b.txt'], ['D:/w/me', 'D:/w/shared']),
    '파일 수정 2개 — 작업 폴더 밖 1개: D:/w/shared/a.txt, D:/out/b.txt (작업 폴더 밖)');
  assert.equal(fileChangeSummary(['d:/W/x', 'd:/w/y', 'd:/w/z', 'd:/w/q'], ['D:/w']), '파일 수정 4개: d:/W/x, d:/w/y, d:/w/z 외 1개', '대소문자 무시(Windows)');
  assert.equal(fileChangeSummary(['D:/wx/a'], ['D:/w']), '파일 수정 1개 — 작업 폴더 밖 1개: D:/wx/a (작업 폴더 밖)', '이름이 비슷한 옆 폴더는 밖');
  assert.equal(fileChangeSummary([], ['D:/w']), null);
  assert.equal(approvalSummary('item/fileChange/requestApproval', {}), '파일 수정(어느 파일인지 엔진이 알려 주지 않음)');
  assert.equal(approvalSummary('item/fileChange/requestApproval', { grantRoot: 'D:\\out' }), '작업 폴더 밖 쓰기 요청: D:/out');
  assert.ok(approvalSummary('item/fileChange/requestApproval', { changes: 'x'.repeat(50).split('').map((_, i) => `D:/w/${'f'.repeat(90)}${i}`), roots: ['D:/w'] }).length <= 300);
});

test('작업 모드 차례: 승인 요청 전에 온 fileChange 항목 경로가 카드 요약에 들어감(실제 app-server 순서)', async () => {
  let h = () => {}; const sent = [];
  const emit = (m) => setTimeout(() => h(m), 1);
  const tr = { onMessage: (fn) => { h = fn; }, close() {}, send: (m) => { sent.push(m);
    if (m.method === 'initialize' || m.method === 'thread/resume') emit({ id: m.id, result: {} });
    else if (m.method === 'turn/start') {
      emit({ id: m.id, result: { turn: { id: 'turn_1' } } });
      emit({ method: 'item/started', params: { threadId: T, turnId: 'turn_1', item: { type: 'fileChange', id: 'fc1', status: 'inProgress',
        changes: [{ path: 'D:/w/shared/a.txt', kind: { type: 'add' }, diff: '' }, { path: 'D:/out/b.txt', kind: { type: 'add' }, diff: '' }] } } });
      emit({ id: 901, method: 'item/fileChange/requestApproval', params: { threadId: T, turnId: 'turn_1', itemId: 'fc1', startedAtMs: 1 } });
    } else if (m.id === 901) emit({ method: 'turn/completed', params: { threadId: T, turn: { id: 'turn_1', status: 'completed' } } });
  } };
  const asked = [];
  await appServerTurn(tr, { threadId: T, question: 'q', cwd: 'D:/w/me', extraRoots: ['D:/w/shared'], approve: async (a) => { asked.push(a); return 'decline'; } });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].summary, '파일 수정 2개 — 작업 폴더 밖 1개: D:/w/shared/a.txt, D:/out/b.txt (작업 폴더 밖)');
  assert.deepEqual(sent.find((m) => m.id === 901).result, { decision: 'decline' });
});
