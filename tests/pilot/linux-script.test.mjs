// Linux 실행 도우미·systemd 유닛 초안의 정적 점검(서버 기동·모델 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(root + p);
const hasBash = spawnSync('bash', ['--version']).status === 0;

test('셸 스크립트·systemd 유닛은 LF 줄바꿈이다(CRLF면 Linux에서 실행되지 않음)', () => {
  const files = ['scripts/ieon.sh', ...readdirSync(root + 'deploy/systemd').filter((f) => f.endsWith('.service')).map((f) => 'deploy/systemd/' + f)];
  for (const f of files) assert.ok(!read(f).includes('\r'), f);
});

test('ieon.sh는 문법 오류가 없고 알 수 없는 명령에 사용법과 종료 코드 2를 준다', { skip: !hasBash }, () => {
  assert.equal(spawnSync('bash', ['-n', root + 'scripts/ieon.sh']).status, 0);
  const r = spawnSync('bash', [root + 'scripts/ieon.sh', 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /start \[--shared\] \[--live\]/);
});

test('systemd 유닛은 승인 전 live를 바꾸지 않고 토큰·비밀을 담지 않는다', () => {
  for (const f of readdirSync(root + 'deploy/systemd').filter((x) => x.endsWith('.service'))) {
    const t = read('deploy/systemd/' + f).toString('utf8');
    assert.match(t, /^ExecStart=\/usr\/bin\/env node src\/pilot\//m, f);
    assert.match(t, /^WorkingDirectory=%h\/deploy\/ieon-gateway$/m, f);
    assert.match(t, /^NoNewPrivileges=true$/m, f);
    assert.ok(!/live|TOKEN|SECRET|PASSWORD|xoxb|xapp/i.test(t.replace(/^#.*$/gm, '')), f); // 주석 밖에 비밀·live 설정이 없다
  }
});

test('설정(.local)이 없는 곳에서 status는 오류로 끊기지 않고, start는 이유를 알리고 멈춘다', { skip: !hasBash }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-sh-'));
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'src/pilot'), { recursive: true });
    copyFileSync(root + 'scripts/ieon.sh', join(dir, 'scripts/ieon.sh'));
    for (const f of ['lock-probe.mjs', 'lock-probe.ps1']) copyFileSync(root + 'src/pilot/' + f, join(dir, 'src/pilot', f));
    const st = spawnSync('bash', [join(dir, 'scripts/ieon.sh'), 'status'], { encoding: 'utf8' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /설정 없음/);
    const go = spawnSync('bash', [join(dir, 'scripts/ieon.sh'), 'start'], { encoding: 'utf8' });
    assert.equal(go.status, 1);
    assert.match(go.stderr, /s2\/server\.json 가 없습니다/);
    assert.equal(spawnSync('bash', [join(dir, 'scripts/ieon.sh'), 'stop'], { encoding: 'utf8' }).status, 0); // 설정이 없어도 stop은 끊기지 않는다
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('start는 실제 프로세스 PID를 기록하고 두 번째 start는 중복 기동하지 않으며 stop이 모두 끈다(Linux)', { skip: process.platform !== 'linux' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-pid-'));
  const sh = join(dir, 'scripts/ieon.sh');
  const run = (...a) => spawnSync('bash', [sh, ...a], { encoding: 'utf8', timeout: 30000 });
  const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'src/pilot'), { recursive: true }); mkdirSync(join(dir, '.local/s2'), { recursive: true });
    copyFileSync(root + 'scripts/ieon.sh', sh);
    for (const f of ['server.mjs', 'connector.mjs']) writeFileSync(join(dir, 'src/pilot', f), 'setInterval(() => {}, 1000);\n'); // 가짜 서버·연결부(오래 사는 node)
    writeFileSync(join(dir, '.local/s2/server.json'), '{}');
    writeFileSync(join(dir, '.local/s2/connector.json'), '{"live":false}');
    assert.equal(run('start').status, 0);
    const pids = ['server', 'connector'].map((n) => readFileSync(join(dir, `.local/run/${n}.pid`), 'utf8').trim());
    for (const [i, n] of ['server', 'connector'].entries()) {
      assert.ok(alive(pids[i]), `${n} 살아 있음`);
      assert.match(readFileSync(`/proc/${pids[i]}/cmdline`, 'utf8').replaceAll('\0', ' '), new RegExp(`node src/pilot/${n}\.mjs`)); // 서브셸이 아니라 node의 PID
    }
    const again = run('start');
    assert.match(again.stdout, /server: 이미 실행 중/);
    assert.match(again.stdout, /connector: 이미 실행 중/);
    assert.deepEqual(['server', 'connector'].map((n) => readFileSync(join(dir, `.local/run/${n}.pid`), 'utf8').trim()), pids); // 새 프로세스가 생기지 않음
    assert.equal(run('stop').status, 0);
    for (const p of pids) assert.ok(!alive(p), `PID ${p} 종료됨`);
    assert.equal(existsSync(join(dir, '.local/run/server.pid')), false);
  } finally {
    for (const n of ['server', 'connector']) { try { process.kill(Number(readFileSync(join(dir, `.local/run/${n}.pid`), 'utf8')), 'SIGKILL'); } catch { /* 이미 종료 */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});
