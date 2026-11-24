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

test('작업 폴더: 10초마다 새로 읽을 때 열어 둔 폴더 정하기 칸은 닫지 않음(신산님 "금방 없어져서 불편해")', () => {
  const S = koView('settings.html');
  assert.equal((S.match(/if \(\$\('wsEdit'\)\.hidden\) loadWsTargets\(\)/g) || []).length, 2);
});

test('인수 시험 모은 고침: 계정 탭은 PC부터, 사용량은 PC 이름, 정리한 질문은 "실행 안 됨", 설치 파일 기기 이름, 서버 Claude는 못 쓰는 이유', () => {
  const S = koView('settings.html'); const A = koView('app.html');
  assert.ok(S.includes("acTarget === 'local' ? (pcList.length ? pcTarget : 'hub') : acTarget); /*"));
  assert.ok(S.includes('hostNames.get('));
  assert.ok(A.includes('실행 안 됨') && A.includes('tStateOf(tk)') && A.includes('tStateOf(x)'));
  assert.ok(S.includes('설치 파일에 적힌 PC') && S.includes('이 PC에서는 쓸 수 없어요 — 서버 엔진 칸'));
});
