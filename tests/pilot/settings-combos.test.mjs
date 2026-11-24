// 2026-11-24 신산님 "우리가 설정한데로 안된다면 그렇게 설정을 못하게 해야": 계정 탭에서 고를 수 있는 것은 그대로 동작하고,
// 동작할 수 없는 조합은 고르지 못한다. 모델 호출 0(가짜 세션 파일·가짜 연결부 설정).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { claudeSessionModel, isForeignModel } from '../../src/pilot/claude-sessions.mjs';
import { claudeCliAdapter } from '../../src/pilot/adapters/claude-cli.mjs';
import { koView } from './web-page.mjs';

const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-combo-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const TID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const SOLAR = 'f494975d-c542-4497-8e6c-2acd390f0ead';

test('Claude 세션 파일에서 마지막 모델(<synthetic> 빼고), 다른 회사 모델 판별', (t) => {
  const d = tmp(t); mkdirSync(join(d, 'D--w-solar'));
  writeFileSync(join(d, 'D--w-solar', `${SOLAR}.jsonl`), ['{"message":{"model":"solar-pro4"}}', '{"message":{"model":"<synthetic>"}}'].join('\n'));
  assert.equal(claudeSessionModel(SOLAR, d), 'solar-pro4');
  assert.equal(claudeSessionModel('01a18790-0000-4000-8000-000000000000', d), null);
  assert.ok(isForeignModel('solar-pro4') && !isForeignModel('claude-opus-5-5') && !isForeignModel('sonnet') && !isForeignModel(null));
});

test('Codex: 로그인·호환 주소 없는 계정은 기본·대화별로 못 고름, 기존 대화에 호환 주소 계정은 못 고름, 호환 주소는 기본(새 세션)으로는 고름', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json');
  writeFileSync(cfg, JSON.stringify({ codex: { allowlist: [TID] } }));
  const prev = process.env.CODEX_HOME; process.env.CODEX_HOME = join(d, 'desk'); t.after(() => { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; });
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, accountLogin: () => ({ start() {}, cancel() {}, view: () => ({ state: 'idle' }), logout: async () => {} }) });
  const empty = (await pc.run('accounts.add', { label: 'empty' })).body.id;
  assert.equal((await pc.run('accounts.use', { accountId: empty })).body.error, 'account_not_logged_in');
  assert.equal((await pc.run('accounts.use', { threadId: TID, accountId: empty })).body.error, 'account_not_logged_in');
  const up = (await pc.run('accounts.add', { label: 'upstage' })).body.id;
  const r = await pc.run('accounts.compat', { id: up, baseUrl: 'https://api.upstage.ai/v1', model: 'solar-pro4', key: 'up_test_key_123' });
  assert.equal(r.body.accounts.find((a) => a.id === up).compat.url, 'https://api.upstage.ai/v1', '화면에 주소 전체(키 없음)');
  assert.equal((await pc.run('accounts.use', { threadId: TID, accountId: up })).body.error, 'combo_unverified');
  assert.equal((await pc.run('accounts.use', { accountId: up })).status, 200, '기본(새 세션용)으로는 고름');
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).codex.defaultAccount, up);
});

test('Claude: 다른 회사 모델로 만든 새 세션은 그 모델을 아는 호환 주소 계정만, 기본을 바꿔 그 세션이 막히면 거절, 보내기 전에도 이유로 거절', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json');
  const created = join(d, 's2', 'new-threads.jsonl');
  writeFileSync(created, JSON.stringify({ id: SOLAR, name: 'solar-test', at: 'x' }) + '\n');
  writeFileSync(cfg, JSON.stringify({ newSessions: { createdPath: created } }));
  const proj = join(d, 'projects'); mkdirSync(join(proj, 'D--w-solar'), { recursive: true });
  writeFileSync(join(proj, 'D--w-solar', `${SOLAR}.jsonl`), '{"message":{"model":"solar-pro4"}}\n');
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null, claudeDesktop: join(d, 'desk'), claudeProjects: proj });
  const solar = (await pc.run('claude.accounts.add', { label: '개인' })).body.id;
  await pc.run('claude.accounts.compat', { id: solar, baseUrl: 'https://api.upstage.ai', model: 'solar-pro4', key: 'up_test_key_123' });
  const g = await pc.run('claude.get');
  const s = g.body.pc.sessions.find((x) => x.sessionId === SOLAR);
  assert.deepEqual([s.newSession, s.model], [true, 'solar-pro4']);
  assert.equal(g.body.pc.accounts[0].compat.url, 'https://api.upstage.ai');
  assert.equal((await pc.run('claude.accounts.use', { sessionId: SOLAR, accountId: 'pc_default' })).body.error, 'session_model_mismatch');
  assert.equal((await pc.run('claude.accounts.use', { sessionId: SOLAR, accountId: 'inherit' })).body.error, 'session_model_mismatch', '기본이 PC면 기본 따름도 못 고름');
  assert.equal((await pc.run('claude.accounts.use', { sessionId: SOLAR, accountId: solar })).status, 200);
  await pc.run('claude.accounts.use', { sessionId: SOLAR, accountId: 'inherit' }).catch(() => {});
  // 기본을 호환 주소로 → 기본 따름 허용 → 그 뒤 기본을 PC로 되돌리면 solar-test가 막히므로 거절
  assert.equal((await pc.run('claude.accounts.use', { accountId: solar })).status, 200);
  assert.equal((await pc.run('claude.accounts.use', { sessionId: SOLAR, accountId: 'inherit' })).status, 200);
  const back = await pc.run('claude.accounts.use', { accountId: 'pc_default' });
  assert.equal(back.body.error, 'session_model_mismatch'); assert.deepEqual(back.body.sessions, ['solar-test']);
  // 보내기 전에: Anthropic 로그인(호환 주소 아님)인데 세션 모델이 다른 회사 것이면 거절
  const a = claudeCliAdapter({ live: true, newSessions: { config: {}, created: { has: () => true, add() {}, account: () => null } }, accountEnv: () => null, sessionModel: () => 'solar-pro4' });
  await assert.rejects(a.run({ engine: 'claude_cli', sessionRef: SOLAR, question: 'q', newSession: { name: 'solar-test' } }), /session_model_mismatch/);
});

test('화면: Codex·Claude 호환 주소를 방식으로 구별, 고를 수 없는 계정은 이유와 함께 막힘', () => {
  const S = koView('settings.html');
  assert.ok(S.includes('Codex용 호환 주소(OpenAI 방식)') && S.includes('Claude용 호환 주소(Anthropic 방식)'));
  assert.ok(S.includes('호환 주소는 새 세션에서만(고를 수 없음)') && S.includes('로그인·호환 주소가 없어 고를 수 없음'));
  assert.ok(S.includes('o.disabled = Boolean(off)'));
});

test('같은 이름 계정 구별: 고르기 칸 이름에 종류·모델(호환 주소 · solar-pro4 / API 키 / 구독)', () => {
  const S = koView('settings.html');
  assert.ok(S.includes('const optLabel = (a)') && S.includes('(호환 주소 · {model})'.replace('{model}', '')) || S.includes('호환 주소 ·'));
  assert.ok(!S.includes("{ label: a.label, logged_in"), 'Codex 고르기 칸도 optLabel');
});
