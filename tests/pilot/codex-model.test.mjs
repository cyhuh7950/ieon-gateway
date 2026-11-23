// 2026-11-23 인수 시험(신산님 ①): 이어온이 쓸 Codex 모델 — Codex 앱이 기본 모델을 지금 로그인으로 못 쓰는 모델(gpt-6.2-sol)로 바꿔
// 이어온 질문이 모두 막혔음. 연결부 설정 codex.model을 화면에서 정하고, 번갈아 쓰기·새 세션·작업 모드 모두 그 모델로 Codex를 부른다. 모델 호출 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { codexThreadAdapter, stdioAppServer } from '../../src/pilot/adapters/codex-thread.mjs';
import { koView } from './web-page.mjs';

const TID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-model-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('기기 명령: 모델 저장·지우기, 틀린 이름 거절, device.get에 보임', async (t) => {
  const d = tmp(t); mkdirSync(join(d, 's2')); const cfg = join(d, 's2', 'connector.json'); writeFileSync(cfg, '{}');
  const pc = createDeviceAdmin({ connectorConfigPath: cfg, claudeDir: null });
  assert.equal((await pc.run('device.codex.model', { model: 'gpt-6.1-sol' })).status, 200);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).codex.model, 'gpt-6.1-sol');
  assert.equal((await pc.run('device.get', {})).body.codexModel, 'gpt-6.1-sol');
  assert.equal((await pc.run('device.codex.model', { model: 'bad model;rm' })).body.error, 'bad_model');
  assert.equal((await pc.run('device.codex.model', { model: '' })).status, 200);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).codex.model, undefined);
  assert.equal((await pc.run('device.get', {})).body.codexModel, null);
});

test('어댑터: 정한 모델을 SDK(--config model)에 넘김, 없으면 넘기지 않음', async () => {
  const seen = [];
  const loadSdk = async () => ({ Codex: class {
    constructor(o) { seen.push(o); }
    resumeThread(id) { return { id, async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: id }; yield { type: 'item.completed', item: { type: 'agent_message', text: '확인' } }; yield { type: 'turn.completed' }; })() }; } }; }
  } });
  const mk = (model) => codexThreadAdapter({ live: true, allowlist: [TID], probe: () => 'NO_LOCK_FILE', loadSdk, model });
  await mk('gpt-6.1-sol').run({ engine: 'codex_thread', sessionRef: TID, question: 'q', connectMode: 'alternate' });
  await mk(null).run({ engine: 'codex_thread', sessionRef: TID, question: 'q', connectMode: 'alternate' });
  assert.deepEqual(seen[0]?.config, { model: 'gpt-6.1-sol' });
  assert.equal(seen[1], undefined);
});

test('작업 모드 app-server: 모델이 있으면 -c model=… 로 띄움', () => {
  const calls = [];
  const fake = (bin, args) => { calls.push(args); return { stdout: { on() {} }, stdin: { write() {} }, on() {}, kill() {} }; };
  stdioAppServer({ env: {}, cwd: '.', model: 'gpt-6.1-sol', spawnImpl: fake });
  stdioAppServer({ env: {}, cwd: '.', spawnImpl: fake });
  assert.deepEqual(calls[0].slice(1, 4), ['-c', 'model="gpt-6.1-sol"', 'app-server']);
  assert.deepEqual(calls[1].slice(1), ['app-server']);
});

test('화면: PC 설정에 "이어온이 쓸 Codex 모델" 칸과 저장', () => {
  const S = koView('settings.html');
  assert.ok(S.includes('id="devModel"') && S.includes('id="devModelSave"') && S.includes("devRun('device.codex.model'"));
});
