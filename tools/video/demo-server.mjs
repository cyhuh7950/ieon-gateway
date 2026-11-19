// 소개·사용법 동영상용 가짜 서버(모델 0): 127.0.0.1:28799. 가짜 PC가 미리 써 둔 예시 답을 돌려준다.
// 실제 업무 대화·열쇠·개인 정보는 쓰지 않는다. 사용: node tools/video/demo-server.mjs  → 첫 줄에 {"base","code"} 출력
// VIDEO_SET=usage: 사용법 영상용 — 꺼진 PC의 대화 하나를 더하고(상태 카드 장면), 작업 모드 대화는 허락 카드를 올린다.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const d = mkdtempSync(join(tmpdir(), 'ieon-video-'));
const USAGE = process.env.VIDEO_SET === 'usage';
// 2026-11-20 새 화면: 사용 방식(mode.json)이 없으면 "사용 방식을 정해 주세요" 줄이, 기기 설정이 없으면 AI 응답 스위치가 꺼진 듯 보인다 — 가짜 값을 둔다.
writeFileSync(join(d, 'mode.json'), JSON.stringify({ mode: 'pc' }));
const S = { work: '01a18790-0000-7000-8000-0000000000a1', law: 'video-law-session', tax: '01a18790-0000-7000-8000-0000000000a3', ins: '01a18790-0000-7000-8000-0000000000a4' };
writeFileSync(join(d, 'connector.json'), JSON.stringify({ live: true, codex: { allowlist: [S.work, S.tax, S.ins] }, claude: { baseUrl: 'http://127.0.0.1:9' } }));
const app = createApp({ dbPath: join(d, 'p.db'), sseKeepaliveMs: 10000, connectorConfigPath: join(d, 'connector.json'),
  users: [{ tokenSha256: sha('web-video'), userId: 'u_demo', appId: 'app_web' }],
  devices: [{ tokenSha256: sha('dev-video'), hostId: 'h_home' }],
  bindings: [
    { conversationId: 'c_work', ownerUserId: 'u_demo', appIds: ['app_web'], hostId: 'h_home', engine: 'codex_thread', sessionRef: S.work, label: '결제 모듈 작업' },
    { conversationId: 'c_law', ownerUserId: 'u_demo', appIds: ['app_web'], hostId: 'h_home', engine: 'claude_channel', sessionRef: S.law, label: '법률 상담' },
    { conversationId: 'c_tax', ownerUserId: 'u_demo', appIds: ['app_web'], hostId: 'h_home', engine: 'codex_thread', sessionRef: S.tax, label: '세무 상담' },
    { conversationId: 'c_ins', ownerUserId: 'u_demo', appIds: ['app_web'], hostId: 'h_home', engine: 'codex_thread', sessionRef: S.ins, label: '보험 상담' },
    // 사용법 영상: 꺼진 회사 PC(접속하지 않는 가짜 기기)
    ...(USAGE ? [{ conversationId: 'c_office', ownerUserId: 'u_demo', appIds: ['app_web'], hostId: 'h_office', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-0000000000a5', label: '회사 PC 작업' }] : []),
  ] });
const port = await app.listen(Number(process.env.VIDEO_PORT || 28799));
const base = `http://127.0.0.1:${port}`;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const put = (p, b) => fetch(base + p, { method: 'PUT', headers: H('web-video'), body: JSON.stringify(b) });
await put('/v1/conversations/c_work/staff', { name: '코덱스', icon: '🛠' });
await put('/v1/conversations/c_law/staff', { name: '법률봇', icon: '⚖️' });
await put('/v1/conversations/c_tax/staff', { name: '세무봇', icon: '🧾' });
await put('/v1/conversations/c_ins/staff', { name: '보험봇', icon: '🛡️' });
if (USAGE) await put('/v1/conversations/c_office/staff', { name: '회사봇', icon: '🏢' });

// 미리 써 둔 예시 답(참고용). 세션별·질문 낱말별.
const ANSWERS = [
  [S.work, '어디까지', '어제는 결제 모듈 리팩터링을 마쳤고, 테스트 12개 중 10개가 통과했어요. 남은 2개는 환불 처리 부분이라 지금 이어서 고치겠습니다.'],
  [S.work, '환불', '환불 처리 테스트 2개를 고쳐서, 이제 12개 모두 통과해요.'],
  [S.work, '', '네, 이어서 진행할게요.'],
  [S.law, '전세', '전세 계약을 갱신할 때는 ① 계약갱신요구권(한 번, 2년)을 만료 6개월~2개월 전에 행사할 수 있고 ② 보증금 증액은 5% 안에서만 가능하며 ③ 확정일자와 전입신고를 유지해야 합니다. (참고용 답변)'],
  [S.law, '상속', '상속받은 집은 ① 상속인과 지분을 정하고(협의분할) ② 상속 등기를 마쳐야 합니다. 빚이 걱정되면 상속을 안 날부터 3개월 안에 한정승인이나 포기를 정해야 해요. (참고용 답변)'],
  [S.tax, '상속', '상속세는 상속이 시작된 달의 말일부터 6개월 안에 신고합니다. 일괄공제 5억 원과 배우자 공제를 먼저 따져 보세요. (참고용 답변)'],
  [S.ins, '', '상속받은 집은 화재보험 명의를 새 소유자로 바꾸고, 기존 계약을 이어받을지 해지할지 정하세요. 빈집이면 보장이 달라질 수 있어요. (참고용 답변)'],
];
const answerFor = (sessionRef, q) => (ANSWERS.find(([s, k]) => s === sessionRef && (!k || q.includes(k))) ?? [0, 0, '네, 알겠습니다.'])[2];

// 지난 기록 하나(2-5 화면에서 "하던 대화"로 보이게) — 가짜 PC가 먼저 한 번 접속해야 받아 준다
await fetch(base + '/v1/device/jobs', { headers: { ...H('dev-video'), 'x-ieon-health': JSON.stringify({ codexShared: 'false', claudeChannel: 'up' }) } });
const seed = await fetch(base + '/v1/conversations/c_work/requests', { method: 'POST', headers: { ...H('web-video'), 'idempotency-key': 'video-seed-0001' }, body: JSON.stringify({ question: '결제 모듈 리팩터링 시작해 줘. 테스트도 같이 돌려 줘.' }) });
const code = (await (await fetch(base + '/v1/admin/app-devices/code', { method: 'POST', headers: H('web-video'), body: '{}' })).json()).code;
console.log(JSON.stringify({ base, code, seeded: seed.status }));

const health = JSON.stringify({ codexShared: 'false', claudeChannel: 'up' });
const dev = (p, o = {}) => fetch(base + p, { ...o, headers: { ...H('dev-video'), 'x-ieon-health': health } });
// 작업 모드 대화: 실행 전에 허락 카드를 올리고, 사람이 정할 때까지 기다린다(실제로는 아무것도 실행하지 않음)
async function workJob(job) {
  const r = await dev('/v1/device/approvals', { method: 'POST', body: JSON.stringify({ requestId: job.requestId, kind: 'command', summary: 'npm test -- refund', cwd: 'D:\\work\\payment' }) });
  if (r.status !== 201) return '네, 알겠습니다.';
  const { approvalId } = await r.json();
  for (let i = 0; i < 1200; i++) {
    await new Promise((ok) => setTimeout(ok, 700));
    const st = (await (await dev('/v1/device/approvals/' + approvalId)).json()).status;
    if (st === 'allowed') {
      await new Promise((ok) => setTimeout(ok, 1200));
      await dev(`/v1/device/approvals/${approvalId}/result`, { method: 'POST', body: JSON.stringify({ outcome: 'completed', exitCode: 0 }) });
      return '테스트를 실행했어요. 환불 테스트 2개를 포함해 12개 모두 통과했습니다.';
    }
    if (st !== 'pending') return '알겠어요. 실행하지 않았어요.';
  }
  return '알겠어요. 실행하지 않았어요.';
}
for (;;) {
  try {
    const r = await fetch(base + '/v1/device/jobs', { headers: { ...H('dev-video'), 'x-ieon-health': health } });
    if (r.status === 200) {
      const job = await r.json();
      const q = String(job.question ?? '');
      await new Promise((ok) => setTimeout(ok, Number(process.env.VIDEO_DELAY_MS || 1800)));
      const answer = q.includes('리팩터링 시작') ? '리팩터링을 시작했어요. 결제 승인·취소 흐름부터 정리하고 테스트를 돌리겠습니다.' : job.workMode ? await workJob(job) : answerFor(job.sessionRef, q);
      await fetch(base + `/v1/device/jobs/${job.requestId}/result`, { method: 'POST', headers: H('dev-video'), body: JSON.stringify({ status: 'completed', answer }) });
    }
  } catch (e) { console.error('demo device', e.message); }
  await new Promise((ok) => setTimeout(ok, 700));
}
