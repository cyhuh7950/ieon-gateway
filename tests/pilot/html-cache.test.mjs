// 배포 뒤 예전 화면이 보이지 않게(2026-11-19 A2-c 배포 확인 중 발견): 첫 화면·설정 화면은 늘 서버에 다시 묻는다(no-cache). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/pilot/server.mjs';

test('화면 HTML(/·/settings)은 cache-control: no-cache', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-cache-'));
  const app = createApp({ dbPath: join(d, 'p.db'), users: [], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  for (const p of ['/', '/settings']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
    await r.text();
  }
});
