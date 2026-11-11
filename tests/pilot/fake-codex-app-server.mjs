// 시험용 가짜 Codex app-server(U3). 실제 Codex·대화 기록을 쓰지 않는다.
// 받은 thread/list 요청 값을 FAKE_CODEX_LOG 파일에 남기고, 업무 대화를 일부러 섞은 목록을 돌려준다(이어온이 다시 빼는지 보려고).
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const log = process.env.FAKE_CODEX_LOG;
const out = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (log) appendFileSync(log, JSON.stringify({ method: msg.method, params: msg.params ?? null }) + '\n');
  if (msg.method === 'initialize') out({ id: msg.id, result: { userAgent: 'fake' } });
  if (msg.method === 'thread/list') {
    out({ id: msg.id, result: { nextCursor: null, data: [
      { id: '01a1ca36-fa0f-7830-82bd-64e4d798fd2f', name: '결산 자동화', preview: '첫 질문', cwd: 'D:\\work\\closing', recencyAt: 1762800000 },
      { id: '01A0DADD-739F-74D2-93C5-9C405CC1019B', name: '업무 대화', cwd: 'D:\\secret', recencyAt: 1762800100 },
      { id: '01a18790-63c7-73e3-a60b-6ddb60fd5be8', name: null, preview: '  여러 줄\n미리보기   ', cwd: null, createdAt: 1762700000 },
      { id: 'not-a-uuid', name: '이상한 값' },
      { id: '11111111-2222-3333-4444-555555555555', name: '임시', ephemeral: true },
    ] } });
  }
});