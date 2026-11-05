import test from 'node:test';
import assert from 'node:assert/strict';
import { tempStore, owner, stranger, otherApp } from './helpers.mjs';
import { loadNewSessionsConfig, resolveProfile, validateName } from '../../src/pilot/new-sessions.mjs';

const messenger = { userId: 'u_sinsan', appId: 'app_messenger' };
const cfg = (over = {}) => loadNewSessionsConfig({ enabled: true, workspaceRoot: '/ws', ...over });
const req = (name, engine = 'codex', extra = {}) => ({ engine, name, hostId: 'h_sinsan', via: 'web', ...extra });

test('설정: 기본값을 채우고 잘못된 값은 거부한다', () => {
  const c = loadNewSessionsConfig({});
  assert.equal(c.enabled, false);
  assert.deepEqual(c.limits, { maxSessions: 10, maxActive: 3, maxPerEngine: { codex: 10, claude: 3 } });
  assert.equal(c.permissions.default, 'workspace');
  assert.equal(c.permissions.allowFullFromChat, false);
  assert.deepEqual(Object.keys(c.permissions.profiles), ['read_only', 'workspace', 'full']);
  assert.deepEqual(c.cleanup, { idleSleepMinutes: 30, archiveAfterDays: 14, archiveNoticeDays: 3,
    deleteRequiresConfirm: true, deleteWorkspaceOnClose: false });
  assert.deepEqual(c.creatorApps, ['app_web', 'app_messenger', 'app_bot_*']);

  // 일부만 바꿔도 나머지 기본값은 유지된다.
  assert.equal(loadNewSessionsConfig({ limits: { maxActive: 2 } }).limits.maxSessions, 10);

  for (const bad of [
    { limits: { maxSessions: 0 } },
    { limits: { maxSessions: 2, maxActive: 3 } },
    { limits: { maxPerEngine: { codex: -1 } } },
    { permissions: { default: 'nope' } },
    { permissions: { profiles: { x: { codex: { sandbox: 'danger-full-access', network: false }, claude: { allowedTools: [] } } } } },
    { cleanup: { idleSleepMinutes: 0 } },
    { sessionOverrides: { abc: { profile: 'nope' } } },
  ]) assert.throws(() => loadNewSessionsConfig(bad), /new_sessions_config/, JSON.stringify(bad));
});

test('이름: 영문·숫자·- 2~32자만 받는다', () => {
  for (const ok of ['ab', 'my-project', 'A1-b2', 'x'.repeat(32)]) assert.equal(validateName(ok), true, ok);
  for (const bad of ['a', 'x'.repeat(33), '한글', 'a_b', 'a b', '-ab', 'ab-', '../x', '', null]) {
    assert.equal(validateName(bad), false, String(bad));
  }
});

test('권한: 기본은 workspace, full은 채팅·웹·API에서 고를 수 없고 설정 파일로만 지정된다', () => {
  const c = cfg();
  assert.deepEqual(resolveProfile(c, undefined), { profile: 'workspace' });
  assert.deepEqual(resolveProfile(c, 'read_only'), { profile: 'read_only' });
  assert.deepEqual(resolveProfile(c, 'full'), { http: 403, code: 'profile_not_allowed' });
  assert.deepEqual(resolveProfile(c, 'nope'), { http: 400, code: 'unknown_profile' });
  assert.deepEqual(resolveProfile(cfg({ permissions: { allowFullFromChat: true } }), 'full'), { profile: 'full' });
});

test('새 세션을 만들면 목록에 새 세션으로 보이고 작업 폴더·대기 상태가 정해진다', (t) => {
  const { store } = tempStore(t, []);
  const r = store.createSession(owner, req('my-proj'), cfg());
  assert.equal(r.http, 201);
  assert.equal(r.conversationId, 'n_my-proj');
  assert.equal(r.profile, 'workspace');
  assert.equal(r.workspace, '/ws/my-proj');
  const list = store.conversations(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0].engine, 'codex_thread');
  assert.deepEqual(list[0].newSession, { name: 'my-proj', state: 'pending', profile: 'workspace' });
  // 메신저에서 만든 세션도 웹에서 보인다(같은 사용자).
  const r2 = store.createSession(messenger, req('chat-one', 'claude', { via: 'chat' }), cfg());
  assert.equal(r2.http, 201);
  assert.equal(store.conversations(owner).find((c) => c.conversationId === 'n_chat-one').engine, 'claude_cli');
});

test('기능이 꺼져 있거나 허용되지 않은 앱·잘못된 입력이면 만들지 않는다', (t) => {
  const { store } = tempStore(t, []);
  assert.deepEqual(store.createSession(owner, req('aa'), loadNewSessionsConfig({})), { http: 403, code: 'new_sessions_disabled' });
  assert.deepEqual(store.createSession(otherApp, req('aa'), cfg()), { http: 403, code: 'app_not_allowed' });
  assert.deepEqual(store.createSession(owner, req('a'), cfg()), { http: 400, code: 'bad_name' });
  assert.deepEqual(store.createSession(owner, req('aa', 'gpt'), cfg()), { http: 400, code: 'bad_engine' });
  assert.deepEqual(store.createSession(owner, req('aa', 'codex', { profile: 'full' }), cfg()), { http: 403, code: 'profile_not_allowed' });
  assert.equal(store.createSession(owner, req('aa'), cfg()).http, 201);
  assert.deepEqual(store.createSession(owner, req('aa', 'claude'), cfg()), { http: 409, code: 'name_taken' });
  assert.equal(store.conversations(owner).length, 1);
});

test('세션 수 한도: 총수·엔진별 한도를 넘으면 거절하고 보관된 세션은 세지 않는다', (t) => {
  const { store } = tempStore(t, []);
  const c = cfg({ limits: { maxSessions: 3, maxActive: 2, maxPerEngine: { codex: 3, claude: 1 } } });
  assert.equal(store.createSession(owner, req('c1', 'claude'), c).http, 201);
  assert.deepEqual(store.createSession(owner, req('c2', 'claude'), c), { http: 409, code: 'engine_limit', limit: 1 });
  assert.equal(store.createSession(owner, req('x1'), c).http, 201);
  assert.equal(store.createSession(owner, req('x2'), c).http, 201);
  assert.deepEqual(store.createSession(owner, req('x3'), c), { http: 409, code: 'session_limit', limit: 3 });
  assert.deepEqual(store.sessionLimits(c), { sessions: 3, maxSessions: 3, perEngine: { codex: 2, claude: 1 },
    maxPerEngine: { codex: 3, claude: 1 }, maxActive: 2 });
  store.setSessionState('n_x1', 'archived');
  assert.equal(store.createSession(owner, req('x3'), c).http, 201);
});

test('설정 파일의 sessionOverrides로만 full이 적용되고, 기존 세션 연결은 한도에 들어가지 않는다', (t) => {
  const { store } = tempStore(t);
  const c = cfg({ limits: { maxSessions: 1, maxActive: 1 }, sessionOverrides: { 'build-box': { profile: 'full' } } });
  assert.equal(store.createSession(owner, req('build-box'), c).http, 201);
  assert.equal(store.effectiveProfile('n_build-box', c), 'full');
  assert.equal(store.conversations(owner).length, 3);
  assert.equal(store.effectiveProfile('c_codex', c), null);
});

test('다른 사용자는 새 세션을 보거나 질문할 수 없다', (t) => {
  const { store } = tempStore(t, []);
  store.createSession(owner, req('mine'), cfg());
  assert.equal(store.conversations(stranger).length, 0);
  assert.equal(store.submit(stranger, 'n_mine', 'k1', { question: 'hi' }).http, 404);
});

test('Claude 새 세션은 채널(기존 세션)이 아니라 claude_cli 엔진으로 가서 기존 세션으로 새지 않는다', (t) => {
  const { store } = tempStore(t);
  store.createSession(owner, req('wait', 'claude'), cfg());
  assert.equal(store.submit(owner, 'n_wait', 'k1', { question: 'hi' }).http, 202);
  const job = store.claim('h_sinsan');
  assert.equal(job.engine, 'claude_cli');
  assert.match(job.sessionRef, /^pending:/);
  assert.equal(job.newSession.name, 'wait');
  // 기존 세션 연결은 그대로 채널로 간다.
  store.submit(owner, 'c_claude', 'k1', { question: 'hi' });
  assert.equal(store.claim('h_sinsan').engine, 'claude_channel');
});

test('재시작해도 새 세션 등록이 유지된다', (t) => {
  const h = tempStore(t, []);
  h.store.createSession(owner, req('keep'), cfg());
  const s = h.reopen();
  assert.deepEqual(s.conversations(owner)[0].newSession, { name: 'keep', state: 'pending', profile: 'workspace' });
});
