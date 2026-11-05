// C1 이어온 채널 단독 검사(모델 0): Claude Code 대신 테스트가 MCP 클라이언트 역할을 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../src/pilot/ieon-channel.mjs', import.meta.url));
const PORT = 18799;
const BASE = `http://127.0.0.1:${PORT}`;

test('이어온 채널: 전달·reply·중복·인증', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-c1-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, 'test-token-0123456789');
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, IEON_CHANNEL_TOKEN_FILE: tokenFile, IEON_CHANNEL_PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let out = '';
  child.stdout.on('data', (c) => {
    out += c;
    let i;
    while ((i = out.indexOf('\n')) >= 0) { lines.push(JSON.parse(out.slice(0, i))); out = out.slice(i + 1); }
  });
  const waitFor = async (pred) => {
    for (let n = 0; n < 100; n++) { const hit = lines.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 30)); }
    throw new Error('timeout');
  };
  const rpc = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const auth = { authorization: 'Bearer test-token-0123456789', 'content-type': 'application/json' };
  try {
    await new Promise((r) => child.stderr.once('data', r));
    rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const init = await waitFor((m) => m.id === 1);
    assert.deepEqual(init.result.capabilities.experimental, { 'claude/channel': {} });
    rpc({ id: 2, method: 'tools/list' });
    assert.equal((await waitFor((m) => m.id === 2)).result.tools[0].name, 'reply');

    assert.equal((await fetch(`${BASE}/v1/health`)).status, 401);
    const body = JSON.stringify({ request_id: 'req-00000001', text: '질문' });
    assert.equal((await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: auth, body })).status, 202);
    const note = await waitFor((m) => m.method === 'notifications/claude/channel');
    assert.equal(note.params.meta.message_id, 'req-00000001');
    assert.equal(note.params.content, '질문');
    assert.equal((await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: auth, body })).status, 409);

    rpc({ id: 3, method: 'tools/call', params: { name: 'reply', arguments: { reply_to: 'nope', text: 'x' } } });
    assert.equal((await waitFor((m) => m.id === 3)).result.isError, true);
    rpc({ id: 4, method: 'tools/call', params: { name: 'reply', arguments: { reply_to: 'req-00000001', text: '답' } } });
    assert.equal((await waitFor((m) => m.id === 4)).result.isError, undefined);
    rpc({ id: 5, method: 'tools/call', params: { name: 'reply', arguments: { reply_to: 'req-00000001', text: '답 다시' } } });
    assert.equal((await waitFor((m) => m.id === 5)).result.isError, true);
    const replies = await (await fetch(`${BASE}/v1/replies?request_id=req-00000001`, { headers: auth })).json();
    assert.deepEqual(replies.replies.map((r) => r.text), ['답']);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
