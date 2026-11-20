// RC3(REQUEST_CONTROL 4절): 작업(질문 단위) 목록·상세·승인 대기함, 메신저의 "작업 보기" 링크. 내가 볼 수 있는 대화만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function setup(t, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-rc3-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [
      { conversationId: 'c1', label: '하나', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000021' },
      { conversationId: 'c2', label: '둘', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000022' },
      { conversationId: 'cx', label: '남의 것', ownerUserId: 'u_other', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000023' },
    ], ...extra });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web', key, headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...headers } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  let k = 0;
  const ask = (conv, question = '일해 줘', token = 'web') => call(`/v1/conversations/${conv}/requests`, { method: 'POST', body: { question }, token, key: `k-rc3-${conv}-${++k}-xxxx` });
  await call('/v1/device/jobs', { token: 'dev' }); // 온라인
  return { call, ask };
}

test('작업 목록: 내가 볼 수 있는 대화의 질문만, 새것부터, 진행 중만 골라 보기, AI 직원 이름·미리보기·접수 시각', async (t) => {
  const s = await setup(t);
  await s.call('/v1/conversations/c1/staff', { method: 'PUT', body: { name: '법률봇' } });
  const a = (await s.ask('c1', '첫 질문입니다')).body.requestId;
  const b = (await s.ask('c2', '두 번째\n질문')).body.requestId;
  await s.ask('cx', '남의 질문', 'other');
  // a는 끝냄(연결부가 가져가 완료 보고)
  const job = (await s.call('/v1/device/jobs', { token: 'dev' })).body;
  assert.equal(job.requestId, a);
  await s.call(`/v1/device/jobs/${a}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: '답이에요' } });
  const all = (await s.call('/v1/tasks')).body.tasks;
  assert.deepEqual(all.map((x) => x.requestId), [b, a], '남의 대화 질문은 없고, 새것부터');
  assert.deepEqual([all[1].label, all[1].status, all[1].preview, all[1].canStop], ['법률봇', 'completed', '첫 질문입니다', false]);
  assert.deepEqual([all[0].label, all[0].preview, all[0].canStop], ['둘', '두 번째 질문', true], '대기 중이면 멈출 수 있음, 줄바꿈은 한 칸');
  assert.match(all[0].createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual((await s.call('/v1/tasks?filter=active')).body.tasks.map((x) => x.requestId), [b], '진행 중·확인 필요만');
  assert.equal(all.some((x) => 'question' in x || 'answer' in x), false, '목록에는 질문 원문·답을 싣지 않는다(미리보기만)');
  assert.deepEqual((await s.call('/v1/tasks', { token: 'other' })).body.tasks.map((x) => x.label), ['남의 것']);
});

test('작업 하나: 질문·답(완료일 때만)·그 질문의 승인과 실행 결과, 남의 것·없는 것은 404', async (t) => {
  const s = await setup(t);
  const a = (await s.ask('c1', '파일 만들어 줘')).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' });
  const { approvalId } = (await s.call('/v1/device/approvals', { token: 'dev', method: 'POST', body: { requestId: a, kind: 'file', summary: '파일 수정', cwd: 'C:/w', itemId: 'i1' } })).body;
  let d = (await s.call('/v1/tasks/' + a)).body;
  assert.deepEqual([d.question, d.answer, d.pendingApprovals, d.approvals[0].state, d.approvals[0].n], ['파일 만들어 줘', null, 1, 'pending', 1]);
  await s.call('/v1/approvals/' + approvalId, { method: 'POST', body: { decision: 'allow' } });
  await s.call('/v1/device/approvals/' + approvalId, { token: 'dev' });
  await s.call(`/v1/device/approvals/${approvalId}/result`, { token: 'dev', method: 'POST', body: { outcome: 'failed', exitCode: 2, itemId: 'i1' } });
  await s.call(`/v1/device/jobs/${a}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: '실패했어요' } });
  d = (await s.call('/v1/tasks/' + a)).body;
  assert.deepEqual([d.status, d.answer, d.approvals[0].state, d.approvals[0].exitCode], ['completed', '실패했어요', 'failed', 2]);
  assert.equal((await s.call('/v1/tasks/' + a, { token: 'other' })).status, 404, '남의 작업은 없는 것과 같다');
  assert.equal((await s.call('/v1/tasks/req_nope')).status, 404);
});

test('승인 대기함: 여러 대화의 기다리는 승인을 한곳에, 시간이 지난 것·남의 것은 빠짐', async (t) => {
  const s = await setup(t, { approvalTtlMs: 300 });
  const a = (await s.ask('c1')).body.requestId;
  await s.call('/v1/device/jobs', { token: 'dev' });
  const p1 = (await s.call('/v1/device/approvals', { token: 'dev', method: 'POST', body: { requestId: a, kind: 'command', summary: 'npm test', cwd: 'C:/w' } })).body;
  let list = (await s.call('/v1/approvals')).body.approvals;
  assert.deepEqual(list.map((x) => [x.approvalId, x.label, x.n, x.kind, x.requestId]), [[p1.approvalId, '하나', 1, 'command', a]]);
  assert.deepEqual((await s.call('/v1/approvals', { token: 'other' })).body.approvals, []);
  await new Promise((r) => setTimeout(r, 400));
  list = (await s.call('/v1/approvals')).body.approvals;
  assert.deepEqual(list, [], '15분(시험은 0.3초)이 지나면 대기함에서 빠지고 거부로 바뀐다');
});

test('작업 보기 링크: 웹이 공개 https 주소로 열렸을 때만 기억해 접수 응답에 싣는다(로컬·http·메신저 요청은 기억하지 않음)', async (t) => {
  const s = await setup(t);
  const first = (await s.ask('c1')).body;
  assert.equal(first.taskUrl, undefined, '아직 모름');
  await s.call('/v1/requests/' + first.requestId + '/stop', { method: 'POST' }); // 같은 대화에 다시 묻기 위해 취소
  await s.call('/v1/conversations', { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'hub.example.kr' } });
  await s.call('/v1/conversations', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': '127.0.0.1:28760' } });
  await s.call('/v1/conversations', { token: 'msg', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' } });
  assert.equal((await s.ask('c2')).body.taskUrl, undefined, 'http·로컬·메신저 요청으로는 바뀌지 않음');
  await s.call('/v1/conversations', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hub.example.kr' } });
  const r = await s.ask('c1', '다음', 'msg');
  assert.equal(r.body.taskUrl, `https://hub.example.kr/#task=${r.body.requestId}`);
});

test('메신저: 접수 안내에 작업 보기 링크(서버가 줄 때만)', async () => {
  const said = [];
  const api = async (req) => {
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [{ conversationId: 'c1', label: '하나', engine: 'codex_thread', deviceOnline: true, busy: false }] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_9', taskUrl: 'https://hub.example.kr/#task=req_9' } };
    if (req.method === 'GET' && req.path === '/v1/requests/req_9') return { status: 200, body: { status: 'completed', answer: '답' } };
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'] }, roomsPath: join(mkdtempSync(join(tmpdir(), 'ieon-rc3b-')), 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const send = async (x) => { said.push(x); };
  await bridge.handle({ platform: 'telegram', userId: '111', chatId: '-1', text: '/use 1', msgId: 'tg--1-1' }, send);
  await bridge.handle({ platform: 'telegram', userId: '111', chatId: '-1', text: '질문', msgId: 'tg--1-2' }, send);
  assert.ok(said.some((x) => /접수됨[\s\S]*작업 보기: https:\/\/hub\.example\.kr\/#task=req_9/.test(x)), said.join(' | '));
});

test('웹 화면: 작업 서랍·#task 링크·허용/거부·중지·대화로(PC형·허브형 같은 화면)', () => {
  const html = koView('app.html');
  for (const s of ['id="tasksBtn"', 'id="tasks"', "api('/v1/approvals')", "api('/v1/tasks?filter=active')", "'/v1/tasks/' + tk.requestId", "'/stop'", '#task=', "select(tk.conversationId)"]) assert.ok(html.includes(s), s);
});
