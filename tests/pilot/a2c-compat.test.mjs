// A2-c(신산님 2026-11-19 "1번 진행하자", 설계 EA8): Claude Code 호환 주소 — Claude Code는 그대로, 모델만 다른 곳(Upstage Solar·라우터·로컬 모델).
// 주소·키·모델은 그 계정 폴더에(키는 화면·응답에 다시 내지 않음), 실행 때 Claude Code 공식 변수로만. 세션 경계는 CLI — 기존 대화 이어 쓰기는 확인된 조합(Upstage)만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAccountKind, claudeEnvFor, claudeHomeOf, saveClaudeApiKey, saveCompat } from '../../src/pilot/claude-accounts.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음
const KO = loadDict('ko');

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-a2c-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const KEY = 'up_' + 'k'.repeat(30);

test('호환 주소 저장·종류·실행 환경: 공식 변수로만, 키 보내는 방식 고르기, 다른 방식과 섞이지 않음', (t) => {
  const d = tmp(t); const dir = join(d, 'acc'); const home = claudeHomeOf(dir, 'c1'); mkdirSync(home, { recursive: true });
  assert.throws(() => saveCompat(home, { baseUrl: 'http://example.com', key: KEY, model: 'm' }), /bad_base_url/, '밖으로는 https만');
  assert.throws(() => saveCompat(home, { baseUrl: 'https://api.upstage.ai/v1', key: 'x', model: 'm' }), /bad_api_key/);
  assert.throws(() => saveCompat(home, { baseUrl: 'https://api.upstage.ai/v1', key: KEY, model: 'bad model' }), /bad_model/);
  saveCompat(home, { baseUrl: 'http://localhost:4000/', key: KEY, model: 'qwen3:8b' }); // 내 PC의 로컬 모델은 http 허용
  assert.equal(claudeAccountKind(home), 'compat');
  const c = { claudeAccounts: { accounts: [{ id: 'c1', label: '로컬' }], defaultAccount: 'c1' } };
  const env = claudeEnvFor(c, dir, { env: { PATH: 'p', ANTHROPIC_API_KEY: 'leak', CLAUDE_CODE_OAUTH_TOKEN: 'leak' } });
  assert.deepEqual({ ...env, PATH: undefined }, { PATH: undefined, ANTHROPIC_BASE_URL: 'http://localhost:4000', ANTHROPIC_AUTH_TOKEN: KEY, ANTHROPIC_MODEL: 'qwen3:8b', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3:8b', ANTHROPIC_SMALL_FAST_MODEL: 'qwen3:8b' });
  saveCompat(home, { baseUrl: 'https://api.upstage.ai/v1/claude', key: KEY, model: 'solar-pro4', auth: 'x-api-key' });
  const e2 = claudeEnvFor(c, dir, { env: {} });
  assert.equal(e2.ANTHROPIC_API_KEY, KEY); assert.ok(!('ANTHROPIC_AUTH_TOKEN' in e2));
  saveClaudeApiKey(home, 'sk-ant-api03-' + 'x'.repeat(40));
  assert.equal(claudeAccountKind(home), 'api', 'API 키를 넣으면 호환 주소는 지움');
  assert.ok(!existsSync(join(home, 'compat-key')));
  saveCompat(home, { baseUrl: 'https://api.upstage.ai/v1/claude', key: KEY, model: 'solar-pro4' });
  assert.ok(!existsSync(join(home, 'api-key')), '호환 주소를 넣으면 API 키는 지움');
});

test('세션 경계(EA8): 사람이 만든 기존 대화는 확인된 조합(Upstage)만, 이어온 새 세션은 어느 호환 주소든', (t) => {
  const d = tmp(t); const dir = join(d, 'acc');
  const c = { claudeAccounts: { accounts: [{ id: 'up', label: 'Solar' }, { id: 'rt', label: '라우터' }], defaultAccount: 'rt' } };
  saveCompat(claudeHomeOf(dir, 'up'), { baseUrl: 'https://api.upstage.ai/v1/claude', key: KEY, model: 'solar-pro4' });
  saveCompat(claudeHomeOf(dir, 'rt'), { baseUrl: 'https://router.example.com/anthropic', key: KEY, model: 'some-model' });
  assert.throws(() => claudeEnvFor(c, dir, { env: {}, existing: true }), /combo_unverified/);
  assert.ok(claudeEnvFor(c, dir, { env: {}, existing: false }).ANTHROPIC_BASE_URL.startsWith('https://router'));
  assert.ok(claudeEnvFor({ claudeAccounts: { ...c.claudeAccounts, defaultAccount: 'up' } }, dir, { env: {}, existing: true }).ANTHROPIC_BASE_URL.includes('upstage'));
});

test('기기 명령: 호환 주소 저장, 화면에는 호스트·모델·확인 여부만(키 없음), 지우기', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); mkdirSync(join(d, 'desk'));
  const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, JSON.stringify({}));
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, claudeDesktop: join(d, 'desk'), claudeLogoutImpl: async (home) => { rmSync(join(home, 'compat.json'), { force: true }); rmSync(join(home, 'compat-key'), { force: true }); return true; } });
  const id = (await pc.run('claude.accounts.add', { label: 'Solar' })).body.id;
  assert.equal((await pc.run('claude.accounts.compat', { id, baseUrl: 'ftp://x', key: KEY, model: 'm' })).body.error, 'bad_base_url');
  const r = await pc.run('claude.accounts.compat', { id, baseUrl: 'https://api.upstage.ai/v1/claude', key: KEY, model: 'solar-pro4' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.accounts[0].compat, { host: 'api.upstage.ai', model: 'solar-pro4', confirmed: true });
  assert.ok(!JSON.stringify(r.body).includes(KEY), '응답에 키가 없음');
  assert.ok(!readFileSync(join(d, 'accounts', 'claude', id, 'compat.json'), 'utf8').includes(KEY), '키는 따로(600) 파일');
  assert.equal((await pc.run('claude.accounts.logout', { id })).body.accounts[0].kind, null);
});

test('Claude 실행: 기존 대화는 existing으로 물어 확인 안 된 호환 주소면 부르지 않고 거절, 새 세션은 existing 아님', async (t) => {
  const d = tmp(t); const cwd = join(d, 'w'); mkdirSync(cwd);
  const ID = '0c0e0000-0000-4000-8000-000000000001';
  const asked = []; let ran = 0;
  const run = async () => { ran += 1; return { code: 0, stdout: JSON.stringify({ session_id: ID, subtype: 'success', result: 'ok', usage: {} }), stopped: false }; };
  const a = claudeCliAdapter({ live: true, spawnClaude: run, allowlist: [ID], workingDirectories: { [ID]: cwd }, busy: () => 'free',
    accountEnv: (ref, o) => { asked.push(o.existing); if (o.existing) throw Object.assign(new Error('combo_unverified'), { http: 409 }); return null; } });
  await assert.rejects(a.run({ sessionRef: ID, question: 'q' }), (e) => e.code === 'combo_unverified' || e.message === 'combo_unverified');
  assert.deepEqual([asked, ran], [[true], 0]);
});

test('화면·메신저·채널 창: 호환 주소 칸·안내 문구, 채널 창은 확인된 조합만', () => {
  const SET = koView('settings.html');
  assert.ok(SET.includes('id="clCompatForm"') && SET.includes("acRun('claude.accounts.compat'"));
  assert.ok(KO['errors.combo_unverified'], '화면·메신저가 같이 쓰는 오류 문구');
  const ps = readFileSync(new URL('../../scripts/ieon.ps1', import.meta.url), 'utf8');
  assert.ok(ps.includes("-notin @('api.upstage.ai')") && ps.includes('`$env:ANTHROPIC_BASE_URL'));
});
