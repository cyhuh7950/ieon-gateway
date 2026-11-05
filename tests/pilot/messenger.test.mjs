// 메신저 공통 처리 검사(모델 0). 이어온 서버 API는 대역으로 바꾼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge, splitText } from '../../src/pilot/messenger/bridge.mjs';

function fakeApi(state) {
  const calls = [];
  const api = async (req) => {
    calls.push(req);
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: state.conversations } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return state.submit ?? { status: 202, body: { requestId: 'req_1' } };
    if (req.method === 'GET' && req.path === '/v1/requests/req_1') return { status: 200, body: state.result };
    if (req.method === 'POST' && req.path.endsWith('/review')) return { status: 200, body: { status: 'completed' } };
    return { status: 404, body: { error: 'not_found' } };
  };
  return { api, calls };
}

function setup(t, state) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { api, calls } = fakeApi(state);
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const said = [];
  const say = (text, user = '111', chat = '-100') => bridge.handle({ platform: 'telegram', userId: user, chatId: chat, text }, async (s) => { said.push(s); });
  return { bridge, calls, said, say, dir };
}

const conv = (over = {}) => ({ conversationId: 'c1', label: '시험 표식 확인', engine: 'codex_thread', connectMode: 'alternate', deviceOnline: true, busy: false, ...over });

test('허용되지 않은 발신자는 /whoami 외에 아무 응답도·서버 호출도 없다', async (t) => {
  const s = setup(t, { conversations: [conv()] });
  await s.say('안녕', '999');
  await s.say('/sessions', '999');
  assert.deepEqual(s.said, []);
  assert.equal(s.calls.length, 0);
  await s.say('/whoami', '999');
  assert.match(s.said[0], /사용자 ID: 999/);
  assert.match(s.said[0], /허용 목록에 없음/);
});

test('/sessions → /use → 질문 → 답, 대화방 연결은 파일에 남는다', async (t) => {
  const s = setup(t, { conversations: [conv()], result: { status: 'completed', answer: '포도' } });
  await s.say('질문');
  assert.match(s.said.at(-1), /연결된 세션이 없음/);
  await s.say('/sessions');
  assert.match(s.said.at(-1), /1\. 시험 표식 확인 — Codex\(번갈아 쓰기\) · 보낼 수 있음/);
  await s.say('/use 1');
  await s.say('마지막 표식?');
  assert.deepEqual(s.said.slice(-2), ['[시험 표식 확인] 접수됨 — 답을 기다리는 중', '포도']);
  const submit = s.calls.find((c) => c.method === 'POST' && c.path === '/v1/conversations/c1/requests');
  assert.equal(submit.body.question, '마지막 표식?');
  assert.match(submit.headers['idempotency-key'], /^msg-/);
  const again = createBridge({ api: fakeApi({ conversations: [conv()] }).api, allowedUsers: { telegram: ['111'] }, roomsPath: join(s.dir, 'rooms.json') });
  const said2 = [];
  await again.handle({ platform: 'telegram', userId: '111', chatId: '-100', text: '/status' }, async (x) => { said2.push(x); });
  assert.match(said2[0], /시험 표식 확인/);
});

test('거절·결과 불명은 안내만 하고 다시 보내지 않으며 /review로 정리한다', async (t) => {
  const s = setup(t, { conversations: [conv()], submit: { status: 409, body: { error: 'conversation_busy' } } });
  await s.say('/use 1');
  await s.say('질문');
  assert.match(s.said.at(-1), /처리 중인 질문이 있어 보낼 수 없음/);
  assert.equal(s.calls.filter((c) => c.path.endsWith('/requests')).length, 1);

  const u = setup(t, { conversations: [conv({ heldBy: { requestId: 'req_9', status: 'unknown' } })], result: { status: 'unknown', errorCode: 'turn_joined_by_other_input' } });
  await u.say('/use 1');
  await u.say('질문');
  assert.match(u.said.at(-1), /다시 보내지 않습니다/);
  await u.say('/review done');
  assert.ok(u.calls.some((c) => c.path === '/v1/requests/req_9/review' && c.body.executed === true));
});

test('긴 답은 메신저 한도에 맞게 나눈다', () => {
  const parts = splitText('가'.repeat(5000), 1900);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= 1900));
  assert.equal(parts.join(''), '가'.repeat(5000));
});

// 새 세션 명령(N4): 실제 서버 대신 상태를 가진 대역 API.
function nsApi() {
  const convs = [];
  const calls = [];
  let notices = [];
  const api = async (req) => {
    calls.push(req);
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: convs } };
    if (req.method === 'POST' && req.path === '/v1/sessions') {
      if (req.body.profile === 'full') return { status: 403, body: { error: 'profile_not_allowed' } };
      const c = { conversationId: `n_${req.body.name}`, label: req.body.name, engine: req.body.engine === 'codex' ? 'codex_thread' : 'claude_cli',
        deviceOnline: true, busy: false, newSession: { name: req.body.name, state: 'pending', profile: req.body.profile ?? 'workspace' } };
      convs.push(c);
      return { status: 201, body: { conversationId: c.conversationId, name: req.body.name, engine: req.body.engine, profile: c.newSession.profile } };
    }
    const a = req.path.match(/^\/v1\/sessions\/(n_[\w-]+)\/(sleep|restore)$/);
    if (a) { const c = convs.find((x) => x.conversationId === a[1]); c.newSession.state = 'sleeping'; return { status: 200, body: { state: 'sleeping' } }; }
    if (req.method === 'DELETE') {
      if (req.body.confirm !== req.path.split('n_')[1]) return { status: 400, body: { error: 'confirm_mismatch' } };
      convs.splice(convs.findIndex((x) => x.conversationId === req.path.split('/').at(-1)), 1);
      return { status: 200, body: { deleted: true, workspaceRemoved: false } };
    }
    if (req.path.startsWith('/v1/sessions/notices')) { const out = notices; notices = []; return { status: 200, body: { notices: out } }; }
    if (req.path === '/v1/sessions/limits') return { status: 200, body: { sessions: convs.length, maxSessions: 10, perEngine: { codex: 1, claude: 0 }, maxPerEngine: { codex: 10, claude: 3 }, maxActive: 3 } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_1' } };
    if (req.path === '/v1/requests/req_1') return { status: 200, body: { status: 'completed', answer: '새 답' } };
    return { status: 404, body: { error: 'not_found' } };
  };
  return { api, calls, convs, pushNotice: (n) => notices.push(n) };
}

test('/new로 새 세션을 만들면 이 대화방에 바로 연결되고 질문이 그 세션으로 간다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = nsApi();
  const bridge = createBridge({ api: f.api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const said = [];
  const say = (text) => bridge.handle({ platform: 'telegram', userId: '111', chatId: '-100', text }, async (s) => { said.push(s); });
  await say('/new codex my-proj');
  assert.match(said.at(-1), /새 Codex 세션 "my-proj"\(권한 workspace\)을 만들고 이 대화방에 연결/);
  await say('안녕');
  assert.ok(f.calls.some((c) => c.method === 'POST' && c.path === '/v1/conversations/n_my-proj/requests'));
  assert.equal(said.at(-1), '새 답');
  await say('/new claude boxy full');
  assert.match(said.at(-1), /full 권한은 메신저에서 고를 수 없음/);
  await say('/new gpt x');
  assert.match(said.at(-1), /사용법/);
  await say('/sessions');
  assert.match(said.at(-1), /my-proj — Codex\(번갈아 쓰기\) · 보낼 수 있음 · 새 세션 첫 질문 전/);
});

test('/sleep·/archived·/restore·/close(확인 단계)·/limits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = nsApi();
  const bridge = createBridge({ api: f.api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const said = [];
  const say = (text) => bridge.handle({ platform: 'telegram', userId: '111', chatId: '-100', text }, async (s) => { said.push(s); });
  await say('/new codex keep');
  await say('/sleep keep');
  assert.match(said.at(-1), /"keep" 잠재움/);
  f.convs[0].newSession.state = 'archived';
  await say('/sessions');
  assert.doesNotMatch(said.at(-1), /keep/);
  await say('/archived');
  assert.match(said.at(-1), /- keep/);
  await say('/restore keep');
  assert.match(said.at(-1), /보관에서 꺼냄/);
  await say('/close keep');
  assert.match(said.at(-1), /계속하려면: \/close keep 확인/);
  assert.equal(f.convs.length, 1);
  await say('/close keep 확인');
  assert.match(said.at(-1), /"keep" 삭제함/);
  assert.equal(f.convs.length, 0);
  await say('/limits');
  assert.match(said.at(-1), /새 세션 0\/10/);
  await say('/sleep nobody');
  assert.match(said.at(-1), /새 세션이 없음/);
});

test('보관 예고는 그 세션에 연결된 대화방으로만 보낸다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = nsApi();
  const bridge = createBridge({ api: f.api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const room = { a: [], b: [] };
  await bridge.handle({ platform: 'telegram', userId: '111', chatId: 'A', text: '/new codex aa' }, async (s) => { room.a.push(s); });
  await bridge.handle({ platform: 'telegram', userId: '111', chatId: 'B', text: '/help' }, async (s) => { room.b.push(s); });
  f.pushNotice({ conversationId: 'n_aa', name: 'aa', archiveAt: '2026-11-19T00:00:00.000Z', at: '2099-01-01T00:00:00.000Z' });
  assert.equal(await bridge.deliverNotices(), 1);
  assert.match(room.a.at(-1), /\[aa\] 2026-11-19에 보관될 예정/);
  assert.equal(room.b.length, 1);
});
