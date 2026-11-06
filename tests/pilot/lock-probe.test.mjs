// Linux 잠금 검사 판정 시험(모델·파일 쓰기 없음). /proc/locks 내용과 파일 정보를 바꿔 끼워 Windows에서도 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcLocks, probeLinux, EXCLUDED_THREAD } from '../../src/pilot/lock-probe.mjs';

const ID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const deps = (locks, over = {}) => ({ lockRoot: '/x/locks', exists: () => true, stat: () => ({ ino: 131075 }), readLocks: () => locks, ...over });

const PROC = [
  '1: POSIX  ADVISORY  WRITE 2012 08:01:131075 0 EOF',
  '2: FLOCK  ADVISORY  READ  2020 08:01:999 0 EOF',
  '3: -> FLOCK  ADVISORY  WRITE 2030 08:01:131075 0 EOF',
  '4: OFDLCK ADVISORY  READ  2040 08:01:555 0 EOF',
].join('\n');

test('/proc/locks 줄을 읽어 종류·모드·inode를 뽑는다(대기 중인 잠금은 제외)', () => {
  assert.deepEqual(parseProcLocks(PROC), [
    { type: 'POSIX', mode: 'WRITE', inode: 131075 },
    { type: 'FLOCK', mode: 'READ', inode: 999 },
    { type: 'OFDLCK', mode: 'READ', inode: 555 },
  ]);
  assert.deepEqual(parseProcLocks(''), []);
  assert.deepEqual(parseProcLocks('이상한 줄\n\n'), []);
});

test('같은 inode에 쓰기 잠금이 있으면 충돌, 읽기 잠금만 있으면 충돌 아님', () => {
  assert.equal(probeLinux(ID, deps(PROC)).outcome, 'WRITER_LOCK_CONFLICT');
  assert.equal(probeLinux(ID, deps('2: FLOCK ADVISORY READ 1 08:01:131075 0 EOF')).outcome, 'NO_WRITER_LOCK');
  assert.equal(probeLinux(ID, deps('1: POSIX ADVISORY WRITE 1 08:01:424242 0 EOF')).outcome, 'NO_WRITER_LOCK');
  assert.equal(probeLinux(ID, deps('')).outcome, 'NO_WRITER_LOCK');
});

test('잠금 파일이 없으면 NO_LOCK_FILE, 읽을 수 없으면 실행하지 않는 쪽으로 보고', () => {
  assert.equal(probeLinux(ID, deps(PROC, { exists: () => false })).outcome, 'NO_LOCK_FILE');
  assert.equal(probeLinux(ID, deps(PROC, { stat: () => { throw new Error('EACCES'); } })).outcome, 'OPEN_FAILED');
  assert.equal(probeLinux(ID, deps(PROC, { readLocks: () => { throw new Error('ENOENT'); } })).outcome, 'LOCK_CHECK_ERROR');
});

test('thread ID 형식 오류·업무 대화는 거부한다', () => {
  assert.throws(() => probeLinux('../../etc/passwd', deps(PROC)), /INVALID_THREAD_ID/);
  assert.throws(() => probeLinux('abc', deps(PROC)), /INVALID_THREAD_ID/);
  assert.throws(() => probeLinux(EXCLUDED_THREAD, deps(PROC)), /EXCLUDED_THREAD/);
});

test('결과는 파일 생성·쓰기·모델 호출이 없음을 항상 0으로 보고한다', () => {
  const r = probeLinux(ID, deps(PROC));
  assert.equal(r.sourceFileCreated, false);
  assert.equal(r.sourceBytesWritten, 0);
  assert.equal(r.modelTurnStarts, 0);
  assert.equal(r.threadResumeRequests, 0);
});
