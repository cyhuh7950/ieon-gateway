// W3 예약 작업(설계 WORK_AND_VOICE A4·WV5): 정해진 때 질문만 보냄 — 만들기·다시 켜기 = 사람의 승인(웹 화면 주인만), 하루 한도, 작업 모드 대화는 건너뜀,
// 결과 불명이 남으면 멈춤(다시 켜야 보냄), 보낼 수 없는 회차는 건너뛰고 기록(자동 재전송 없음), 같은 회차는 두 번 가지 않음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSchedule, nextRun, tzOffsetMs, localDay, describeSchedule } from '../../src/pilot/schedules.mjs';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';

test('시간 계산: 매일(서울 벽시계)·간격(밀린 회차 몰아 보내지 않음)·한 번(지나면 없음), 값 검사', () => {
  assert.equal(tzOffsetMs(new Date('2026-11-18T00:00:00Z'), 'Asia/Seoul'), 9 * 3600_000);
  const daily = validateSchedule({ kind: 'daily', time: '09:00', question: 'q' });
  assert.deepEqual([daily.spec, daily.maxPerDay, daily.tz], [{ time: '09:00' }, 1, 'Asia/Seoul']);
  assert.equal(nextRun(daily, new Date('2026-11-17T23:59:00Z')), '2026-11-18T00:00:00.000Z', '서울 9시 = UTC 0시');
  assert.equal(nextRun(daily, new Date('2026-11-18T00:00:00Z')), '2026-11-19T00:00:00.000Z', '지금 그 시각이면 다음 날');
  const iv = validateSchedule({ kind: 'interval', minutes: 60, question: 'q' });
  assert.equal(iv.maxPerDay, 24);
  assert.equal(nextRun({ ...iv, lastRunAt: '2026-11-18T00:00:00Z' }, new Date('2026-11-18T00:10:00Z')), '2026-11-18T01:00:00.000Z');
  assert.equal(nextRun({ ...iv, lastRunAt: '2026-11-17T00:00:00Z' }, new Date('2026-11-18T05:00:00Z')), '2026-11-18T06:00:00.000Z', '꺼져 있던 동안 밀린 회차는 건너뜀');
  const once = validateSchedule({ kind: 'once', at: '2026-11-20T01:00:00Z', question: 'q' });
  assert.equal(nextRun(once, new Date('2026-11-18T00:00:00Z')), '2026-11-20T01:00:00.000Z');
  assert.equal(nextRun(once, new Date('2026-11-21T00:00:00Z')), null);
  assert.equal(localDay(new Date('2026-11-17T15:30:00Z'), 'Asia/Seoul'), '2026-11-18', '하루 횟수는 서울 날짜로');
  assert.equal(describeSchedule(daily), '매일 09:00');
  assert.equal(describeSchedule({ kind: 'interval', spec: { minutes: 120 } }), '2시간마다');
  for (const [v, code] of [[{ kind: 'x', question: 'q' }, 'bad_kind'], [{ kind: 'daily', time: '25:00', question: 'q' }, 'bad_time'], [{ kind: 'interval', minutes: 5, question: 'q' }, 'bad_minutes'],
    [{ kind: 'daily', time: '09:00', question: '' }, 'bad_question'], [{ kind: 'daily', time: '09:00', question: 'q', maxPerDay: 0 }, 'bad_max_per_day'], [{ kind: 'daily', time: '09:00', question: 'q', tz: 'Nope/Zone' }, 'bad_tz']]) {
    assert.throws(() => validateSchedule(v), new RegExp(code));
  }
});

test('서버: 주인 웹 화면만 만들기·켜기, 때가 되면 주인 이름으로 보냄, 처리 중이면 건너뜀, 결과 불명이면 멈추고 다시 켜야 보냄, 작업 모드·하루 한도 건너뜀', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-w3-'));
  const app = createApp({ dbPath: join(d, 'p.db'), schedulesOff: true,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } });
  const call = (path, { method = 'GET', body, token = 'web' } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
  await call('/v1/device/jobs', { token: 'dev' }); // PC 붙음(빈 작업)
  assert.equal((await call('/v1/schedules', { method: 'POST', token: 'msg', body: { conversationId: 'c1', kind: 'interval', minutes: 15, question: 'q' } })).status, 403, '메신저로는 만들 수 없음');
  assert.equal((await call('/v1/schedules', { method: 'POST', token: 'other', body: { conversationId: 'c1', kind: 'interval', minutes: 15, question: 'q' } })).status, 404, '남의 대화');
  const made = await call('/v1/schedules', { method: 'POST', body: { conversationId: 'c1', kind: 'interval', minutes: 15, question: '변경 요약해 줘', maxPerDay: 2 } });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.when, made.body.enabled, made.body.label], ['15분마다', true, 'c1']);
  const id = made.body.scheduleId;
  assert.equal((await call('/v1/schedules', { token: 'other' })).body.schedules.length, 0, '남의 예약은 안 보임');
  const at = (min) => new Date(Date.now() + min * 60_000);
  const get = async () => (await call('/v1/schedules')).body.schedules.find((s) => s.scheduleId === id);
  // 1회차: 보냄(주인 이름, 웹 앱) → 대화에 질문이 쌓임
  app.runSchedules(at(16));
  let s = await get();
  assert.deepEqual([s.lastResult, s.runsToday], ['sent', 1]);
  const job = (await call('/v1/device/jobs', { token: 'dev' })).body;
  assert.equal(job.question, '변경 요약해 줘');
  app.runSchedules(at(16)); // 같은 때 다시 불려도 다음 회차가 아직이므로 아무 일 없음
  assert.equal((await get()).runsToday, 1);
  // 2회차: 앞 질문이 처리 중 → 건너뜀(줄 세우지 않음)
  app.runSchedules(at(40));
  s = await get();
  assert.deepEqual([s.lastResult, s.runsToday], ['conversation_busy', 1]);
  // 앞 질문이 결과 불명으로 끝남 → 다음 회차에 멈춤(보내지 않음)
  await call(`/v1/device/jobs/${job.requestId}/result`, { method: 'POST', token: 'dev', body: { status: 'unknown', errorCode: 'result_unknown' } });
  app.runSchedules(at(60));
  s = await get();
  assert.equal(s.pausedReason, 'last_unknown');
  app.runSchedules(at(90));
  assert.equal((await get()).lastResult, 'conversation_busy', '멈춘 동안은 실행하지 않음(기록 그대로)');
  // 사람이 정리하고 다시 켜면(= 다시 승인) 보냄
  await call(`/v1/requests/${job.requestId}/review`, { method: 'POST', body: { executed: false } });
  const on = await call(`/v1/schedules/${id}`, { method: 'PUT', body: { enabled: true } });
  assert.deepEqual([on.status, on.body.pausedReason, on.body.enabled], [200, null, true]);
  app.runSchedules(at(120));
  s = await get();
  assert.deepEqual([s.lastResult, s.runsToday], ['sent', 2]);
  // 하루 한도(2) — 앞 질문을 끝내도 오늘은 더 보내지 않음
  const job2 = (await call('/v1/device/jobs', { token: 'dev' })).body;
  await call(`/v1/device/jobs/${job2.requestId}/result`, { method: 'POST', token: 'dev', body: { status: 'completed', answer: 'a' } });
  app.runSchedules(at(150));
  assert.equal((await get()).lastResult, 'day_limit');
  // 작업 모드 대화는 질문만 규칙으로 건너뜀
  await call('/v1/conversations/c1/work-mode', { method: 'PUT', body: { on: true } });
  const made2 = await call('/v1/schedules', { method: 'POST', body: { conversationId: 'c1', kind: 'interval', minutes: 15, question: 'q2' } });
  app.runSchedules(at(20));
  assert.equal((await call('/v1/schedules')).body.schedules.find((x) => x.scheduleId === made2.body.scheduleId).lastResult, 'work_mode');
  // 끄기·지우기
  assert.equal((await call(`/v1/schedules/${id}`, { method: 'PUT', body: { enabled: false } })).body.enabled, false);
  assert.equal((await call(`/v1/schedules/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/v1/schedules/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call('/v1/schedules', { method: 'POST', body: { conversationId: 'c1', kind: 'once', at: '2020-01-01T00:00:00Z', question: 'q' } })).body.error, 'bad_at', '지난 시각');
});

test('화면: 설정 → 대화에 예약 작업(만들 때·다시 켤 때 확인 창)', () => {
  const set = readFileSync(fileURLToPath(new URL('../../src/pilot/web/settings.html', import.meta.url)), 'utf8');
  assert.ok(set.includes('aria-label="예약 작업"') && set.includes("api('/v1/schedules'") && set.includes('승인할까요?') && set.includes('다시 켭니다'));
});
