// A2(ENGINE_ACCOUNTS EA0·EA1·EA9·EA10): 이어온 전용 Codex 계정 — 계정 폴더(세션·잠금은 Desktop 폴더 연결), 질문마다 그 계정 환경,
// 로그인 전·없는 계정은 모델 전에 거절, 설정 → 계정 API(이 PC 화면만), 허브까지 계정 이름표 표시. 모델 0, 실제 로그인 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { codexEnvFor, createCodexHome, removeCodexHome, codexHomeOf, LINKED } from '../../src/pilot/accounts.mjs';
import { codexThreadAdapter } from '../../src/pilot/adapters/codex-thread.mjs';
import { EngineError } from '../../src/pilot/contracts.mjs';
import { codexAccountHealth, healthHeader, pollOnce } from '../../src/pilot/connector.mjs';
import { createApp } from '../../src/pilot/server.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음
// I18N-b: 이름표에 붙는 키(labelKey·labelVars)는 빼고 비교 — 키는 i18n-viewer 시험이 확인
const noKey = (a) => a && Object.fromEntries(Object.entries(a).filter(([k]) => k !== "labelKey" && k !== "labelVars"));
const KO = loadDict('ko');

const T1 = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const T2 = '01a18790-0000-7000-8000-000000000002';
const sha = (s) => createHash('sha256').update(s).digest('hex');
// 정리 순서: 서버를 먼저 닫고(열린 DB 때문에 지우기가 막히지 않게) 임시 폴더를 지운다.
const closers = new WeakMap();
const tmp = (t, p) => { const d = mkdtempSync(join(tmpdir(), p)); const list = []; closers.set(t, list);
  t.after(async () => { for (const f of list.reverse()) await f(); rmSync(d, { recursive: true, force: true }); }); return d; };
const onClose = (t, f) => closers.get(t).push(f);
// 시험 동안 Desktop 폴더를 임시 폴더로 바꾼다(실제 %USERPROFILE%\.codex를 건드리지 않게).
const fakeDesktop = (t, d) => { const prev = process.env.CODEX_HOME; const desk = join(d, 'desk'); mkdirSync(join(desk, 'sessions'), { recursive: true });
  writeFileSync(join(desk, 'sessions', 'rollout-keep.jsonl'), 'x'); process.env.CODEX_HOME = desk;
  t.after(() => { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; }); return desk; };

test('계정 폴더: 세션·잠금은 Desktop 폴더 연결, 지울 때 연결만 끊고 Desktop 기록은 남는다', (t) => {
  const d = tmp(t, 'ieon-a2f-'); const desk = fakeDesktop(t, d);
  const home = createCodexHome(join(d, 'acc'), 'a1');
  for (const n of LINKED) assert.ok(lstatSync(join(home, n)).isSymbolicLink(), n);
  assert.ok(existsSync(join(home, 'sessions', 'rollout-keep.jsonl')), '연결 너머 Desktop 기록이 보임');
  assert.match(readFileSync(join(home, 'config.toml'), 'utf8'), /cli_auth_credentials_store = "file"/);
  assert.throws(() => createCodexHome(join(d, 'acc'), 'a1'), /account_exists/);
  assert.throws(() => codexHomeOf(join(d, 'acc'), '../x'), /bad_account/);
  // Codex가 로그인 때 tmp 아래에 만드는 바로 가기처럼 깊은 곳의 연결도 따라가지 않고 지운다(허브에서 발견)
  mkdirSync(join(home, 'tmp', 'arg0-linux'), { recursive: true });
  symlinkSync(join(desk, 'sessions'), join(home, 'tmp', 'arg0-linux', 'codex'), 'junction');
  assert.equal(removeCodexHome(join(d, 'acc'), 'a1'), true);
  assert.ok(!existsSync(home));
  assert.ok(existsSync(join(desk, 'sessions', 'rollout-keep.jsonl')), 'Desktop 기록은 그대로');
});

test('계정 고르기: 대화별 → 기본 → PC 기본, 없는 계정·로그인 전은 거절, 환경은 질문에만(process.env 그대로)', (t) => {
  const d = tmp(t, 'ieon-a2e-'); const desk = fakeDesktop(t, d); const dir = join(d, 'acc');
  createCodexHome(dir, 'a1');
  const c = { codex: { allowlist: [T1, T2], accounts: [{ id: 'a1', label: '회사' }], accountFor: { [T1]: 'a1' } } };
  assert.equal(codexEnvFor(c, dir, T2), null, '고르지 않았고 기본도 없으면 PC 기본');
  assert.throws(() => codexEnvFor(c, dir, T1), (e) => e.message === 'account_not_logged_in' && e.http === 409);
  writeFileSync(join(codexHomeOf(dir, 'a1'), 'auth.json'), '{}'); // 시험용 빈 파일(로그인됐다고 치기)
  const env = codexEnvFor(c, dir, T1);
  assert.equal(env.CODEX_HOME, codexHomeOf(dir, 'a1'));
  assert.equal(env.CODEX_SQLITE_HOME, desk, '상태 DB는 Desktop 것');
  assert.equal(process.env.CODEX_HOME, desk, '프로세스 환경은 바꾸지 않음');
  assert.equal(codexEnvFor({ ...c, codex: { ...c.codex, defaultAccount: 'a1' } }, dir, T2).CODEX_HOME, codexHomeOf(dir, 'a1'), '기본 계정');
  assert.equal(codexEnvFor({ ...c, codex: { ...c.codex, defaultAccount: 'a1' } }, dir, null).CODEX_HOME, codexHomeOf(dir, 'a1'), '새 세션은 기본 계정');
  assert.throws(() => codexEnvFor({ codex: { accountFor: { [T1]: 'gone' } } }, dir, T1), /account_missing/);
});

test('어댑터: 고른 계정 환경을 SDK에만 넘기고, 거절이면 SDK를 부르지 않는다. 공유 서버 방식은 계정을 쓰지 않는다', async () => {
  const seen = [];
  const sdk = async () => ({ Codex: class { constructor(o) { seen.push(o); } resumeThread(id) { return { id, async runStreamed() { return { events: (async function* () {
    yield { type: 'thread.started', thread_id: id }; yield { type: 'item.completed', item: { type: 'agent_message', text: '안녕' } }; yield { type: 'turn.completed' }; })() }; } }; } } });
  const base = { live: true, allowlist: [T1], probe: () => 'NO_LOCK_FILE' };
  const r = await codexThreadAdapter({ ...base, loadSdk: sdk, accountEnv: (id) => ({ CODEX_HOME: 'H:' + id }) }).run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate' });
  assert.equal(r.answer, '안녕');
  assert.deepEqual(seen.at(-1), { env: { CODEX_HOME: 'H:' + T1 } });
  await codexThreadAdapter({ ...base, loadSdk: sdk, accountEnv: () => null }).run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate' });
  assert.equal(seen.at(-1), undefined, 'PC 기본이면 지금처럼 new Codex()');
  let loaded = false;
  await assert.rejects(codexThreadAdapter({ ...base, loadSdk: async () => { loaded = true; return sdk(); }, accountEnv: () => { throw Object.assign(new Error('account_not_logged_in'), { http: 409 }); } })
    .run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'alternate' }), (e) => e instanceof EngineError && e.code === 'account_not_logged_in');
  assert.equal(loaded, false, '모델(SDK) 전에 거절');
  let asked = false;
  await assert.rejects(codexThreadAdapter({ ...base, loadSdk: sdk, accountEnv: () => { asked = true; return null; } })
    .run({ engine: 'codex_thread', sessionRef: T1, question: 'q', connectMode: 'shared_server' }), /shared_server_not_configured/);
  assert.equal(asked, false);
});

test('연결부 상태: 대화별 이어온 계정 이름표만 알리고(PC 기본·공유 서버는 빼고), 서버 목록에 그 계정이 보인다', async (t) => {
  const cfg = { codex: { allowlist: [T1, T2], modes: { [T2]: 'shared_server' }, accounts: [{ id: 'a1', label: '회사' }], defaultAccount: 'a1' } };
  assert.deepEqual(codexAccountHealth(cfg), { codexAccounts: { [T1]: '회사' }, codexDefault: '회사', codexAccountIds: { [T1]: 'a1' }, codexDefaultId: 'a1' }); // SV3-b: 계정 ID도(공유 서버 대화는 빼고)
  assert.deepEqual(codexAccountHealth({ codex: { allowlist: [T1] } }), { codexAccounts: {}, codexDefault: null, codexAccountIds: { [T1]: 'pc_default' }, codexDefaultId: 'pc_default' });
  const d = tmp(t, 'ieon-a2h-');
  const app = createApp({ dbPath: join(d, 'p.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c2', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T2 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  onClose(t, () => app.close());
  const list = async () => Object.fromEntries((await fetch(base + '/v1/conversations', { headers: { authorization: 'Bearer web' } }).then((r) => r.json())).conversations.map((c) => [c.conversationId, noKey(c.account)]));
  assert.equal((await list()).c1.mode, 'pc_default', '알리기 전에는 PC 기본');
  // 실제 연결부 조회(pollOnce)로 보낸다 — 한글 이름표가 HTTP 헤더에서 깨지거나 조회 자체가 실패하지 않아야 한다.
  assert.equal(await pollOnce({ baseUrl: base, deviceToken: 'dev', adapters: {}, receipts: null,
    health: async () => ({ codexShared: 'down', claudeChannel: 'down', codexAccounts: { [T1]: '회사<b>', bad: 'x' }, codexDefault: '회사' }) }), false);
  assert.match(healthHeader({ a: '회사' }), /^[\x20-\x7e]+$/, '헤더 값은 ASCII만');
  const by = await list();
  assert.deepEqual(by.c1, { mode: 'ieon_login', label: '이어온 계정 회사b' }, '이름표는 꺾쇠를 빼고');
  assert.equal(by.c2.mode, 'pc_default');
});

test('설정 → 계정 API: 추가·로그인(계정 폴더로)·고르기·지우기, 이 PC 화면만, 허브의 PC용 주소는 없음', async (t) => {
  const d = tmp(t, 'ieon-a2s-'); const desk = fakeDesktop(t, d);
  const cfg = join(d, 's2', 'connector.json'); mkdirSync(join(d, 's2'));
  writeFileSync(cfg, JSON.stringify({ live: false, codex: { allowlist: [T1], modes: {}, workingDirectories: {} } }));
  const logins = [];
  const accountLogin = (env) => { const l = { env, state: 'idle', logouts: 0, start() { this.state = 'waiting'; }, cancel() { if (this.state === 'waiting') this.state = 'cancelled'; },
    view() { return { state: this.state, url: this.state === 'waiting' ? 'https://auth.openai.com/codex/device' : null, code: this.state === 'waiting' ? 'ABCD-12345' : null }; },
    async logout() { this.logouts += 1; rmSync(join(env.CODEX_HOME, 'auth.json'), { force: true }); return true; } }; logins.push(l); return l; };
  const app = createApp({ dbPath: join(d, 'p.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [], connectorConfigPath: cfg, accountLogin });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  onClose(t, () => app.close());
  const call = (path, { method = 'GET', body, xff } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.deepEqual((await call('/v1/admin/local/accounts')).body.accounts, []);
  // 규칙 점검 4: 로그인한 웹 화면이면 앞단(Tailscale 등)을 거쳐도 바꿀 수 있음
  assert.equal((await call('/v1/admin/local/accounts', { method: 'POST', body: { label: ' ' }, xff: '100.100.1.2' })).body.error, 'bad_label');
  let r = await call('/v1/admin/local/accounts', { method: 'POST', body: { label: '회사' } });
  assert.equal(r.status, 201);
  const id = r.body.id; const home = join(d, 'accounts', 'codex', id);
  assert.ok(lstatSync(join(home, 'sessions')).isSymbolicLink(), '계정 폴더는 .local/accounts/codex/<id>, 세션은 Desktop 연결');
  assert.deepEqual(r.body.accounts.map((a) => [a.label, a.loggedIn]), [['회사', false]]);

  r = await call(`/v1/admin/local/accounts/${id}/login`, { method: 'POST', body: {} });
  assert.equal(logins[0].env.CODEX_HOME, home, '공식 로그인은 계정 폴더로');
  assert.equal(logins[0].env.CODEX_SQLITE_HOME, desk);
  assert.equal(r.body.accounts[0].login.code, 'ABCD-12345');
  writeFileSync(join(home, 'auth.json'), '{}'); // 신산님이 승인했다고 치기
  assert.equal((await call('/v1/admin/local/accounts')).body.accounts[0].loggedIn, true);

  assert.equal((await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { accountId: 'nope' } })).body.error, 'bad_account');
  assert.equal((await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { threadId: T2, accountId: id } })).body.error, 'thread_not_allowed');
  assert.equal((await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { threadId: '01a0dadd-739f-74d2-93c5-9c405cc1019b', accountId: id } })).body.error, 'bad_thread_id');
  r = await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { accountId: id } });
  assert.equal(r.body.defaultAccount, id);
  r = await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { threadId: T1, accountId: 'pc_default' } });
  assert.deepEqual(r.body.accountFor, { [T1]: 'pc_default' });
  r = await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { threadId: T1, accountId: 'inherit' } });
  assert.deepEqual(r.body.accountFor, {});
  await call('/v1/admin/local/accounts/use', { method: 'PUT', body: { threadId: T1, accountId: id } });

  r = await call(`/v1/admin/local/accounts/${id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(logins[0].logouts, 1, '지우기 전에 공식 로그아웃');
  assert.ok(!existsSync(home));
  assert.ok(existsSync(join(desk, 'sessions', 'rollout-keep.jsonl')), 'Desktop 기록은 그대로');
  const raw = JSON.parse(readFileSync(cfg, 'utf8')).codex;
  assert.deepEqual([raw.accounts, raw.defaultAccount, raw.accountFor], [[], undefined, {}], '지운 계정을 가리키던 선택은 PC 기본으로');
  assert.equal((await call(`/v1/admin/local/accounts/${id}/login`, { method: 'POST', body: {} })).status, 404);
  assert.ok(!JSON.stringify(r.body).includes('auth'), '응답에 로그인 파일 이름·내용 없음');

  const hub = createApp({ dbPath: join(d, 'h.db'), users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [], connectorConfigPath: cfg,
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const hb = `http://127.0.0.1:${await hub.listen(0)}`;
  onClose(t, () => hub.close());
  assert.equal((await fetch(hb + '/v1/admin/local/accounts', { headers: { authorization: 'Bearer web', 'x-forwarded-for': '198.51.100.9' } })).status, 404);
});

test('화면: 계정 오류 안내(탭 자체는 a2d-hub-parity 시험)', () => {
  const A = koView('app.html');
  assert.ok(KO['errors.account_not_logged_in'] && KO['errors.account_missing']);
  assert.ok(!/ERR_HARD = new Set\([^)]*'account_(not_logged_in|missing)'/.test(A), '경고(warn)');
  assert.ok(!A.includes('준비 중 — 설정 → 계정') && !A.includes('(설정 → 계정, 준비 중)'));
});
