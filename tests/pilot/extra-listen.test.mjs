// 2026-11-13: Tailscale이 꺼져 덤 주소(100.x)를 열 수 없자 이 PC 서버 전체가 켜지지 않았다. 덤 주소는 실패해도 서버는 계속 켜져 있어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../src/pilot/server.mjs', import.meta.url));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('덤 주소(이 PC에 없는 Tailscale 주소)를 못 열어도 서버는 켜진 채로 남고 실패만 알린다', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-extra-'));
  const port = await freePort();
  const cfg = join(d, 'server.json');
  writeFileSync(cfg, JSON.stringify({ dbPath: join(d, 'p.db'), port, users: [], devices: [], bindings: [], extraHosts: ['100.64.0.123'] }));
  const child = spawn(process.execPath, [SERVER, cfg], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (x) => { err += x; });
  t.after(async () => { child.kill(); await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r))); await new Promise((r) => setTimeout(r, 200)); rmSync(d, { recursive: true, force: true }); });
  let ok = false;
  for (let i = 0; i < 50 && !ok; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    ok = err.includes('extra_listen_failed');
  }
  assert.ok(ok, err.slice(-400));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(child.exitCode, null, '서버는 꺼지지 않음');
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.status).catch(() => 0);
  assert.equal(health, 200);
});
