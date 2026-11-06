// Linux 실행 도우미·systemd 유닛 초안의 정적 점검(서버 기동·모델 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
