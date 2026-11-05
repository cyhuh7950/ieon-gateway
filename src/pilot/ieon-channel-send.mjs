// C1: 이어온 채널에 질문 1개를 넣고 reply를 기다린다. 재전송 없음.
// 사용: node src/pilot/ieon-channel-send.mjs <receiptPath> "<질문>"
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = `http://127.0.0.1:${process.env.IEON_CHANNEL_PORT ?? 28762}`;
const WAIT_MS = 180000;
const [receiptPath, question] = process.argv.slice(2);
if (!receiptPath || !question) throw new Error('usage: <receiptPath> "<question>"');

const token = readFileSync(new URL('../../.local/c1/token', import.meta.url), 'utf8').trim();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const requestId = randomUUID();
const receipt = {
  requestId, atUtc: new Date().toISOString(), endpoint: BASE, sendAttempts: 0, retries: 0,
  postStatus: null, outcome: null, replyCount: 0, waitedMs: 0, errorKind: null, answerStored: false,
};
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

let answer = '';
const started = Date.now();
try {
  receipt.sendAttempts = 1;
  const post = await fetch(`${BASE}/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ request_id: requestId, text: question }) });
  receipt.postStatus = post.status;
  if (post.status !== 202) {
    receipt.outcome = 'NOT_DELIVERED';
  } else {
    while (Date.now() - started < WAIT_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`${BASE}/v1/replies?request_id=${requestId}`, { headers });
      const { replies = [] } = await r.json();
      if (replies.length) { receipt.replyCount = replies.length; answer = replies.map((x) => x.text).join('\n'); break; }
    }
    receipt.outcome = receipt.replyCount ? 'REPLIED' : 'UNKNOWN_NO_REPLY';
  }
} catch (error) {
  receipt.errorKind = error.cause?.code ?? String(error.message).slice(0, 120);
  receipt.outcome = receipt.postStatus === 202 ? 'UNKNOWN' : 'DEVICE_UNAVAILABLE';
}
receipt.waitedMs = Date.now() - started;
save();
console.log(JSON.stringify(receipt, null, 2));
// 시험용 답변만 확인용으로 출력한다. receipt에는 저장하지 않는다.
console.log('--- answer (not stored) ---');
console.log(answer);
