// E1·E2(MORE_ENGINES): Grok·Antigravity — 세션 쪽(같은 ID 이어 쓰기·사용 중 거부·읽기 전용·대체 없음)과 토큰 쪽(API 키 변수 제거, 계정은 이어온이 넘김).
// Antigravity는 E0 실측대로, Grok은 공식 문서대로(실제 시험은 구독 뒤). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliOnceAdapter } from '../../src/pilot/adapters/cli-once.mjs';
import { EngineError } from '../../src/pilot/contracts.mjs';
import { upsertCliSession, readDevice } from '../../src/pilot/device-settings.mjs';
import { createDeviceAdmin } from '../../src/pilot/device-admin.mjs';
import { validateBinding } from '../../src/pilot/settings.mjs';
import { probeLockAt } from '../../src/pilot/lock-probe.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
const KO = loadDict('ko');

const A = '9e943423-83d6-448a-aaf0-48b2121879e5';
const fakeRun = (result) => { const calls = []; const run = async (bin, args, o) => { calls.push({ bin, args, env: o.env, cwd: o.cwd }); return typeof result === 'function' ? result(args) : result; }; return { run, calls }; };
const ok = (id = A) => ({ code: 0, stdout: JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '준비됨', duration_seconds: 3, num_turns: 1, usage: { input: 1 } }), stderr: '' });

test('Antigravity: 허용 목록·AI 응답·사용 중(잠금)을 먼저 확인하고, 읽기 전용 옵션으로 같은 대화를 이어 쓴다', async () => {
  const f = fakeRun(ok());
  const mk = (o = {}) => cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [A], run: f.run, probe: () => 'NO_WRITER_LOCK', ...o });
  const job = { engine: 'agy_cli', sessionRef: A, question: '안녕' };
  await assert.rejects(mk({ allowlist: [] }).run(job), (e) => e.code === 'session_not_allowed');
  await assert.rejects(mk({ live: false }).run(job), (e) => e.code === 'live_disabled');
  await assert.rejects(mk({ probe: () => 'WRITER_LOCK_CONFLICT' }).run(job), (e) => e instanceof EngineError && e.code === 'session_in_use');
  await assert.rejects(mk({ probe: () => 'LOCK_CHECK_ERROR' }).run(job), (e) => e.code === 'lock_check_failed');
  assert.equal(f.calls.length, 0, '거절되면 실행하지 않음');
  const prev = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = 'paid-key';
  try {
    const r = await mk({ accountEnv: () => ({ IEON_ACCOUNT: 'x' }) }).run(job);
    assert.deepEqual([r.answer, r.receipt], ['준비됨', `agy_cli:${A}`]);
  } finally { if (prev === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prev; }
  const c = f.calls.at(-1);
  assert.deepEqual(c.args, ['-p', '안녕', '--output-format', 'json', '--mode', 'plan', '--sandbox', '--print-timeout', '280s', '--conversation', A]);
  assert.ok(!c.args.includes('--dangerously-skip-permissions') && !c.args.includes('--remote-control'));
  assert.equal(c.env.GEMINI_API_KEY, undefined, 'API 키 변수는 지움(종량제로 새지 않게)');
  assert.equal(c.env.IEON_ACCOUNT, 'x', '토큰 쪽은 이어온이 넘긴 계정');
});

test('Antigravity: 다른 대화로 답하면 결과 불명(대체 없음), 한도는 실행 안 됨, 불러오기 실패가 분명하면 실행 안 됨, 그 밖에는 결과 불명', async () => {
  const run = (res) => cliOnceAdapter({ live: true, engine: 'agy_cli', allowlist: [A], run: fakeRun(res).run, probe: () => 'NO_LOCK_FILE' }).run({ sessionRef: A, question: 'q' });
  await assert.rejects(run(ok('11111111-1111-1111-1111-111111111111')), (e) => !(e instanceof EngineError) && e.unknownCode === 'session_changed');
  await assert.rejects(run({ code: 0, stdout: JSON.stringify({ conversation_id: A, status: 'RESOURCE_EXHAUSTED', response: '' }), stderr: '' }), (e) => e.code === 'usage_limit');
  await assert.rejects(run({ code: 1, stdout: '', stderr: 'conversation not found' }), (e) => e instanceof EngineError && e.code === 'session_load_failed');
  await assert.rejects(run({ code: 1, stdout: '', stderr: 'boom' }), (e) => !(e instanceof EngineError) && e.unknownCode === 'cli_exit_1');
  await assert.rejects(run({ code: 0, stdout: JSON.stringify({ conversation_id: A, status: 'ERROR', response: '반쯤' }), stderr: '' }), (e) => !(e instanceof EngineError));
});

test('Grok(공식 문서 기준, 실제 시험은 구독 뒤): -r 같은 세션, 자동 승인·갈라 쓰기 없음, XAI_API_KEY 지움, 다른 세션이면 결과 불명', async () => {
  const f = fakeRun({ code: 0, stdout: JSON.stringify({ sessionId: 'gs_123456', result: '안녕' }), stderr: '' });
  let probed = false;
  const prev = process.env.XAI_API_KEY; process.env.XAI_API_KEY = 'metered';
  try {
    const r = await cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: ['gs_123456'], run: f.run, probe: () => { probed = true; return 'NO_LOCK_FILE'; } }).run({ sessionRef: 'gs_123456', question: 'q' });
    assert.equal(r.answer, '안녕');
  } finally { if (prev === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = prev; }
  const c = f.calls[0];
  assert.deepEqual(c.args, ['-p', 'q', '--output-format', 'json', '-r', 'gs_123456']);
  assert.ok(!c.args.some((a) => ['--always-approve', '--yolo', '--fork-session'].includes(a)));
  assert.equal(c.env.XAI_API_KEY, undefined);
  assert.equal(probed, false, 'Grok 잠금 위치는 미확인 — 판별하지 않음(화면 안내)');
  const other = fakeRun({ code: 0, stdout: JSON.stringify({ sessionId: 'gs_other1', result: 'x' }), stderr: '' });
  await assert.rejects(cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: ['gs_123456'], run: other.run }).run({ sessionRef: 'gs_123456', question: 'q' }), (e) => e.unknownCode === 'session_changed');
  // 설치돼 있지 않으면(이 PC는 Grok CLI 없음) 실행하지 않고 알림
  await assert.rejects(cliOnceAdapter({ live: true, engine: 'grok_cli', allowlist: ['gs_123456'], bin: join(tmpdir(), 'no-grok.exe') }).run({ sessionRef: 'gs_123456', question: 'q' }), (e) => e.code === 'engine_not_installed');
});

test('허용 목록·세션 등록: 그 PC 설정(PC·허브 화면 같은 명령), 형식 검사, 업무 대화 제외', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-e12-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const cfg = join(d, 'connector.json'); writeFileSync(cfg, JSON.stringify({ live: false, codex: { allowlist: [] } }));
  assert.throws(() => upsertCliSession(cfg, { engine: 'agy_cli', sessionId: 'nope' }), /bad_session_id/);
  assert.throws(() => upsertCliSession(cfg, { engine: 'agy_cli', sessionId: '01a0dadd-739f-74d2-93c5-9c405cc1019b' }), /excluded_session/);
  assert.throws(() => upsertCliSession(cfg, { engine: 'gemini_cli', sessionId: A }), /bad_engine/);
  const admin = createDeviceAdmin({ connectorConfigPath: cfg });
  let r = await admin.run('device.cli.put', { engine: 'agy_cli', sessionId: A, workingDirectory: d });
  assert.deepEqual(r.body.cliSessions, [{ engine: 'agy_cli', sessionId: A, workingDirectory: d.replaceAll('\\', '/') }]);
  r = await admin.run('device.cli.delete', { engine: 'agy_cli', sessionId: A });
  assert.deepEqual(readDevice(cfg).cliSessions, []);
  assert.equal(validateBinding('c_ag', { engine: 'agy_cli', label: 'Ag', hostId: 'h', sessionRef: A }, ['h']).engine, 'agy_cli');
  assert.throws(() => validateBinding('c_ag', { engine: 'agy_cli', label: 'Ag', hostId: 'h', sessionRef: 'x' }, ['h']), /bad_session_ref/);
  assert.equal(validateBinding('c_gk', { engine: 'grok_cli', label: 'Gk', hostId: 'h', sessionRef: 'gs_123456' }, ['h']).engine, 'grok_cli');
  assert.throws(() => probeLockAt('01a0dadd-739f-74d2-93c5-9c405cc1019b', d), /EXCLUDED_THREAD/);
});

test('화면: PC 설정의 Antigravity·Grok 허용 목록, 세션 등록 엔진, 대화 화면 이름·안내·오류 문구', () => {
  const S = readFileSync(fileURLToPath(new URL('../../src/pilot/web/settings.html', import.meta.url)), 'utf8');
  const P = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');
  assert.ok(S.includes('id="cliAdd"') && S.includes('id="cliList"') && S.includes("devRun('device.cli.put'") && S.includes('<option value="agy_cli">Antigravity 대화</option>'));
  assert.ok(P.includes("agy_cli: 'Antigravity', grok_cli: 'Grok'") && KO['errors.session_in_use'] && KO['errors.session_load_failed']);
  assert.ok(/ERR_HARD = new Set\([^)]*'session_load_failed'/.test(P) && !/ERR_HARD = new Set\([^)]*'session_in_use'/.test(P));
});
