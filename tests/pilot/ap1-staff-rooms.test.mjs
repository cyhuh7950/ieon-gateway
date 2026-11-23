// AP-1(MESSENGER_EXPANSION B2·B3, AP2): AI 직원(대화에 이름·역할·아이콘)과 방. 부른 직원만 답하고, 아무도 안 부르면 대표,
// 사용 중이면 보내지 않고 알림만(자동 재전송 없음), 넘기기는 사용자가 누를 때만, AI끼리 스스로 부르지 않음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T = (n) => `01a18790-0000-7000-8000-00000000000${n}`;

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap1-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const conv = (id, label, n) => ({ conversationId: id, label, ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T(n) });
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [conv('c_a', '설계 담당', 1), conv('c_b', '코드 담당', 2), conv('c_c', '검토 담당', 3)] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  let k = 0;
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key !== undefined ? { 'idempotency-key': key } : method === 'POST' && path.includes('/rooms/') ? { 'idempotency-key': `key-${++k}-xxxxxxxx` } : {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const online = () => fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } });
  // 연결부 흉내: 작업 하나를 가져가 답한다
  const claim = async () => { const r = await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }); return r.status === 200 ? r.json() : null; };
  const finish = (job, answer) => fetch(`${base}/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'completed', receipt: 'r', answer }) });
  return { app, call, online, claim, finish };
}

test('AI 직원: 이름(빈칸 없이·겹치지 않게)·역할·아이콘, 목록에 보이고 이름이 없으면 대화 이름', async (t) => {
  const s = await setup(t);
  let list = (await s.call('/v1/conversations')).body.conversations;
  assert.equal(list.find((c) => c.conversationId === 'c_a').staff.name, '설계담당', '이름이 없으면 대화 이름(빈칸 없앰)');
  assert.equal((await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '설계 담당' } })).body.error, 'bad_staff_name');
  assert.equal((await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '하나', icon: '가나다' } })).body.error, 'bad_icon');
  assert.equal((await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '하나', roleId: 'nope' } })).body.error, 'unknown_role');
  assert.equal((await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '하나', icon: '🧭' } })).status, 200);
  assert.equal((await s.call('/v1/conversations/c_b/staff', { method: 'PUT', body: { name: '하나' } })).body.error, 'staff_name_taken');
  assert.equal((await s.call('/v1/conversations/c_b/staff', { method: 'PUT', body: { name: '둘' }, token: 'msg' })).status, 403, '메신저 키로는 못 바꿈');
  assert.equal((await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '셋' }, token: 'other' })).status, 404, '남의 대화');
  list = (await s.call('/v1/conversations')).body.conversations;
  assert.deepEqual({ ...list.find((c) => c.conversationId === 'c_a').staff, roleId: undefined }, { name: '하나', roleName: null, roleId: undefined, icon: '🧭', set: true });
});

test('역할 안내는 역할을 정한 뒤 다음 질문 한 번에만 붙고, 저장된 질문은 원문', async (t) => {
  const s = await setup(t);
  s.app.store.saveRole({ roleId: 'reviewer', name: '검토자', description: '', engines: ['codex'], profiles: ['read_only'], aiGuide: '꼼꼼히 검토해' });
  await s.call('/v1/conversations/c_c/staff', { method: 'PUT', body: { name: '검토', roleId: 'reviewer' } });
  await s.online();
  const ask = async (q, k) => s.call('/v1/conversations/c_c/requests', { method: 'POST', body: { question: q }, key: k });
  await ask('첫 질문', 'k-ap1-role-0001');
  let job = await s.claim();
  assert.equal(job.question, '[역할 안내]\n꼼꼼히 검토해\n\n[질문]\n첫 질문');
  await s.finish(job, '답1');
  await ask('둘째 질문', 'k-ap1-role-0002');
  job = await s.claim();
  assert.equal(job.question, '둘째 질문', '두 번째부터는 붙지 않음');
  await s.finish(job, '답2');
  assert.deepEqual((await s.call('/v1/conversations/c_c/messages')).body.messages.map((m) => m.question), ['첫 질문', '둘째 질문']);
});

test('방: @이름으로 부른 직원만, 아무도 안 부르면 대표, 방 안내는 머리말로만, 사용 중이면 알림(자동 재전송 없음)', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '설계' } });
  await s.call('/v1/conversations/c_b/staff', { method: 'PUT', body: { name: '코드' } });
  assert.equal((await s.call('/v1/rooms', { method: 'POST', body: { name: '새 기능', members: ['c_a', 'c_b'], lead: 'c_c' } })).body.error, 'bad_lead');
  assert.equal((await s.call('/v1/rooms', { method: 'POST', body: { name: '새 기능', members: ['c_a', 'c_x'], lead: 'c_a' } })).body.error, 'bad_members');
  const room = (await s.call('/v1/rooms', { method: 'POST', body: { name: '새 기능', members: ['c_a', 'c_b'], lead: 'c_a', guide: '로그인 화면을 만든다' } })).body;
  assert.ok(room.roomId.startsWith('room_'));
  await s.online();
  // 아무도 안 부름 → 대표(설계)만
  let r = await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '어떻게 나눌까?' } });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body.posts.filter((p) => p.kind === 'ask').map((p) => p.conversationId), ['c_a']);
  let job = await s.claim();
  assert.equal(job.question, '[방 안내 — 새 기능]\n로그인 화면을 만든다\n\n[질문]\n어떻게 나눌까?');
  assert.equal(await s.claim(), null, '다른 직원에게는 가지 않음');
  // 설계는 아직 처리 중 → @설계 @코드: 코드만 보내고 설계는 "다른 일 중"
  r = await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '@설계 @코드 화면 나눠 줘' } });
  const last = r.body.posts.slice(-3);
  assert.deepEqual(last.map((p) => [p.kind, p.conversationId ?? null, p.code ?? null]), [['user', null, null], ['busy', 'c_a', 'conversation_busy'], ['ask', 'c_b', null]]);
  await s.finish(job, '두 부분으로');
  const job2 = await s.claim();
  assert.equal(job2.sessionRef, T(2));
  assert.equal(await s.claim(), null, '사용 중이던 설계에게 자동으로 다시 보내지 않음');
  // 같은 키로 다시 보내도 두 번 보내지 않음
  const before = (await s.call(`/v1/rooms/${room.roomId}`)).body.posts.length;
  await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '같은 글' }, key: 'same-key-0001' });
  await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '같은 글' }, key: 'same-key-0001' });
  assert.equal((await s.call(`/v1/rooms/${room.roomId}`)).body.posts.length, before + 2, '글 1 + 대표 1(busy든 ask든)');
  // 방 기록은 주인만
  assert.equal((await s.call(`/v1/rooms/${room.roomId}`, { token: 'other' })).status, 404);
  assert.equal((await s.call('/v1/rooms', { token: 'msg' })).status, 403);
});

test('넘기기: 끝난 답을 인용해 사용자가 고른 한 명에게만, 끝나지 않은 답은 못 넘김', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '설계' } });
  await s.call('/v1/conversations/c_b/staff', { method: 'PUT', body: { name: '코드' } });
  const room = (await s.call('/v1/rooms', { method: 'POST', body: { name: '방', members: ['c_a', 'c_b'], lead: 'c_a' } })).body;
  await s.online();
  const p = (await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '설계해 줘' } })).body.posts.find((x) => x.kind === 'ask');
  assert.equal((await s.call(`/v1/rooms/${room.roomId}/handoff`, { method: 'POST', body: { requestId: p.requestId, to: 'c_b' } })).body.error, 'bad_handoff', '아직 답이 없음');
  const job = await s.claim(); await s.finish(job, '화면 3개로 나눔');
  const r = await s.call(`/v1/rooms/${room.roomId}/handoff`, { method: 'POST', body: { requestId: p.requestId, to: 'c_b', note: '이대로 만들어 줘' } });
  assert.equal(r.status, 202);
  const job2 = await s.claim();
  assert.equal(job2.sessionRef, T(2));
  assert.ok(job2.question.endsWith('[질문]\n[설계의 답]\n화면 3개로 나눔\n\n이대로 만들어 줘') || job2.question === '[설계의 답]\n화면 3개로 나눔\n\n이대로 만들어 줘', job2.question);
  await s.finish(job2, '만들었음');
  assert.equal(await s.claim(), null, '코드의 답이 설계에게 저절로 가지 않음(AI끼리 부르기 없음)');
  assert.equal((await s.call(`/v1/rooms/${room.roomId}/handoff`, { method: 'POST', body: { requestId: p.requestId, to: 'c_x' } })).body.error, 'bad_handoff');
});

test('② 내 허브인 PC 서버는 방 글도 받지 않는다(이 PC 화면 질문과 같음), 방 지우기는 방 기록만', async (t) => {
  const s = await setup(t);
  const room = (await s.call('/v1/rooms', { method: 'POST', body: { name: '방', members: ['c_a'], lead: 'c_a' } })).body;
  s.app.hubLink.hubMode = () => true;
  assert.equal((await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '안녕' } })).body.error, 'hub_mode');
  s.app.hubLink.hubMode = () => false;
  assert.equal((await s.call(`/v1/rooms/${room.roomId}`, { method: 'DELETE' })).status, 204);
  assert.equal((await s.call(`/v1/rooms/${room.roomId}`)).status, 404);
  assert.equal((await s.call('/v1/conversations')).body.conversations.length, 3, '대화(AI 직원)는 그대로');
});

test('화면: 왼쪽 방 목록·방 만들기 창·@이름 안내·사용 중 알림·넘기기 버튼(누를 때만), AI 직원 이름·역할·아이콘', () => {
  const A = koView('app.html');
  assert.ok(A.includes('id="roomDlg"') && A.includes('id="rdMembers"') && A.includes('id="rdLead"') && A.includes('id="rdGuide"'));
  assert.ok(A.includes("nr.onclick = () => openRoomDlg(null)") && A.includes("b.onclick = () => selectRoom(r.roomId)"));
  assert.ok(A.includes("'@이름으로 부르기 — 안 부르면 대표(@'")); // 2026-11-23 조사: 대표(@이름)가
  assert.ok(A.includes("conversation_busy: '지금 다른 일 중이라 보내지 않았어요'") && A.includes('retryBtn(box, room, p)') && A.includes('if (!p.canRetry) return;'), '사용 중은 알림 + 서버가 허락한 글만 다시 보내기 버튼');
  assert.ok(A.includes("hb.onclick = () => handoff(room, p, others)"), '넘기기는 버튼을 누를 때만');
  assert.ok(A.includes('id="pStaff"') && A.includes('id="stName"') && A.includes('id="stRole"') && A.includes('id="stIcon"'));
  assert.ok(!/setTimeout\([^)]*sendRoom/.test(A), '방 글을 자동으로 다시 보내지 않음');
});

test('방 다시 보내기: 보내지 않은 것이 확실한 글만·누를 때만·한 번만, 결과 불명은 대상 아님, 원문은 응답에 내보내지 않음', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c_a/staff', { method: 'PUT', body: { name: '설계' } });
  const room = (await s.call('/v1/rooms', { method: 'POST', body: { name: '방', members: ['c_a'], lead: 'c_a' } })).body;
  // PC 연결 전(끊김) → 보내지 않은 글
  let posts = (await s.call(`/v1/rooms/${room.roomId}/posts`, { method: 'POST', body: { text: '비밀 질문' } })).body.posts;
  const busy = posts.find((p) => p.kind === 'busy');
  assert.deepEqual([busy.code, busy.canRetry], ['device_unavailable', true]);
  assert.ok(!JSON.stringify(posts).includes('resend') && posts.filter((p) => p.kind === 'busy').every((p) => p.text === null), '다시 보내기용 원문은 응답에 없음');
  await s.online();
  posts = (await s.call(`/v1/rooms/${room.roomId}/retry`, { method: 'POST', body: { postId: busy.postId } })).body.posts;
  assert.equal(posts.at(-1).kind, 'ask');
  assert.equal(posts.find((p) => p.postId === busy.postId).canRetry, false, '한 번만');
  assert.equal((await s.call(`/v1/rooms/${room.roomId}/retry`, { method: 'POST', body: { postId: busy.postId } })).body.error, 'bad_retry');
  // 연결부가 "Desktop이 열어 둠"으로 실패 → 다시 보내기 가능
  let job = await s.claim();
  assert.equal(job.question, '비밀 질문', '같은 원문');
  await fetch(`${'http://127.0.0.1:' + s.app.server.address().port}/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'failed', errorCode: 'desktop_holds_thread', http: 409 }) });
  posts = (await s.call(`/v1/rooms/${room.roomId}`)).body.posts;
  const failed = posts.at(-1);
  assert.deepEqual([failed.status, failed.errorCode, failed.canRetry], ['failed', 'desktop_holds_thread', true]);
  await s.call(`/v1/rooms/${room.roomId}/retry`, { method: 'POST', body: { postId: failed.postId } });
  job = await s.claim();
  // 결과 불명이면 다시 보내기 없음
  await fetch(`${'http://127.0.0.1:' + s.app.server.address().port}/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'unknown', unknownCode: 'result_unknown' }) });
  const unknown = (await s.call(`/v1/rooms/${room.roomId}`)).body.posts.at(-1);
  assert.deepEqual([unknown.status, unknown.canRetry], ['unknown', false]);
  assert.equal((await s.call(`/v1/rooms/${room.roomId}/retry`, { method: 'POST', body: { postId: unknown.postId } })).body.error, 'bad_retry');
  assert.equal(await s.claim(), null, '자동으로 다시 보내지 않음');
});
