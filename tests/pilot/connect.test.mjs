// P3: PC 연결부의 허브 연결(connect) — 허브 주소 검사, 명령줄 옵션, 기기 API 요청 횟수 제한(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { validateServerUrl, connectorOptions, pollOnce } from '../../src/pilot/connector.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const hasBash = spawnSync('bash', ['--version']).status === 0;

test('허브 주소: 공개 주소는 https만, http는 이 PC만, 사용자 정보·쿼리·조각은 거절', () => {
  assert.equal(validateServerUrl('https://ieun-gateway.sinsan.kr/'), 'https://ieun-gateway.sinsan.kr');
  assert.equal(validateServerUrl('http://127.0.0.1:28760'), 'http://127.0.0.1:28760');
  assert.equal(validateServerUrl('http://localhost:28760/'), 'http://localhost:28760');
  for (const bad of ['http://ieun-gateway.sinsan.kr', 'ftp://x', 'https://u:p@h.example', 'https://h.example/?a=1', 'https://h.example/#x', 'nope', '']) {
    assert.throws(() => validateServerUrl(bad), /bad_server_url/, bad);
  }
});

test('명령줄 --server·--token-file은 설정 값을 대신하고, 허브 연결은 별도 receipt 파일을 쓸 수 있다', () => {
  const cfg = { serverUrl: 'http://127.0.0.1:28760', deviceTokenFile: 'a', receiptPath: 'r.jsonl', hubReceiptPath: 'hub.jsonl' };
  assert.deepEqual(connectorOptions(cfg, []), { serverUrl: 'http://127.0.0.1:28760', deviceTokenFile: 'a', receiptPath: 'r.jsonl' });
  assert.deepEqual(connectorOptions(cfg, ['--server', 'https://hub.example/', '--token-file', 'b']),
    { serverUrl: 'https://hub.example', deviceTokenFile: 'b', receiptPath: 'hub.jsonl' });
  assert.throws(() => connectorOptions(cfg, ['--server', 'http://hub.example']), /bad_server_url/);
});

test('기기 API 요청 횟수 제한: 기기별 한도를 넘으면 429·retry-after, 인증 실패가 많아도 정상 기기는 막히지 않는다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-p3-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), users: [], bindings: [],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }], deviceRateLimit: { perMinute: 5, failPerMinute: 3 } });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const poll = (token) => fetch(base + '/v1/device/jobs', { headers: { authorization: `Bearer ${token}` } });

  const bad = [];
  for (let i = 0; i < 5; i++) bad.push((await poll('wrong')).status);
  assert.deepEqual(bad, [401, 401, 401, 429, 429]);
  const ok = [];
  for (let i = 0; i < 6; i++) ok.push(await poll('dev'));
  assert.deepEqual(ok.map((r) => r.status), [204, 204, 204, 204, 204, 429]);
  assert.ok(Number(ok[5].headers.get('retry-after')) >= 1);
  // 연결부는 429를 오류로 받아 retry-after만큼 쉰다(자동 재전송 대상인 질문은 없음).
  await assert.rejects(pollOnce({ baseUrl: base, deviceToken: 'dev', adapters: {}, receipts: { has: () => false, add() {} } }),
    (e) => e.message === 'poll_429' && e.retryAfterMs >= 1000);
});

test('ieon.sh connect: 주소가 없으면 2, https가 아니면 1, 기기 토큰이 없으면 이유를 알리고 멈춘다', { skip: !hasBash }, () => {
  const run = (...a) => spawnSync('bash', [root + 'scripts/ieon.sh', 'connect', ...a], { encoding: 'utf8', cwd: root });
  assert.equal(run().status, 2);
  const r = run('http://ieun-gateway.sinsan.kr');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /허브 주소가 올바르지 않습니다/);
  assert.equal(spawnSync('bash', [root + 'scripts/ieon.sh', 'start', 'https://x.example'], { encoding: 'utf8' }).status, 2);
});
