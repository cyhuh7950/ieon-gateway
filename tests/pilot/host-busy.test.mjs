// SV4 동시 질문 수(신산님 2026-11-17 "동시 질문 수 제한 진행해", 설계 SERVER_SESSIONS 2-6): 기기(PC·엔진 칸) 하나가 한꺼번에 맡는 질문
// (기다림+처리 중)이 한도를 넘으면 줄 세우지 않고 host_busy(429)로 거절 — 자동 재전송 없음, 다른 기기는 영향 없음, 끝나면 다시 받음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tempStore, owner } from './helpers.mjs';
import { validateHostLimit } from '../../src/pilot/settings.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const bind = (id, hostId) => ({ conversationId: id, ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId, engine: 'codex_thread', sessionRef: `0000000${id.slice(-1)}-1111-4222-8333-444444444444` });

test('기기 하나에 한도(기본 3)만큼만 받고 넘으면 host_busy — 다른 기기는 그대로, 하나 끝나면 다시 받음, 0이면 한도 없음', (t) => {
  const { store } = tempStore(t, [bind('c_a1', 'h_cell'), bind('c_a2', 'h_cell'), bind('c_a3', 'h_cell'), bind('c_a4', 'h_cell'), bind('c_b1', 'h_pc')]);
  assert.equal(store.hostLimit(), 3);
  const ids = ['c_a1', 'c_a2', 'c_a3'].map((c) => store.submit(owner, c, 'k-' + c, { question: 'q' }));
  assert.ok(ids.every((r) => r.http === 202));
  assert.deepEqual(store.submit(owner, 'c_a4', 'k4', { question: 'q' }), { http: 429, code: 'host_busy', limit: 3 });
  assert.equal(store.submit(owner, 'c_b1', 'kb', { question: 'q' }).http, 202, '다른 기기는 영향 없음');
  // 하나가 끝나면(잠금 풀림) 다시 받는다
  const job = store.claim('h_cell');
  store.report('h_cell', job.requestId, { status: 'completed', answer: 'a' });
  assert.equal(store.submit(owner, 'c_a4', 'k4b', { question: 'q' }).http, 202);
  // 결과 불명(확인 필요)은 기기가 일하는 중이 아니므로 세지 않는다
  const j2 = store.claim('h_cell');
  store.report('h_cell', j2.requestId, { status: 'unknown', errorCode: 'x' });
  store.configureHostLimit(0);
  assert.equal(store.hostLimit(), 0);
});

test('한도 설정값 검사 · 화면·메신저·앱이 host_busy를 안내하고 다시 보내기 버튼을 줌', () => {
  assert.deepEqual(validateHostLimit({ perHost: 5 }), { perHost: 5 });
  assert.deepEqual(validateHostLimit({ perHost: 0 }), { perHost: 0 });
  for (const v of [{ perHost: -1 }, { perHost: 51 }, { perHost: 'x' }, {}]) assert.throws(() => validateHostLimit(v), /bad_host_limit/);
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  const app = read('src/pilot/web/app.html');
  assert.ok(app.includes("host_busy: ['warn',") && app.includes("'conversation_busy', 'host_busy', 'active_limit'"));
  assert.ok(read('src/pilot/messenger/bridge.mjs').includes('host_busy:'));
  assert.ok(read('src/pilot/server.mjs').includes("'active_limit', 'host_busy',"), '방에서도 다시 보내기');
  assert.ok(read('app/src/lib/api.ts').includes('"host_busy"') && read('app/src/lib/texts.ts').includes('host_busy:'));
  const set = read('src/pilot/web/settings.html');
  assert.ok(set.includes('id="hlForm"') && set.includes("saveSetting('host-limit'"));
});
