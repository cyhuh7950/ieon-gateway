// 2026-11-24 신산님 인수 시험에서 찾은 화면 고침(모델 호출 0)
import test from 'node:test';
import assert from 'node:assert/strict';
import { koView } from './web-page.mjs';

test('열어 둔 대화: 예약·메신저에서 온 질문과 답을 목록 새로 읽기 때 다시 그림, 내가 보낸 질문은 다시 그리지 않음', () => {
  const A = koView('app.html');
  assert.ok(A.includes('load().then(() => refreshMsgs())'));
  assert.ok(A.includes('msgsKey = keyOf(r.body.messages)'));
});

test('역할 칸: 만든 역할이 없으면 만드는 곳을 칸 안에 알림, 예약·작업 폴더는 대화 제목과 직원 이름을 같이', () => {
  assert.ok(koView('app.html').includes('만든 역할 없음 — 설정 → 관리 → 메신저 고급 → 역할에서 만들어요'));
  const S = koView('settings.html');
  assert.ok(S.includes("c.label + (c.staff?.name ? ' (@' + c.staff.name + ')' : '')"));
});
