// 신산님 2026-11-16: "모든 로그인은 이어온 안에서" — 구독 로그인(기기 코드)과 API 키 로그인을 둘 다 이어온 화면에서.
// 기본 로그인(그 PC·칸이 원래 쓰는 로그인)에도 로그인·API 키, 허브 화면 → PC·칸 경로도 같은 결과, 키는 어디에도 남지 않음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { createDeviceAdmin, API_KEY } from '../../src/pilot/device-admin.mjs';
import { createCodexLogin } from '../../src/pilot/codex-login.mjs';
import { createHubLink } from '../../src/pilot/hub-link.mjs';

const KEY = 'sk-test' + 'A'.repeat(40);
const sha = (s) => createHash('sha256').update(s).digest('hex');

// 공식 로그인을 흉내 낸다: 기기 코드 시작·끝, API 키는 받은 값을 기억(성공 여부는 good으로)
function fakeLoginFactory(calls, { good = true } = {}) {
  return (env) => ({ env, state: 'idle', start() { this.state = 'waiting'; calls.push(['start', env.CODEX_HOME ?? null]); }, cancel() { this.state = 'cancelled'; },
    finish() { this.state = 'done'; }, view() { return { state: this.state, url: this.state === 'waiting' ? 'https://auth.openai.com/codex/device' : null, code: this.state === 'waiting' ? 'ABCD-EFGH1' : null }; },
    async logout() { calls.push(['logout', env.CODEX_HOME ?? null]); return true; },
    async apiKeyLogin(k) { calls.push(['apikey', env.CODEX_HOME ?? null, k === KEY]); if (good) { mkdirSync(env.CODEX_HOME, { recursive: true }); writeFileSync(join(env.CODEX_HOME, 'auth.json'), '{}'); } return good; } });
}

function setupPc(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-login-'));
  const prev = process.env.CODEX_HOME; const home = join(d, 'pc-codex'); process.env.CODEX_HOME = home;
  t.after(() => { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 파일 잠금이면 남겨 둠 */ } });
  mkdirSync(join(d, 's2'), { recursive: true });
  const cfg = join(d, 's2', 'connector.json');
  writeFileSync(cfg, JSON.stringify({ live: false, codex: { allowlist: [], modes: {}, workingDirectories: {} } }));
  return { d, cfg, home };
}

test('API 키 로그인: 키는 표준 입력으로만 넘기고 명령줄에는 없다, 성공·실패를 그대로 돌려준다', async () => {
  const seen = [];
  const spawnImpl = (_bin, args, opts) => {
    const c = new EventEmitter(); let input = '';
    c.stdin = { end: (s) => { input += s; seen.push({ args, input, stdio: opts.stdio }); setImmediate(() => c.emit('exit', input.trim() === KEY ? 0 : 1)); } };
    c.kill = () => {};
    return c;
  };
  const l = createCodexLogin({ spawnImpl, entry: () => 'codex.js', env: { CODEX_HOME: '/x' } });
  assert.equal(await l.apiKeyLogin(KEY), true);
  assert.deepEqual(seen[0].args, ['codex.js', 'login', '--with-api-key']);
  assert.ok(!seen[0].args.join(' ').includes(KEY), '명령줄에 키 없음');
  assert.deepEqual(seen[0].stdio, ['pipe', 'ignore', 'ignore'], '출력도 받지 않음(키가 섞일 수 있는 곳을 남기지 않음)');
  assert.equal(await l.apiKeyLogin('sk-wrong'), false);
});

test('기본 로그인에도 로그인·API 키 — 그 PC·칸이 원래 쓰는 로그인 폴더 그대로, 방식(구독/API)을 기록, 지울 수는 없음', async (t) => {
  const s = setupPc(t); const calls = [];
  const admin = createDeviceAdmin({ connectorConfigPath: s.cfg, accountLogin: fakeLoginFactory(calls) });
  let r = await admin.run('accounts.get');
  assert.deepEqual([r.body.defaultLogin.loggedIn, r.body.defaultLogin.login.state, r.body.defaultLogin.kind], [false, 'idle', null], '칸을 막 만들면 "로그인 필요"');
  r = await admin.run('accounts.login', { id: 'pc_default' });
  assert.deepEqual(calls.at(-1), ['start', s.home], '기본 로그인은 원래 CODEX_HOME으로');
  assert.equal(r.body.defaultLogin.login.state, 'waiting');
  assert.equal(r.body.defaultLogin.login.code, 'ABCD-EFGH1', '화면이 승인 창·코드를 보여 줄 수 있게');
  await admin.run('accounts.login.cancel', { id: 'pc_default' });
  // API 키
  assert.deepEqual((await admin.run('accounts.apikey', { id: 'pc_default', key: 'not-a-key' })).body, { error: 'bad_api_key' });
  r = await admin.run('accounts.apikey', { id: 'pc_default', key: KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1), ['apikey', s.home, true]);
  assert.deepEqual([r.body.defaultLogin.loggedIn, r.body.defaultLogin.kind], [true, 'api']);
  assert.ok(!JSON.stringify(r.body).includes(KEY), '응답에 키 없음');
  assert.ok(!readFileSync(join(s.d, 's2', 'connector.json'), 'utf8').includes(KEY), '이어온 설정에도 키 없음');
  r = await admin.run('accounts.logout', { id: 'pc_default' });
  assert.equal(r.body.defaultLogin.kind, null, '로그아웃하면 방식 기록도 지움');
  assert.equal((await admin.run('accounts.delete', { id: 'pc_default' })).status, 404, '기본 로그인은 지우는 대상이 아님');
});

test('이어온 전용 계정도 API 키로 — 그 계정 폴더에, 실패하면 502, 기기 코드 로그인이 끝나면 구독으로 기록', async (t) => {
  const s = setupPc(t); const calls = [];
  const factory = fakeLoginFactory(calls, { good: false });
  const made = [];
  const admin = createDeviceAdmin({ connectorConfigPath: s.cfg, accountLogin: (env) => { const l = factory(env); made.push(l); return l; } });
  const { id } = (await admin.run('accounts.add', { label: '회사' })).body;
  const r = await admin.run('accounts.apikey', { id, key: KEY });
  assert.deepEqual([r.status, r.body.error], [502, 'api_key_login_failed']);
  assert.ok(calls.at(-1)[1] && calls.at(-1)[1] !== s.home, '그 계정의 폴더(기본 로그인과 다름)');
  await admin.run('accounts.login', { id });
  made.at(-1).finish();
  const g = await admin.run('accounts.get');
  assert.equal(g.body.accounts[0].kind, 'subscription');
  assert.equal(API_KEY.test(KEY) && !API_KEY.test('sk-short'), true);
});

test('허브 화면 → PC·엔진 칸: 기본 로그인 API 키가 같은 결과로, 허브·PC 기록에 키가 없다', async (t) => {
  const s = setupPc(t); const calls = [];
  const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];
  const HUB_ACCESS = { webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } };
  mkdirSync(join(s.d, 'hub'));
  writeFileSync(join(s.d, 'hub', 'connector.json'), JSON.stringify({ live: false, codex: { allowlist: [] } }));
  const logs = []; const realErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { logs.push(String(chunk)); return realErr(chunk, ...rest); };
  t.after(() => { process.stderr.write = realErr; });
  const hub = createApp({ dbPath: join(s.d, 'hub', 'pilot.db'), users, devices: [{ tokenSha256: sha('dev'), hostId: 'h_cell' }], bindings: [], accountLogin: fakeLoginFactory(calls), ...HUB_ACCESS });
  const hubUrl = `http://127.0.0.1:${await hub.listen(0)}`;
  t.after(() => hub.close());
  const admin = createDeviceAdmin({ connectorConfigPath: s.cfg, accountLogin: fakeLoginFactory(calls), log: (e) => logs.push(JSON.stringify(e)) });
  const linkDir = join(s.d, 'link'); mkdirSync(linkDir);
  writeFileSync(join(linkDir, 'hub.json'), JSON.stringify({ hubUrl, hostId: 'h_cell' })); writeFileSync(join(linkDir, 'device-token'), 'dev');
  const link = createHubLink({ dir: linkDir, connectorConfigPath: s.cfg, spawnImpl: () => Object.assign(new EventEmitter(), { kill() {} }), adminPollMs: 3_600_000 });
  t.after(() => link.close());
  link.setAdmin((op, args) => admin.run(op, args)); link.resume();
  await fetch(`${hubUrl}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } });
  const viaHub = async (op, args) => {
    const p = fetch(`${hubUrl}/v1/admin/hosts/h_cell/run`, { method: 'POST', body: JSON.stringify({ op, args }), headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' } }).then(async (r) => ({ status: r.status, body: await r.json() }));
    await new Promise((r) => setTimeout(r, 50)); await link.adminOnce(); return p;
  };
  let r = await viaHub('accounts.get');
  assert.equal(r.body.defaultLogin.loggedIn, false);
  r = await viaHub('accounts.apikey', { id: 'pc_default', key: KEY });
  assert.deepEqual([r.status, r.body.defaultLogin.loggedIn, r.body.defaultLogin.kind], [200, true, 'api']);
  r = await viaHub('accounts.login', { id: 'pc_default' });
  assert.equal(r.status, 200, '허브 화면에서 기본 로그인 기기 코드 로그인도 시작');
  assert.ok(!logs.join('\n').includes(KEY), '허브·칸 기록 어디에도 키 없음');
  assert.ok(existsSync(join(s.home, 'auth.json')), '키는 그 칸의 Codex 로그인 폴더에(Codex가 저장)');
});

test('설정 화면: 기본 로그인 줄·API 키 칸(가려진 입력, 넣은 뒤 지움)·승인 창 열기(코드 자동 복사)', () => {
  const SET = readFileSync(fileURLToPath(new URL('../../src/pilot/web/settings.html', import.meta.url)), 'utf8');
  for (const s of ["id: 'pc_default'", 'id="acKeyForm"', 'type="password"', "acRun('accounts.apikey'", "$('acKey').value = ''", '승인 창 열기', 'navigator.clipboard.writeText(waiting.login.code)', "if (!a.builtin) act('지우기'"]) assert.ok(SET.includes(s), s);
});

test('같이 쓰는 로그인: 기본 로그인이 연결(허브·칸 공유)이면 로그아웃은 원본을 지우고 연결은 남긴다 — 다시 로그인하면 모든 칸이 같이 씀', async (t) => {
  const s = setupPc(t); const calls = [];
  const { symlinkSync, lstatSync } = await import('node:fs');
  mkdirSync(join(s.d, 'shared'), { recursive: true }); mkdirSync(s.home, { recursive: true });
  const target = join(s.d, 'shared', 'auth.json'); writeFileSync(target, '{}');
  try { symlinkSync(target, join(s.home, 'auth.json')); } catch (e) { if (e.code === 'EPERM') return t.skip('이 PC(Windows)는 심볼릭 링크 권한 없음 — 리눅스 서버에서 실측'); throw e; }
  const logout = (env) => ({ ...fakeLoginFactory(calls)(env), async logout() { rmSync(join(env.CODEX_HOME, 'auth.json'), { force: true }); return true; } }); // Codex 로그아웃은 연결만 지움
  const admin = createDeviceAdmin({ connectorConfigPath: s.cfg, accountLogin: logout });
  assert.equal((await admin.run('accounts.get')).body.defaultLogin.loggedIn, true);
  const r = await admin.run('accounts.logout', { id: 'pc_default' });
  assert.equal(existsSync(target), false, '같이 쓰는 원본도 지움(모든 칸이 함께 로그아웃)');
  assert.ok(lstatSync(join(s.home, 'auth.json')).isSymbolicLink(), '연결은 되살림 — 다시 로그인하면 원본에 쓰여 모든 칸이 같이 씀');
  assert.equal(r.body.defaultLogin.loggedIn, false);
});

test('설치 때 환경 파일의 API 키로 허브 로그인: 아직 로그인 전일 때만, 키는 표준 입력으로만·화면에 안 나옴, 그 뒤 칸들이 같이 씀', () => {
  const sh = readFileSync(fileURLToPath(new URL('../../deploy/hub/ieun.sh', import.meta.url)), 'utf8');
  const fn = sh.slice(sh.indexOf('api_key_login() {'), sh.indexOf('share_login() {'));
  assert.ok(fn.includes("sed -n 's/^OPENAI_API_KEY=//p'"), '환경 파일의 OPENAI_API_KEY');
  assert.ok(fn.includes('[ -e hub/data/shared-auth/codex/auth.json ] && return 0') && fn.includes('[ -e hub/data/codex/auth.json ] && return 0'), '이미 로그인돼 있으면 바꾸지 않음');
  assert.ok(fn.includes('printf \'%s\\n\' "$key" | docker exec -i "$HUB_C"') && fn.includes('login --with-api-key >/dev/null 2>&1'), '키는 표준 입력으로, 출력은 버림');
  assert.ok(!/echo[^\n]*\$key/.test(fn), '키를 화면에 내지 않음');
  assert.ok(sh.includes('share_login() {\n  api_key_login\n'), '칸을 만들 때·share-login 때 먼저 키 로그인 → 그 로그인을 칸들이 같이 씀');
});
