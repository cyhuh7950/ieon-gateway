// AP-4b 휴대폰 알림: 웹 설정에 키·앱 설정 파일 올리기(키 원문은 다시 안 보임), 앱이 알림 주소 알리기, 답·허락 대기·실패 때 원문 없는 알림,
// 더는 안 쓰는 주소는 지움, 구글 로그인(JWT) 서명. 실제 구글에는 보내지 않음(가짜 fetch). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, createVerify } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createPusher, pushNote, validateServiceAccount, validateGoogleServices } from '../../src/pilot/push.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000001';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { type: 'service_account', project_id: 'ieon-test', client_email: 'push@ieon-test.iam.gserviceaccount.com', private_key: PEM, private_key_id: 'x' };
const GS = { project_info: { project_id: 'ieon-test' }, client: [{ client_info: { android_client_info: { package_name: 'kr.sinsan.ieon' } } }] };

test('알림 글: 원문 없이 이름 + 정해진 말, 접수·실행 중은 알리지 않음', () => {
  assert.deepEqual(pushNote({ type: 'request', requestId: 'r1', status: 'completed' }, '시험 표식 확인'), { body: '시험 표식 확인이 답했어요', tag: 'r:r1' });
  assert.deepEqual(pushNote({ type: 'approval', approvalId: 'a1', status: 'pending' }, '코덱스'), { body: '코덱스가 허락을 기다려요', tag: 'a:a1' });
  assert.equal(pushNote({ type: 'request', requestId: 'r1', status: 'failed' }, 'X').body, 'X에게 보내지 못했어요');
  assert.equal(pushNote({ type: 'request', requestId: 'r1', status: 'queued' }, 'X'), null);
  assert.equal(pushNote({ type: 'approval', approvalId: 'a1', status: 'running' }, 'X'), null);
});

test('키·앱 설정 파일 검사', () => {
  assert.deepEqual(Object.keys(validateServiceAccount(JSON.stringify(SA))), ['projectId', 'clientEmail', 'privateKey']);
  assert.throws(() => validateServiceAccount({ ...SA, type: 'user' }), /bad_push_key/);
  assert.throws(() => validateServiceAccount('not json'), /bad_push_key/);
  assert.equal(validateGoogleServices(GS).project_info.project_id, 'ieon-test');
  assert.throws(() => validateGoogleServices({ ...GS, client: [{ client_info: { android_client_info: { package_name: 'other.app' } } }] }), /wrong_package/);
});

test('구글 로그인은 서비스 계정 키로 서명한 JWT, 토큰은 다시 씀, 없는 주소는 gone', async () => {
  const calls = [];
  const fetchImpl = async (url, opt) => {
    calls.push({ url, opt });
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'at-1' }) };
    if (opt.body.includes('"token":"gone-token"')) return { ok: false, status: 404, text: async () => 'UNREGISTERED' };
    return { ok: true, text: async () => '{}' };
  };
  const p = createPusher({ fetchImpl });
  const sa = validateServiceAccount(SA);
  assert.equal(await p.send(sa, 'tok-aaaaaaaaaaaaaaaaaaaa', { body: '코덱스가 답했어요', conversationId: 'c1', tag: 'r:1' }), 'sent');
  assert.equal(await p.send(sa, 'gone-token', { body: 'x', conversationId: 'c1', tag: 'r:2' }), 'gone');
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, '로그인 토큰은 한 번만 받음');
  const jwt = new URLSearchParams(calls[0].opt.body).get('assertion').split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${jwt[0]}.${jwt[1]}`).verify(publicKey, Buffer.from(jwt[2], 'base64url')), '서비스 계정 키로 서명');
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const msg = JSON.parse(calls[1].opt.body).message;
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/ieon-test/messages:send');
  assert.deepEqual([msg.token, msg.notification.body, msg.data.conversationId], ['tok-aaaaaaaaaaaaaaaaaaaa', '코덱스가 답했어요', 'c1']);
});

test('서버: 키를 올리면(다시 안 보임) 앱이 알린 주소로 답·허락 대기 알림, 다른 사람 대화는 안 감, 없는 주소는 지움', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap4b-'));
  const sent = [];
  const pusher = { send: async (sa, token, note) => { sent.push({ project: sa.projectId, token, ...note }); return token === 'gone-token-0000000000000' ? 'gone' : 'sent'; } };
  const app = createApp({ dbPath: join(d, 'p.db'), pusher,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '시험 표식 확인', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c_o', label: '남의 대화', ownerUserId: 'u_other', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000002' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  // 키·앱 설정 파일 올리기
  assert.equal((await call('/v1/admin/settings/push-key', { method: 'PUT', body: { serviceAccount: { ...SA, type: 'x' } } })).body.error, 'bad_push_key');
  const v = (await call('/v1/admin/settings/push-key', { method: 'PUT', body: { serviceAccount: JSON.stringify(SA) } })).body;
  assert.deepEqual(v.push, { configured: true, projectId: 'ieon-test', appFile: false, appFileProject: null });
  assert.ok(!JSON.stringify(v).includes('PRIVATE KEY'), '키 원문은 응답에 없음');
  assert.equal((await call('/v1/admin/settings/push-app', { method: 'PUT', body: { googleServices: GS } })).body.push.appFile, true);
  assert.equal((await call('/v1/admin/settings/push-app/file')).body.project_info.project_id, 'ieon-test');
  // 앱 연결 → 알림 주소 알리기
  const code = (await call('/v1/admin/app-devices/code', { method: 'POST', body: {} })).body.code;
  const app1 = (await fetch(base + '/v1/app/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: '폰' }) }).then((r) => r.json())).token;
  assert.equal((await call('/v1/app/push-token', { method: 'PUT', token: 'web', body: { token: 'x'.repeat(30) } })).body.error, 'app_only');
  assert.deepEqual((await call('/v1/app/push-token', { method: 'PUT', token: app1, body: { token: 'fcm-token-aaaaaaaaaaaaaaaaaaaa' } })).body, { push: true, configured: true });
  assert.equal((await call('/v1/admin/app-devices')).body.devices[0].push, true);
  // 질문 → 연결부가 끝냄 → 알림
  await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } });
  const q = (await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: '비밀 질문' }, key: 'k-ap4b-0001' })).body;
  const job = await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }).then((r) => r.json());
  await fetch(base + `/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'completed', answer: '비밀 답' }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent.map((s) => [s.token, s.body, s.conversationId]), [['fcm-token-aaaaaaaaaaaaaaaaaaaa', '시험 표식 확인이 답했어요', 'c1']]);
  assert.ok(!JSON.stringify(sent).includes('비밀'), '질문·답 원문 없음');
  assert.equal(q.requestId, job.requestId);
  // 다른 사람 대화의 소식은 이 앱으로 안 감
  sent.length = 0;
  app.store.submit({ userId: 'u_other', appId: 'app_web' }, 'c_o', 'k-ap4b-0002', { question: 'q' });
  const j2 = app.store.claim('h_pc');
  await fetch(base + `/v1/device/jobs/${j2.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'completed', answer: 'a' }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0);
  // 더는 안 쓰는 주소 → 지움
  await call('/v1/app/push-token', { method: 'PUT', token: app1, body: { token: 'gone-token-0000000000000' } });
  await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q2' }, key: 'k-ap4b-0003' });
  const j3 = await fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }).then((r) => r.json());
  await fetch(base + `/v1/device/jobs/${j3.requestId}/result`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'failed', errorCode: 'x' }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.at(-1).body, '시험 표식 확인에게 보내지 못했어요');
  assert.equal((await call('/v1/admin/app-devices')).body.devices[0].push, false, '없는 주소는 지움');
});
