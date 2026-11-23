// 2026-11-23 인수 시험(신산님 ①): 이어온이 쓸 Codex 모델 — Codex 앱이 기본 모델을 지금 로그인으로 못 쓰는 모델(gpt-6.2-sol)로 바꿔
// 이어온 질문이 모두 막혔음. 연결부 설정 codex.model을 화면에서 정하고, 번갈아 쓰기·새 세션·작업 모드 모두 그 모델로 Codex를 부른다. 모델 호출 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { codexThreadAdapter, stdioAppServer, listMcpNames, configMcpNames } from '../../src/pilot/adapters/codex-thread.mjs';
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

// 인수 시험(신산님 "답변이 오는 시간이 너무 걸리는데"): 질문마다 사용자 Codex의 MCP 서버 11개를 띄우느라 15초 — 질문 모드·새 세션에서는 끈다
test('어댑터: 켜진 MCP 서버를 질문 실행에서만 끔(mcp_servers.<이름>.enabled=false), 모델과 함께', async () => {
  const seen = [];
  const loadSdk = async () => ({ Codex: class {
    constructor(o) { seen.push(o); }
    resumeThread(id) { return { id, async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: id }; yield { type: 'item.completed', item: { type: 'agent_message', text: '확인' } }; yield { type: 'turn.completed' }; })() }; } }; }
  } });
  const a = codexThreadAdapter({ live: true, allowlist: [TID], probe: () => 'NO_LOCK_FILE', loadSdk, model: 'gpt-6.1-sol', mcpList: async () => ['korean-law', 'context7'] });
  await a.run({ engine: 'codex_thread', sessionRef: TID, question: 'q', connectMode: 'alternate' });
  assert.deepEqual(seen[0].config, { model: 'gpt-6.1-sol', mcp_servers: { 'korean-law': { enabled: false }, context7: { enabled: false } } });
});

test('MCP 목록: 켜진 것만·이상한 이름 빼기, 10분 기억, 못 읽으면 빈 목록', async () => {
  let calls = 0;
  const run = (bin, args, o, cb) => { calls++; cb(null, JSON.stringify([{ name: 'a', enabled: true }, { name: 'off', enabled: false }, { name: 'bad name;x', enabled: true }, { name: 'b-2' }])); };
  const env = { CODEX_HOME: 'x-' + Math.random() };
  const inConfig = () => new Set(['a', 'b-2', 'off']); // 설정 파일에 적힌 것만(앱 플러그인 서버는 빼야 Codex가 시작됨)
  assert.deepEqual(await listMcpNames(env, { now: 1000, run, inConfig }), ['a', 'b-2']);
  assert.deepEqual(await listMcpNames(env, { now: 2000, run, inConfig }), ['a', 'b-2']);
  assert.deepEqual(await listMcpNames({ CODEX_HOME: 'z-' + Math.random() }, { now: 1, run, inConfig: () => new Set(['a']) }), ['a']);
  assert.equal(calls, 2); // 같은 CODEX_HOME은 한 번만 읽고, 다른 계정 폴더는 따로
  await listMcpNames(env, { now: 1000 + 11 * 60_000, run, inConfig });
  assert.equal(calls, 3);
  assert.deepEqual(await listMcpNames({ CODEX_HOME: 'y-' + Math.random() }, { now: 1, run: (b, a, o, cb) => cb(new Error('x')) }), []);
});

test('설정 파일의 [mcp_servers.이름] 만 읽음(따옴표 이름 포함, 하위 표 제외)', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'config.toml'), ['model = "x"', '[mcp_servers.korean-law]', 'command = "a"', '[mcp_servers."daon2"]', 'url = "b"', '[mcp_servers.korean-law.env]', 'K = "v"', '[profiles.p]'].join(String.fromCharCode(10)));
  assert.deepEqual([...configMcpNames({ CODEX_HOME: d })].sort(), ['daon2', 'korean-law']);
});
