// A1(ENGINE_ACCOUNTS EA10·EA4): 어떤 계정인지 모르는 채로 "토큰 없음"으로 멈추지 않는다.
// - 계정 사용 한도로 답을 만들기 전에 끝나면 실행 안 됨(usage_limit, 실패) — 결과 불명으로 잠그지 않음
// - 질문이 어느 계정(접속)으로 나가는지 목록·메신저·한도 안내에 보임
// - 메신저 창: 저장 직후 "토큰 없음"을 실패로 보지 않고, 토큰 거절 같은 이유를 보여 줌. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { codexThreadAdapter, isUsageLimit } from '../../src/pilot/adapters/codex-thread.mjs';
import { EngineError } from '../../src/pilot/contracts.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';
import { createApp } from '../../src/pilot/server.mjs';

const TID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const LIMIT = 'You’ve hit your usage limit. Upgrade to Pro, or try again at 7:04 PM.';
const sdkWith = (events) => ({ loadSdk: async () => ({ Codex: class {
  resumeThread(id) { return { id, async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: id }; yield* events; })() }; } }; }
} }) });
const adapter = (sdk) => codexThreadAdapter({ live: true, allowlist: [TID], probe: () => 'NO_LOCK_FILE', loadSdk: sdk.loadSdk });
const run = (a) => a.run({ engine: 'codex_thread', sessionRef: TID, question: '한 줄로 자기소개 해줘', connectMode: 'alternate' });

test('Codex: 사용 한도로 답을 만들기 전에 끝나면 usage_limit(실행 안 됨), 일을 시작했거나 다른 실패면 그대로', async () => {
  await assert.rejects(run(adapter(sdkWith([{ type: 'turn.failed', error: { message: LIMIT } }]))), (e) => e instanceof EngineError && e.code === 'usage_limit' && e.http === 429);
  // 이미 답(또는 일)을 만든 뒤의 실패는 실행됐을 수 있으므로 한도로 보지 않는다(결과 불명 쪽)
  await assert.rejects(run(adapter(sdkWith([{ type: 'item.completed', item: { type: 'agent_message', text: '반쯤' } }, { type: 'turn.failed', error: { message: LIMIT } }]))),
    (e) => !(e instanceof EngineError));
  await assert.rejects(run(adapter(sdkWith([{ type: 'turn.failed', error: { message: 'stream disconnected' } }]))), (e) => !(e instanceof EngineError));
  assert.equal(isUsageLimit('usage_limit_exceeded'), true);
  assert.equal(isUsageLimit('network error'), false);
});

test('서버: 대화 목록에 그 대화의 질문이 나가는 계정(접속)이 보인다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-a1-'));
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const app = createApp({ dbPath: join(dir, 'p.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('d'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c_codex', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: TID },
      { conversationId: 'c_claude', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'ieon' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const list = (await fetch(`${base}/v1/conversations`, { headers: { authorization: 'Bearer web' } }).then((r) => r.json())).conversations;
  const by = Object.fromEntries(list.map((c) => [c.conversationId, c.account]));
  assert.deepEqual(by.c_codex, { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Codex Desktop과 같은 계정' });
  assert.deepEqual(by.c_claude, { mode: 'pc_default', label: '그 PC의 Claude Code 창에 로그인된 계정' });
});

test('메신저: 한도는 어느 계정인지와 바꿀 길을 알리고, 결과 불명처럼 /review를 요구하지 않는다. /status에 계정', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-a1m-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const account = { mode: 'pc_default', label: 'PC 기본 로그인 — 그 PC의 Codex Desktop과 같은 계정' };
  const conv = { conversationId: 'c1', label: '시험 표식 확인', engine: 'codex_thread', connectMode: 'alternate', deviceOnline: true, busy: false, account };
  const api = async (req) => {
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [conv] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 202, body: { requestId: 'req_1' } };
    if (req.method === 'GET' && req.path === '/v1/requests/req_1') return { status: 200, body: { status: 'failed', errorCode: 'usage_limit' } };
    return { status: 404, body: {} };
  };
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 1000 });
  const said = []; const say = (text) => bridge.handle({ platform: 'telegram', userId: '111', chatId: '-1', text }, async (s) => { said.push(s); });
  await say('/use 1'); await say('질문');
  assert.match(said.at(-1), /사용 한도에 걸려 실행되지 않았음 — 지금 쓰는 계정: PC 기본 로그인 — 그 PC의 Codex Desktop과 같은 계정/);
  assert.ok(!/review/.test(said.at(-1)), '잠그지 않으므로 정리 명령이 필요 없음');
  await say('/status');
  assert.match(said.at(-1), /계정: PC 기본 로그인/);
});

test('메신저 실행기: 연결 실패는 이유 코드와 함께 바로 보고한다(토큰 거절이 "토큰 없음"으로 보이지 않게)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-a1r-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reports = [];
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [{ platform: 'line', botId: 'default', name: '기본', callNames: [], extraUsers: [], enabled: true }] } };
    if (req.path === '/v1/messenger/bots/status') { reports.push(...req.body.bots); return { status: 204, body: null }; }
    return { status: 200, body: {} };
  };
  const runner = createBotRunner({ api, apiFor: () => api, env: { LINE_CHANNEL_ACCESS_TOKEN: 'x', LINE_CHANNEL_SECRET: 'y' }, roomsPath: join(dir, 'r.json'),
    runners: { line: (o) => { o.log({ event: 'open_error', error: 'bad_access_token' }); } } });
  await runner.sync(); t.after(() => runner.stopAll());
  assert.ok(reports.some((b) => b.platform === 'line' && b.state === 'error' && b.detail === 'bad_access_token'), JSON.stringify(reports));
});

test('화면: 계정 표시·한도 카드(다시 보내기는 누를 때만)·메신저 창 기다림과 실패 이유', () => {
  const APP = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
  assert.ok(APP.includes('id="acctChip"') && APP.includes('id="pAccount"'), '대화 위쪽·연결 설정에 사용 계정');
  assert.ok(APP.includes("usage_limit: ['warn', '계정의 사용 한도에 걸려 실행되지 않았어요.']"));
  assert.ok(APP.includes("' 지금 쓰는 계정: ' + (acct ?? '알 수 없음')"), '한도 카드에 계정 이름');
  assert.ok(APP.includes("if (s === 'token_missing' && Date.now() - savedAt < 75_000)"), '저장 직후 토큰 없음은 기다림');
  assert.ok(APP.includes("bad_access_token: '토큰이 맞지 않아요"), '토큰 거절 이유');
});