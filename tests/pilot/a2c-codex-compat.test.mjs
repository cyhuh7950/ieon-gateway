// A2-c Codex 호환 주소(신산님 2026-11-19 "2번 진행하자", 설계 EA8): Codex는 그대로, 모델만 다른 곳(OpenAI Responses API 호환).
// 계정 폴더 config.toml에 공식 model_provider(wire_api=responses, env_key), 키는 compat-key(600)에서 실행할 때만 환경 변수로.
// 사람이 만든 기존 Codex 대화는 확인된 조합이 없어 새 세션에서만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPAT_ENV_KEY, codexEnvFor, codexHomeOf, readCodexCompat, removeCodexCompat, saveCodexCompat } from '../../src/pilot/accounts.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-a2cx-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const KEY = 'rk_' + 'z'.repeat(30);
const T1 = '01a18790-0000-7000-8000-0000000000d1';

test('저장: config.toml에 공식 모델 제공처(responses), 키는 config에 없고 따로, 지우면 원래 설정', (t) => {
  const d = tmp(t); const home = join(d, 'h'); mkdirSync(home);
  assert.throws(() => saveCodexCompat(home, { baseUrl: 'http://example.com/v1', key: KEY, model: 'm' }), /bad_base_url/);
  assert.throws(() => saveCodexCompat(home, { baseUrl: 'https://r.example.com/v1', key: 'x', model: 'm' }), /bad_api_key/);
  assert.throws(() => saveCodexCompat(home, { baseUrl: 'https://r.example.com/v1', key: KEY, model: 'a"b' }), /bad_model/);
  saveCodexCompat(home, { baseUrl: 'https://r.example.com/v1/', key: KEY, model: 'gpt-oss-120b' });
  const toml = readFileSync(join(home, 'config.toml'), 'utf8');
  for (const s of ['cli_auth_credentials_store = "file"', 'model = "gpt-oss-120b"', 'model_provider = "ieon_compat"', '[model_providers.ieon_compat]', 'base_url = "https://r.example.com/v1"', `env_key = "${COMPAT_ENV_KEY}"`, 'wire_api = "responses"'])
    assert.ok(toml.includes(s), s);
  assert.ok(!toml.includes(KEY), '키는 config.toml에 없음');
  assert.deepEqual(readCodexCompat(home), { baseUrl: 'https://r.example.com/v1', model: 'gpt-oss-120b' });
  assert.equal(removeCodexCompat(home), true);
  assert.ok(!readFileSync(join(home, 'config.toml'), 'utf8').includes('model_provider'));
  assert.equal(readCodexCompat(home), null);
});

test('실행 환경: 새 세션은 그 계정 폴더 + 키 변수(OpenAI 키 변수는 지움), 기존 대화는 기본을 따르면 PC 기본(2026-11-24), 직접 고르면 combo_unverified', (t) => {
  const d = tmp(t); const dir = join(d, 'acc'); const home = codexHomeOf(dir, 'a1'); mkdirSync(home, { recursive: true });
  saveCodexCompat(home, { baseUrl: 'http://localhost:11434/v1', key: KEY, model: 'qwen3' });
  const c = { codex: { accounts: [{ id: 'a1', label: '로컬' }], defaultAccount: 'a1', allowlist: [T1] } };
  const env = codexEnvFor(c, dir, null, { env: { PATH: 'p', OPENAI_API_KEY: 'leak', CODEX_API_KEY: 'leak' } });
  assert.equal(env.CODEX_HOME, home); assert.equal(env[COMPAT_ENV_KEY], KEY);
  assert.ok(!('OPENAI_API_KEY' in env) && !('CODEX_API_KEY' in env));
  assert.equal(codexEnvFor(c, dir, T1, { env: {} }), null); // 2026-11-24: 기본 계정이 호환 주소여도 기존 대화는 PC 기본 로그인
  assert.throws(() => codexEnvFor({ codex: { ...c.codex, accountFor: { [T1]: 'a1' } } }, dir, T1, { env: {} }), /combo_unverified/);
});

test('기기 명령: 호환 주소 저장·보기(호스트·모델만, 키 없음, 로그인됨·호환 주소)·지우기, 화면이 명령을 씀', async (t) => {
  const d = tmp(t); const prev = process.env.CODEX_HOME; process.env.CODEX_HOME = join(d, 'desktop-codex'); t.after(() => { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; });
  mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, JSON.stringify({}));
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, accountLogin: () => ({ start() {}, cancel() {}, view: () => ({ state: 'idle' }), logout: async () => {} }) });
  const id = (await pc.run('accounts.add', { label: '라우터' })).body.id;
  assert.equal((await pc.run('accounts.compat', { id, baseUrl: 'ftp://x', key: KEY, model: 'm' })).body.error, 'bad_base_url');
  const r = await pc.run('accounts.compat', { id, baseUrl: 'https://router.example.com/v1', key: KEY, model: 'gpt-oss-120b' });
  assert.equal(r.status, 200);
  const a = r.body.accounts.find((x) => x.id === id);
  assert.deepEqual([a.loggedIn, a.kind, a.compat], [true, 'compat', { host: 'router.example.com', model: 'gpt-oss-120b' }]);
  assert.ok(!JSON.stringify(r.body).includes(KEY), '응답에 키 없음');
  const out = await pc.run('accounts.logout', { id });
  assert.equal(out.body.accounts.find((x) => x.id === id).kind, null);
  assert.ok(!existsSync(join(d, 'accounts', 'codex', id, 'compat-key')));
  const SET = koView('settings.html');
  assert.ok(SET.includes('id="acCompatForm"') && SET.includes("acRun('accounts.compat'") && SET.includes('Responses API'));
});
