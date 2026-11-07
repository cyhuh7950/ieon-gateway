// P1-a: 메신저 허용 사용자·카카오·새 세션 설정을 서버 DB·웹에서 관리(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';
import { serverApi } from '../../src/pilot/messenger/bridge.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t, { nsFile } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p1a-'));
  let newSessionsConfigPath;
  if (nsFile) { newSessionsConfigPath = join(dir, 'ns.json'); writeFileSync(newSessionsConfigPath, JSON.stringify(nsFile)); }
  const app = createApp({ dbPath: join(dir, 'pilot.db'), newSessionsConfigPath,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }],
    bindings: [{ conversationId: 'c_shared', label: '공용', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' }] });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'web', method = 'GET', body } = {}) => fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  return { app, call, base, dir };
}

test('허용 사용자·카카오: 웹 값이 없으면 file, 저장하면 web, 되돌리면 다시 file. 메신저는 웹 값을 받는다', async (t) => {
  const { call } = await setup(t);
  let s = (await call('/v1/admin/settings')).body;
  assert.deepEqual(s.allowedUsers, { value: null, source: 'file' });
  assert.deepEqual((await call('/v1/messenger/config', { token: 'msg' })).body, { allowedUsers: null, kakao: null });
  assert.equal((await call('/v1/admin/settings/allowed-users', { method: 'PUT', body: { telegram: ['111', ' 111 ', '222'] } })).body.allowedUsers.source, 'web');
  assert.deepEqual((await call('/v1/messenger/config', { token: 'msg' })).body.allowedUsers, { telegram: ['111', '222'] });
  // 검사
  assert.equal((await call('/v1/admin/settings/allowed-users', { method: 'PUT', body: { kakaotalk: ['1'] } })).body.error, 'bad_platform');
  assert.equal((await call('/v1/admin/settings/allowed-users', { method: 'PUT', body: { telegram: ['a b'] } })).body.error, 'bad_user_id');
  assert.equal((await call('/v1/admin/settings/kakao', { method: 'PUT', body: { relayUrl: 'http://evil.example/x' } })).body.error, 'bad_relay_url');
  assert.equal((await call('/v1/admin/settings/kakao', { method: 'PUT', body: { relayUrl: 'https://u:p@h.example' } })).body.error, 'bad_relay_url');
  assert.equal((await call('/v1/admin/settings/kakao', { method: 'PUT', body: { relayUrl: 'https://ieon-gateway.sinsan.kr', callbackLimitMs: 1000 } })).body.error, 'bad_callback_limit');
  s = (await call('/v1/admin/settings/kakao', { method: 'PUT', body: { relayUrl: 'https://ieon-gateway.sinsan.kr/', callbackLimitMs: 30000 } })).body;
  assert.deepEqual(s.kakao.value, { relayUrl: 'https://ieon-gateway.sinsan.kr', callbackLimitMs: 30000 });
  // 웹·메신저 권한: 메신저 토큰은 관리 설정을 못 바꾸고, 웹 토큰은 메신저 설정 API를 못 쓴다
  assert.equal((await call('/v1/admin/settings', { token: 'msg' })).body.error, 'admin_only');
  assert.equal((await call('/v1/messenger/config')).body.error, 'messenger_only');
  // 되돌리기
  s = (await call('/v1/admin/settings/allowed-users', { method: 'DELETE' })).body;
  assert.deepEqual(s.allowedUsers, { value: null, source: 'file' });
});

test('새 세션: 파일 값 위에 웹 값(켜기·한도·정리·기본 권한)을 겹치고 바로 적용, 안전 설정은 웹에서 못 바꾼다', async (t) => {
  const { call, app, dir } = await setup(t, { nsFile: { enabled: false, workspaceRoot: '/ws', limits: { maxSessions: 4, maxActive: 2 } } });
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'aa' } })).body.error, 'new_sessions_disabled');
  for (const [body, err] of [
    [{ permissions: { default: 'full' } }, 'profile_not_allowed'],
    [{ sessionOverrides: {} }, 'field_not_editable'],
    [{ workspaceRoot: 'C:/' }, 'field_not_editable'],
    [{ cleanup: { deleteWorkspaceOnClose: true } }, 'field_not_editable'],
    [{ limits: { maxActive: 9 } }, 'bad_new_sessions:maxActive_over_maxSessions'],
    [{ permissions: { default: 'nope' } }, 'bad_new_sessions:default_profile'],
  ]) assert.equal((await call('/v1/admin/settings/new-sessions', { method: 'PUT', body })).body.error, err, JSON.stringify(body));
  const s = (await call('/v1/admin/settings/new-sessions', { method: 'PUT', body: { enabled: true, limits: { maxSessions: 1, maxActive: 1 }, permissions: { default: 'read_only' } } })).body;
  assert.equal(s.newSessions.effective.enabled, true);
  assert.equal(s.newSessions.effective.limits.maxSessions, 1);
  assert.equal(s.newSessions.effective.limits.maxActive, 1);
  // 한도를 총 한도보다 크게 남기는 조합은 거절(파일 maxActive 2 > 웹 maxSessions 1)
  assert.equal((await call('/v1/admin/settings/new-sessions', { method: 'PUT', body: { limits: { maxSessions: 1 } } })).body.error, 'bad_new_sessions:maxActive_over_maxSessions');
  assert.equal(s.newSessions.effective.workspaceRoot, '/ws'); // 작업 폴더는 파일 값 그대로
  assert.deepEqual(s.newSessions.effective.permissions.profiles, ['read_only', 'workspace']);
  // 바로 적용: 켜져서 만들 수 있고, 기본 권한·한도가 웹 값
  assert.deepEqual((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'aa' } })).body,
    { conversationId: 'n_aa', name: 'aa', engine: 'codex', profile: 'read_only' });
  assert.deepEqual((await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'bb' } })).body, { error: 'session_limit', limit: 1 });
  // 되돌리면 파일 값(꺼짐)
  await call('/v1/admin/settings/new-sessions', { method: 'DELETE' });
  assert.equal((await call('/v1/sessions/limits')).body.error, 'new_sessions_disabled');
  assert.ok(dir && app);
});

test('새 세션 파일이 없어도 웹에서 켤 수 있고, 다시 시작해도 웹 값이 유지된다', async (t) => {
  const { call, app } = await setup(t);
  assert.equal((await call('/v1/admin/settings')).body.newSessions.effective, null);
  await call('/v1/admin/settings/new-sessions', { method: 'PUT', body: { enabled: true } });
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { engine: 'claude', name: 'cc' } })).status, 201);
  assert.deepEqual(app.store.getSetting('newSessions').value, { enabled: true });
});

test('메신저 실행기: 웹 허용 사용자가 있으면 그 값, 없으면 파일 값을 쓰고 카카오 설정을 러너에 넘긴다', async (t) => {
  const { call, base, dir } = await setup(t);
  writeFileSync(join(dir, 'msg.token'), 'msg');
  const started = [];
  const fake = (platform) => (o) => { started.push({ platform, settings: o.settings, o }); o.log({ platform, event: 'started', bot: '@b' }); };
  const runner = createBotRunner({
    api: serverApi(base, join(dir, 'msg.token')),
    apiFor: (p, id) => serverApi(base, join(dir, 'msg.token'), `${p}:${id}`),
    env: { TELEGRAM_BOT_TOKEN: 'T0' }, allowedUsers: { telegram: ['FILE'] }, roomsPath: join(dir, 'rooms.json'),
    runners: { telegram: fake('telegram'), discord: fake('discord'), slack: fake('slack') }, bridgeOpts: { pollMs: 1, waitMs: 200 } });
  t.after(() => runner.stopAll());
  await runner.sync();
  const tg = started.find((s) => s.platform === 'telegram');
  const say = async (user) => { const out = []; await tg.o.onMessage({ platform: 'telegram', userId: user, chatId: '-1', text: '/sessions' }, async (x) => out.push(x)); return out; };
  assert.equal((await say('FILE')).length, 1);
  assert.equal((await say('WEB')).length, 0);
  await call('/v1/admin/settings/allowed-users', { method: 'PUT', body: { telegram: ['WEB'] } });
  await runner.sync();
  assert.equal((await say('WEB')).length, 1);
  assert.equal((await say('FILE')).length, 0); // 웹 값이 있으면 파일 값은 쓰지 않는다
  assert.deepEqual(tg.settings, { kakao: null });
});

test('P1-b 기존 세션 등록: 파일 등록은 보기만, 웹 등록은 추가·수정·삭제, 업무 대화·모르는 PC는 거절', async (t) => {
  const { call, app } = await setup(t);
  let r = (await call('/v1/admin/bindings')).body;
  assert.deepEqual(r.hosts, ['h_sinsan']);
  assert.deepEqual(r.bindings.map((b) => [b.conversationId, b.label, b.source]), [['c_shared', '공용', 'file']]);
  // 파일 등록은 웹에서 못 바꾸고 못 지운다
  const codex = { label: '내 프로젝트', engine: 'codex_thread', hostId: 'h_sinsan', sessionRef: '01b2c3d4-0000-7000-8000-000000000001', appIds: ['app_web', 'app_messenger'] };
  assert.equal((await call('/v1/admin/bindings/c_shared', { method: 'PUT', body: codex })).body.error, 'file_managed');
  assert.equal((await call('/v1/admin/bindings/c_shared', { method: 'DELETE' })).body.error, 'file_managed');
  // 검사
  for (const [id, body, err] of [
    ['bad id', codex, 'not_found'], ['n_x', codex, 'bad_conversation_id'],
    ['c_x', { ...codex, sessionRef: '01a0dadd-739f-74d2-93c5-9c405cc1019b' }, 'excluded_session'],
    ['c_x', { ...codex, hostId: 'h_other' }, 'unknown_host'],
    ['c_x', { ...codex, sessionRef: 'not-a-uuid' }, 'bad_session_ref'],
    ['c_x', { ...codex, label: '' }, 'bad_label'],
    ['c_x', { ...codex, engine: 'gpt' }, 'bad_engine'],
  ]) assert.equal((await call(`/v1/admin/bindings/${encodeURIComponent(id)}`, { method: 'PUT', body })).body.error, err, id + JSON.stringify(body).slice(0, 40));
  // 등록 → 목록·메신저에 보임
  r = (await call('/v1/admin/bindings/c_myproj', { method: 'PUT', body: codex })).body;
  assert.equal(r.source, 'web');
  const list = (await call('/v1/conversations')).body.conversations;
  assert.deepEqual(list.find((c) => c.conversationId === 'c_myproj').label, '내 프로젝트');
  assert.ok((await call('/v1/conversations', { token: 'msg' })).body.conversations.some((c) => c.conversationId === 'c_myproj'));
  // 수정(웹 전용으로 범위 좁히기)
  await call('/v1/admin/bindings/c_myproj', { method: 'PUT', body: { ...codex, label: '이름 바꿈', appIds: ['app_web'] } });
  assert.ok(!(await call('/v1/conversations', { token: 'msg' })).body.conversations.some((c) => c.conversationId === 'c_myproj'));
  // 서버를 다시 켠 것처럼 파일 등록을 다시 넣어도 웹 등록은 그대로
  app.store.addBinding({ conversationId: 'c_shared', label: '공용', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' });
  assert.equal((await call('/v1/admin/bindings')).body.bindings.find((b) => b.conversationId === 'c_myproj').label, '이름 바꿈');
  // 처리 중이면 대상 변경·삭제 거절
  await fetch(`http://127.0.0.1:${app.server.address().port}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } });
  app.store.submit({ userId: 'u_sinsan', appId: 'app_web' }, 'c_myproj', 'k-p1b-0001', { question: 'q' });
  assert.equal((await call('/v1/admin/bindings/c_myproj', { method: 'PUT', body: { ...codex, sessionRef: '01b2c3d4-0000-7000-8000-000000000002' } })).body.error, 'conversation_busy');
  assert.equal((await call('/v1/admin/bindings/c_myproj', { method: 'DELETE' })).body.error, 'conversation_busy');
  // 새 세션은 이 경로로 못 바꾼다
  await call('/v1/admin/settings/new-sessions', { method: 'PUT', body: { enabled: true } });
  await call('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'ns1' } });
  assert.ok(!(await call('/v1/admin/bindings')).body.bindings.some((b) => b.conversationId === 'n_ns1'));
});
