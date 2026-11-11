// U3: 대화 연결 — 이 PC의 최근 Codex 대화 목록(업무 대화 제외)과 한 번에 연결. 가짜 app-server로 시험(실제 대화 기록 0, 모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { listCodexThreads, safeThreads } from '../../src/pilot/codex-threads.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const WORK = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
const FAKE = fileURLToPath(new URL('./fake-codex-app-server.mjs', import.meta.url));
const APP = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-u3-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('목록 정리: 업무 대화(대소문자 무관)·형식이 틀린 ID·임시 대화를 빼고 제목·폴더·시각만', () => {
  const list = safeThreads([
    { id: WORK.toUpperCase(), name: '업무' }, { id: 'x', name: 'x' }, { id: '11111111-2222-3333-4444-555555555555', ephemeral: true },
    { id: '01A18790-63C7-73E3-A60B-6DDB60FD5BE8', preview: 'a\n  b', cwd: 'D:\\w', recencyAt: 1762800000 },
  ]);
  assert.deepEqual(list, [{ threadId: '01a18790-63c7-73e3-a60b-6ddb60fd5be8', title: 'a b', workingDirectory: 'D:/w', updatedAt: new Date(1762800000000).toISOString() }]);
});

test('Codex에 업무 대화를 빼 달라고 요청하고, 섞여 와도 다시 뺀다(공식 thread/list만 사용)', async (t) => {
  const d = tmp(t); const log = join(d, 'calls.jsonl');
  process.env.FAKE_CODEX_LOG = log; t.after(() => { delete process.env.FAKE_CODEX_LOG; });
  const list = await listCodexThreads({ codex: { command: process.execPath, args: [FAKE] }, timeoutMs: 10000 });
  assert.deepEqual(list.map((x) => x.threadId), ['01a1ca36-fa0f-7830-82bd-64e4d798fd2f', '01a18790-63c7-73e3-a60b-6ddb60fd5be8']);
  assert.ok(!JSON.stringify(list).toLowerCase().includes(WORK) && !JSON.stringify(list).includes('업무 대화'));
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.method).filter((m) => m !== 'initialized'), ['initialize', 'thread/list'], '목록 조회 외의 요청(재개·읽기)은 없다');
  const p = calls.find((c) => c.method === 'thread/list').params;
  assert.deepEqual(p.excludedThreadIds, [WORK]);
  assert.equal(p.archived, false);
  assert.equal(p.useStateDbOnly, true, '기록 파일을 다 훑지 않고 상태 DB에서(느려서 시간 초과 나던 문제)');
});

async function server(t, { threads, cfg = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u3s-'));
  const cfgPath = join(dir, 'connector.json');
  if (cfg) writeFileSync(cfgPath, JSON.stringify({ live: false }));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    bindings: [], connectorConfigPath: cfgPath, listCodexThreads: async () => threads ?? [] });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); }); // 서버를 닫은 뒤 지운다(열린 DB는 지울 수 없음)
  const call = (path, { method = 'GET', body, headers = {}, token = 'web' } = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { dir, cfgPath, call };
}

test('서버 목록: 이 PC에서 연 화면만, 업무 대화는 한 번 더 빼고, 이미 연결한 대화 표시', async (t) => {
  const threads = [{ threadId: '01a1ca36-fa0f-7830-82bd-64e4d798fd2f', title: 'A', workingDirectory: null, updatedAt: null }, { threadId: WORK, title: '업무', workingDirectory: null, updatedAt: null }];
  const s = await server(t, { threads });
  const r = await s.call('/v1/admin/local/threads');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.threads.map((x) => [x.threadId, x.connected]), [['01a1ca36-fa0f-7830-82bd-64e4d798fd2f', false]]);
  assert.equal((await s.call('/v1/admin/local/threads', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 403, '바깥(앞단 경유) 요청은 거절');
  assert.equal((await s.call('/v1/admin/local/threads', { token: 'msg' })).status, 403, '메신저 앱은 관리 API 불가');
});

test('한 번에 연결: 허용 목록 + 세션 등록, 다시 누르면 같은 대화, 업무 대화·틀린 ID 거절', async (t) => {
  const s = await server(t);
  const work = join(s.dir, 'closing'); mkdirSync(work);
  const T = '01a1ca36-fa0f-7830-82bd-64e4d798fd2f';
  const r = await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: T.toUpperCase(), label: '결산 자동화', workingDirectory: work } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, true);
  const cfg = JSON.parse(readFileSync(s.cfgPath, 'utf8'));
  assert.deepEqual(cfg.codex.allowlist, [T]);
  assert.equal(cfg.codex.modes[T], 'alternate');
  assert.equal(cfg.codex.workingDirectories[T], work.replaceAll('\\', '/'));
  const conv = (await s.call('/v1/conversations')).body.conversations.find((c) => c.conversationId === r.body.conversationId);
  assert.equal(conv.label, '결산 자동화'); assert.equal(conv.engine, 'codex_thread');
  assert.ok((await s.call('/v1/conversations', { token: 'msg' })).body.conversations.some((c) => c.conversationId === r.body.conversationId), '메신저에서도 보임');
  const again = await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: T, label: '다른 이름' } });
  assert.equal(again.body.created, false); assert.equal(again.body.conversationId, r.body.conversationId);
  assert.equal((await s.call('/v1/admin/local/threads')).status, 200);
  assert.equal((await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: WORK, label: 'x' } })).body.error, 'excluded_session');
  assert.equal((await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: '../etc', label: 'x' } })).body.error, 'bad_session_ref');
  assert.ok(!JSON.parse(readFileSync(s.cfgPath, 'utf8')).codex.allowlist.includes(WORK));
});

test('없는 작업 폴더면 폴더 없이 연결하고, 앞단 경유 요청은 거절', async (t) => {
  const s = await server(t);
  const T = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
  assert.equal((await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: T, label: 'B' }, headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 403);
  const r = await s.call('/v1/admin/connections', { method: 'POST', body: { threadId: T, label: 'B', workingDirectory: join(s.dir, 'gone') } });
  assert.equal(r.status, 200);
  const cfg = JSON.parse(readFileSync(s.cfgPath, 'utf8'));
  assert.ok(cfg.codex.allowlist.includes(T)); assert.equal(cfg.codex.workingDirectories?.[T], undefined);
});

test('화면: ＋ 대화 연결은 목록에서 고르는 창, 고급에서 ID 직접 넣기', () => {
  assert.ok(APP.includes('id="connect"') && APP.includes("'/v1/admin/local/threads'") && APP.includes("'/v1/admin/connections'"));
  assert.ok(APP.includes('고급: 대화 ID 직접 넣기'));
  assert.ok(!APP.includes('01a0dadd'), '화면 코드에 업무 대화 ID가 없다');
});