// 설치가 Claude 채널을 준비한다(2026-11-12): .local/c1의 열쇠·.mcp.json, 연결부의 claude 설정이 같은 열쇠를 가리키고,
// 그 설정으로 띄운 채널에 연결부(어댑터)가 질문을 넣고 답을 받는다. 모델 호출 0, 실제 Claude Code 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLocal, prepareWebFirst } from '../../scripts/ieon-init.mjs';
import { claudeChannelAdapter } from '../../src/pilot/adapters/claude-channel.mjs';

const CHANNEL = fileURLToPath(new URL('../../src/pilot/ieon-channel.mjs', import.meta.url));
const INIT = fileURLToPath(new URL('../../scripts/ieon-init.mjs', import.meta.url));
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-c1s-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const json = (d, p) => JSON.parse(readFileSync(join(d, '.local', p), 'utf8'));
const freePort = () => new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

test('처음 설치: Claude 채널 열쇠·.mcp.json·연결부 설정을 만들고, 셋이 같은 열쇠 파일을 가리킨다', (t) => {
  const d = tmp(t);
  const changes = prepareWebFirst(d);
  for (const c of ['created:c1/token', 'created:c1/.mcp.json', 'connector:claude']) assert.ok(changes.includes(c), c);
  const posix = d.replaceAll('\\', '/');
  assert.match(readFileSync(join(d, '.local/c1/token'), 'utf8'), /^[0-9a-f]{64}$/);
  const mcp = json(d, 'c1/.mcp.json').mcpServers.ieon;
  assert.equal(mcp.command, 'node');
  assert.deepEqual(mcp.args, [`${posix}/src/pilot/ieon-channel.mjs`]);
  assert.deepEqual(mcp.env, { IEON_CHANNEL_PORT: '28762', IEON_CHANNEL_TOKEN_FILE: `${posix}/.local/c1/token` });
  assert.deepEqual(json(d, 's2/connector.json').claude, { baseUrl: 'http://127.0.0.1:28762', tokenFile: `${posix}/.local/c1/token` });
  assert.ok(!readFileSync(join(d, '.local/c1/.mcp.json'), 'utf8').includes(readFileSync(join(d, '.local/c1/token'), 'utf8')), '.mcp.json에 열쇠 값 없음');
  assert.deepEqual(prepareWebFirst(d), [], '다시 해도 바뀌는 것 없음');
});

test('이미 있던 채널 열쇠·.mcp.json·연결부 claude 설정은 바꾸지 않는다(이 PC처럼 손으로 준비한 경우)', (t) => {
  const d = tmp(t);
  initLocal(d);
  mkdirSync(join(d, '.local/c1'), { recursive: true });
  writeFileSync(join(d, '.local/c1/token'), 'kept-token-0123456789');
  writeFileSync(join(d, '.local/c1/.mcp.json'), '{"mcpServers":{"ieon":{"command":"node","args":["X"],"env":{}}}}');
  const conn = json(d, 's2/connector.json'); conn.claude = { baseUrl: 'http://127.0.0.1:19999', tokenFile: 'Y' };
  writeFileSync(join(d, '.local/s2/connector.json'), JSON.stringify(conn));
  const changes = prepareWebFirst(d);
  assert.ok(!changes.some((c) => c.includes('c1/') || c === 'connector:claude'), changes.join(','));
  assert.equal(readFileSync(join(d, '.local/c1/token'), 'utf8'), 'kept-token-0123456789');
  assert.deepEqual(json(d, 'c1/.mcp.json').mcpServers.ieon.args, ['X']);
  assert.equal(json(d, 's2/connector.json').claude.baseUrl, 'http://127.0.0.1:19999');
});

test('설치 명령은 열쇠 값을 화면에 내지 않는다', (t) => {
  const d = tmp(t);
  const r = spawnSync(process.execPath, [INIT, '--web-first', d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created:c1\/token/);
  assert.ok(!r.stdout.includes(readFileSync(join(d, '.local/c1/token'), 'utf8')));
});

test('만든 설정 그대로 채널을 띄우면 연결부가 같은 열쇠로 질문을 넣고 reply 답을 받는다', async (t) => {
  const d = tmp(t);
  prepareWebFirst(d);
  const mcp = json(d, 'c1/.mcp.json').mcpServers.ieon;
  const claude = json(d, 's2/connector.json').claude;
  const port = await freePort(); // 28762가 이 PC에서 쓰이고 있을 수 있어 시험에서는 빈 포트로
  const child = spawn(process.execPath, [CHANNEL], { env: { ...process.env, ...mcp.env, IEON_CHANNEL_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const lines = []; let out = '';
  child.stdout.on('data', (c) => { out += c; let i; while ((i = out.indexOf('\n')) >= 0) { lines.push(JSON.parse(out.slice(0, i))); out = out.slice(i + 1); } });
  const waitFor = async (pred) => { for (let n = 0; n < 200; n++) { const hit = lines.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout'); };
  await new Promise((r) => child.stderr.once('data', r));
  const adapter = claudeChannelAdapter({ live: true, baseUrl: `http://127.0.0.1:${port}`, tokenFile: claude.tokenFile, pollMs: 30, waitMs: 5000 });
  const run = adapter.run({ requestId: 'req_setup0001', question: '설치 확인' });
  const note = await waitFor((m) => m.method === 'notifications/claude/channel');
  assert.equal(note.params.content, '설치 확인');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'reply', arguments: { reply_to: note.params.meta.message_id, text: '준비됨' } } }) + '\n');
  assert.equal((await run).answer, '준비됨');
});