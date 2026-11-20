// Antigravity 호환 주소(신산님 2026-11-19 "넣어 보기"): 기업용 모델 게이트웨이 환경 변수로, 이어온 Antigravity 계정 — 새 세션에서만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyHomeOf, agyRunFor, readAgyCompat, saveAgyCompat } from '../../src/pilot/agy-accounts.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-agc-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const KEY = 'AIza' + 'k'.repeat(35);
const GW = 'gw-key-123456';

test('저장(https·localhost만, 모델 목록·형식)·키는 따로, 실행 환경은 게이트웨이 변수만(API 키 변수 지움)·인증 요청 없음', (t) => {
  const d = tmp(t); const dir = join(d, 'acc'); const home = agyHomeOf(dir, 'g1'); mkdirSync(home, { recursive: true });
  assert.throws(() => saveAgyCompat(home, { baseUrl: 'http://gw.example.com', key: KEY }), /bad_base_url/);
  assert.throws(() => saveAgyCompat(home, { baseUrl: 'https://gw.example.com', key: KEY, models: 'a b' }), /bad_model/);
  assert.throws(() => saveAgyCompat(home, { baseUrl: 'https://gw.example.com', key: KEY, wire: 'chat' }), /bad_wire/);
  writeFileSync(join(home, 'api-key'), KEY);
  saveAgyCompat(home, { baseUrl: 'https://gw.example.com/v1beta/', key: GW, models: 'gemini-x, my-tuned', wire: 'gemini' });
  assert.ok(!existsSync(join(home, 'api-key')), '한 계정은 한 방식');
  assert.deepEqual(readAgyCompat(home), { baseUrl: 'https://gw.example.com/v1beta', models: ['gemini-x', 'my-tuned'], wire: 'gemini' });
  assert.ok(!readFileSync(join(home, 'compat.json'), 'utf8').includes(GW));
  const c = { agyAccounts: { accounts: [{ id: 'g1', label: '회사 게이트웨이' }], defaultAccount: 'g1' } };
  const r = agyRunFor(c, dir, null, { env: { GEMINI_API_KEY: 'leak', AGY_LLM_GATEWAY_HEADERS: 'leak' } });
  const e = r.env;
  assert.deepEqual([r.authMethod, e.AGY_LLM_GATEWAY_URL, e.AGY_LLM_GATEWAY_API_KEY, e.AGY_LLM_GATEWAY_MODELS, e.AGY_LLM_GATEWAY_WIRE_PROTOCOL, 'GEMINI_API_KEY' in e, 'AGY_LLM_GATEWAY_HEADERS' in e],
    [null, 'https://gw.example.com/v1beta', GW, 'gemini-x,my-tuned', 'gemini', false, false]);
  saveAgyCompat(home, { baseUrl: 'http://localhost:8080', key: GW });
  assert.equal(agyRunFor(c, dir, null, { env: {} }).env.AGY_LLM_GATEWAY_MODELS, undefined, '모델을 비우면 게이트웨이 목록');
});

test('기기 명령: 호환 주소 저장·보기(호스트·모델·형식, 키 없음)·지우기, 화면 칸', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, '{}');
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null });
  const id = (await pc.run('agy.accounts.add', { label: '게이트웨이' })).body.id;
  assert.equal((await pc.run('agy.accounts.compat', { id, baseUrl: 'ftp://x', key: 'k'.repeat(10) })).body.error, 'bad_base_url');
  const r = await pc.run('agy.accounts.compat', { id, baseUrl: 'https://gw.example.com', key: GW, models: 'm1', wire: 'responses' });
  assert.deepEqual([r.status, r.body.accounts[0].kind, r.body.accounts[0].compat], [200, 'compat', { host: 'gw.example.com', models: ['m1'], wire: 'responses' }]);
  assert.ok(!JSON.stringify(r.body).includes(GW));
  assert.equal((await pc.run('agy.accounts.logout', { id })).body.accounts[0].kind, null);
  const SET = koView('settings.html');
  assert.ok(SET.includes('id="agCompatForm"') && SET.includes("acRun('agy.accounts.compat'"));
});
