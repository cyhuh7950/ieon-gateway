// 여러 봇 M0: 봇·역할 정의 API와 봇 인증(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-bots-'));
  const app = createApp({
    dbPath: join(dir, 'pilot.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' },
      { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }],
    bindings: [
      { conversationId: 'c_shared', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' },
      { conversationId: 'c_review', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_bot_telegram_ieun01'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't2' },
    ],
  });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'web', method = 'GET', body, bot } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(bot ? { 'x-ieon-bot': bot } : {}) },
    body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  return { app, call };
}
const role = { name: '코드 리뷰', description: 'PR 검토', engines: ['codex'], profiles: ['read_only'], aiGuide: '너는 리뷰 담당이다.' };

test('처음 켜면 메신저마다 default 봇이 있고, 봇 관리는 웹 사용자만 할 수 있다', async (t) => {
  const { call } = await setup(t);
  const r = await call('/v1/admin/bots');
  assert.deepEqual(r.body.bots.map((b) => [b.platform, b.botId, b.name, b.appId]), [
    ['discord', 'default', '기본 봇', 'app_messenger'], ['line', 'default', '기본 봇', 'app_messenger'], ['slack', 'default', '기본 봇', 'app_messenger'], ['telegram', 'default', '기본 봇', 'app_messenger']]); // L1: 라인 기본 봇
  assert.deepEqual((await call('/v1/admin/bots', { token: 'msg' })).body, { error: 'admin_only' });
  assert.equal((await call('/v1/admin/bots/telegram/default', { method: 'DELETE' })).body.error, 'default_bot');
});

test('역할·봇 저장: 규칙 검사, full 권한 거부, 부르는 이름 중복 거부, 사용 중 역할 삭제 거부', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('/v1/admin/roles/review', { method: 'PUT', body: { ...role, profiles: ['full'] } })).body.error, 'bad_profiles');
  assert.equal((await call('/v1/admin/roles/review', { method: 'PUT', body: { ...role, engines: ['gpt'] } })).body.error, 'bad_engines');
  assert.equal((await call('/v1/admin/roles/review', { method: 'PUT', body: { ...role, defaultSession: 'nope' } })).body.error, 'unknown_session');
  assert.equal((await call('/v1/admin/roles/review', { method: 'PUT', body: { ...role, defaultSession: 'c_review' } })).status, 200);
  assert.equal((await call('/v1/admin/bots/telegram/Bad_ID', { method: 'PUT', body: { name: 'x' } })).body.error, 'bad_bot_id');
  assert.equal((await call('/v1/admin/bots/wechat/ieun01', { method: 'PUT', body: { name: 'x' } })).body.error, 'bad_platform');
  assert.equal((await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇', roleId: 'nope' } })).body.error, 'unknown_role');
  const ok = await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇', roleId: 'review', callNames: ['리뷰', '리뷰봇'] } });
  assert.deepEqual(ok.body, { platform: 'telegram', botId: 'ieun01', name: '리뷰 봇', roleId: 'review', callNames: ['리뷰', '리뷰봇'], extraUsers: [], enabled: true, lang: null, sessions: [] }); // I18N-b: lang null = 서버 기본 언어
  assert.deepEqual((await call('/v1/admin/bots/telegram/other', { method: 'PUT', body: { name: 'x', callNames: ['리 뷰'] } })).body,
    { error: 'call_name_taken', callName: '리뷰', botId: 'ieun01' });
  // 다른 메신저에서는 같은 부르는 이름을 써도 된다.
  assert.equal((await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇', callNames: ['리뷰'] } })).status, 200);
  assert.equal((await call('/v1/admin/bots/telegram/x2', { method: 'PUT', body: { name: 'x', callNames: ['help'] } })).body.error, 'bad_call_name');
  assert.equal((await call('/v1/admin/roles/review', { method: 'DELETE' })).body.error, 'role_in_use');
});

test('봇 인증: 정의된 봇만 그 봇의 앱 ID로 처리하고 세션 범위가 나뉜다', async (t) => {
  const { call } = await setup(t);
  const ids = (r) => r.body.conversations.map((c) => c.conversationId);
  // 헤더가 없거나 default 봇이면 지금처럼 app_messenger
  assert.deepEqual(ids(await call('/v1/conversations', { token: 'msg' })), ['c_shared']);
  assert.deepEqual(ids(await call('/v1/conversations', { token: 'msg', bot: 'telegram:default' })), ['c_shared']);
  // 정의 안 된 봇·웹 토큰으로 봇 행세는 거절
  assert.deepEqual((await call('/v1/conversations', { token: 'msg', bot: 'telegram:ieun01' })).body, { error: 'unknown_bot' });
  assert.deepEqual((await call('/v1/conversations', { token: 'web', bot: 'telegram:default' })).body, { error: 'unknown_bot' });
  await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇' } });
  assert.deepEqual(ids(await call('/v1/conversations', { token: 'msg', bot: 'telegram:ieun01' })), ['c_review']);
  // 같은 ID라도 다른 메신저 봇은 다른 앱이다.
  await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇' } });
  assert.deepEqual(ids(await call('/v1/conversations', { token: 'msg', bot: 'discord:ieun01' })), []);
  // 끄면 거절
  await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇', enabled: false } });
  assert.deepEqual((await call('/v1/conversations', { token: 'msg', bot: 'telegram:ieun01' })).body, { error: 'unknown_bot' });
  // 봇은 봇 관리 API를 쓸 수 없다.
  await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇' } });
  assert.deepEqual((await call('/v1/admin/bots', { token: 'msg', bot: 'telegram:ieun01' })).body, { error: 'admin_only' });
});

test('메신저 프로세스: 켜진 봇 정의(역할 포함)를 받고, 상태를 보고하면 웹에 보인다(토큰 값은 없음)', async (t) => {
  const { call } = await setup(t);
  await call('/v1/admin/roles/review', { method: 'PUT', body: role });
  await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇', roleId: 'review', callNames: ['리뷰'] } });
  await call('/v1/admin/bots/slack/off', { method: 'PUT', body: { name: '끈 봇', enabled: false } });
  const defs = (await call('/v1/messenger/bots', { token: 'msg' })).body.bots;
  assert.deepEqual(defs.map((b) => `${b.platform}:${b.botId}`), ['discord:default', 'line:default', 'slack:default', 'telegram:default', 'telegram:ieun01']);
  assert.equal(defs.find((b) => b.botId === 'ieun01').role.aiGuide, '너는 리뷰 담당이다.');
  assert.deepEqual((await call('/v1/messenger/bots', { token: 'web' })).body, { error: 'messenger_only' });
  assert.equal((await call('/v1/messenger/bots/status', { token: 'msg', method: 'POST', body: { bots: [
    { platform: 'telegram', botId: 'ieun01', state: 'token_missing', missing: ['TELEGRAM_BOT_IEUN01_TOKEN'], token: 'SHOULD_NOT_STORE' },
    { platform: 'telegram', botId: 'ghost', state: 'ready' }] } })).status, 204);
  const st = (await call('/v1/admin/bots')).body.bots.find((b) => b.botId === 'ieun01').status;
  assert.equal(st.state, 'token_missing');
  assert.deepEqual(st.missing, ['TELEGRAM_BOT_IEUN01_TOKEN']);
  assert.equal(JSON.stringify(st).includes('SHOULD_NOT_STORE'), false);
});

test('봇이 볼 수 있는 기존 세션을 웹에서 고르면 그 봇에 보이고, 서버를 다시 켜도 유지된다', async (t) => {
  const { call, app } = await setup(t);
  await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇' } });
  const ids = async () => (await call('/v1/conversations', { token: 'msg', bot: 'discord:ieun01' })).body.conversations.map((c) => c.conversationId);
  assert.deepEqual(await ids(), []);
  assert.equal((await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇', sessions: ['nope'] } })).body.error, 'unknown_session');
  const r = await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇', sessions: ['c_shared'] } });
  assert.deepEqual(r.body.sessions, ['c_shared']);
  assert.deepEqual(await ids(), ['c_shared']);
  // 이름만 바꾸면(sessions 없음) 고른 세션은 그대로
  await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '리뷰 봇2' } });
  assert.deepEqual(await ids(), ['c_shared']);
  // server.json bindings를 다시 넣어도(재시작과 같음) 웹 설정은 유지
  app.store.addBinding({ conversationId: 'c_shared', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' });
  assert.deepEqual(await ids(), ['c_shared']);
  const admin = (await call('/v1/admin/bots')).body.bots.find((b) => b.platform === 'discord' && b.botId === 'ieun01');
  assert.deepEqual(admin.envNames, { token: 'DISCORD_BOT_IEUN01_TOKEN' });
  assert.deepEqual((await call('/v1/admin/sessions')).body.sessions.map((s) => s.conversationId), ['c_shared', 'c_review']);
  await call('/v1/admin/bots/discord/ieun01', { method: 'DELETE' });
  assert.deepEqual((await call('/v1/conversations', { token: 'msg' })).body.conversations.map((c) => c.conversationId), ['c_shared']);
});

test('M3: 봇에서 /new로 만든 세션은 만든 봇+웹에서만 보이고, 역할의 엔진·권한 제한과 AI 역할 안내가 적용된다', async (t) => {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'ieon-m3-'));
  const nsPath = join(dir, 'ns.json');
  writeFileSync(nsPath, JSON.stringify({ enabled: true, workspaceRoot: join(dir, 'ws') }));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), newSessionsConfigPath: nsPath,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }], bindings: [] });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'web', method = 'GET', body, bot } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(bot ? { 'x-ieon-bot': bot } : {}) },
    body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  await call('/v1/admin/roles/review', { method: 'PUT', body: { name: '코드 리뷰', engines: ['codex'], profiles: ['read_only'], aiGuide: '너는 리뷰 담당이다.' } });
  await call('/v1/admin/bots/telegram/ieun01', { method: 'PUT', body: { name: '리뷰 봇', roleId: 'review' } });
  const asBot = { token: 'msg', bot: 'telegram:ieun01' };
  // 역할 제한
  assert.deepEqual((await call('/v1/sessions', { ...asBot, method: 'POST', body: { engine: 'claude', name: 'r-claude' } })).body,
    { error: 'engine_not_allowed_for_role', allowed: ['codex'] });
  assert.deepEqual((await call('/v1/sessions', { ...asBot, method: 'POST', body: { engine: 'codex', name: 'r-ws', profile: 'workspace' } })).body,
    { error: 'profile_not_allowed_for_role', allowed: ['read_only'] });
  const ok = await call('/v1/sessions', { ...asBot, method: 'POST', body: { engine: 'codex', name: 'r-ok' } });
  assert.deepEqual(ok.body, { conversationId: 'n_r-ok', name: 'r-ok', engine: 'codex', profile: 'read_only' });
  // 소속: 만든 봇 + 웹만
  const seen = async (opts) => (await call('/v1/conversations', opts)).body.conversations.map((c) => c.conversationId);
  assert.deepEqual(await seen(asBot), ['n_r-ok']);
  assert.deepEqual(await seen({}), ['n_r-ok']);
  assert.deepEqual(await seen({ token: 'msg' }), []);
  await call('/v1/admin/bots/discord/ieun01', { method: 'PUT', body: { name: '다른 봇' } });
  assert.deepEqual(await seen({ token: 'msg', bot: 'discord:ieun01' }), []);
  // 기본 봇·웹에서 만든 세션은 지금처럼 웹+메신저
  await call('/v1/sessions', { token: 'msg', method: 'POST', body: { engine: 'claude', name: 'd-new' } });
  assert.deepEqual(await seen({ token: 'msg' }), ['n_d-new']);
  // AI 역할 안내: 첫 질문(엔진 세션 만들 때)에만 붙고, 저장된 질문은 그대로
  await fetch(`http://127.0.0.1:${port}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } }); // 연결부 온라인 표시
  const q1 = await fetch(`http://127.0.0.1:${port}/v1/conversations/n_r-ok/requests`, { method: 'POST',
    headers: { authorization: 'Bearer msg', 'x-ieon-bot': 'telegram:ieun01', 'content-type': 'application/json', 'idempotency-key': 'k-m3-0001' },
    body: JSON.stringify({ question: '이 PR 봐 줘' }) }).then((r) => r.json());
  const job = app.store.claim('h_sinsan');
  assert.equal(job.question, '[역할 안내]\n너는 리뷰 담당이다.\n\n[질문]\n이 PR 봐 줘');
  app.store.report('h_sinsan', q1.requestId, { status: 'completed', answer: 'a', sessionRef: '0f0f0f0f-1111-4222-8333-444444444444' });
  assert.equal(app.store.messages({ userId: 'u_sinsan', appId: 'app_web' }, 'n_r-ok')[0].question, '이 PR 봐 줘');
  app.store.submit({ userId: 'u_sinsan', appId: 'app_web' }, 'n_r-ok', 'k-m3-0002', { question: '두 번째' });
  assert.equal(app.store.claim('h_sinsan').question, '두 번째');
});