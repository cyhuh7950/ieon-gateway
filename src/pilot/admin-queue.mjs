// A2-d: 허브 → PC 기기 관리 명령 대기열(메모리). PC가 먼저 연결하는 구조를 그대로 쓴다 — 허브는 PC로 접속하지 않고,
// PC(허브에 연결된 이어온 서버)가 2초마다 가져가 실행한 뒤 결과를 보낸다. 허브 화면 요청은 결과를 기다렸다가 돌려준다.
// 시간 안에 PC가 가져가지 않으면 명령을 지우고 "PC가 응답하지 않음", 가져간 뒤 결과가 없으면 "결과 확인 안 됨"으로 알린다(다시 보내지 않음).
import { randomUUID } from 'node:crypto';

export function createAdminQueue({ timeoutMs = 25_000 } = {}) {
  const queues = new Map(); // hostId → [{ id, op, args, taken, finish }]
  const list = (h) => { if (!queues.has(h)) queues.set(h, []); return queues.get(h); };
  return {
    send(hostId, op, args, ms = timeoutMs) { // ms: 오래 걸리는 명령(Codex 대화 목록)만 따로
      return new Promise((resolve) => {
        const q = list(hostId);
        if (q.length >= 10) return resolve({ status: 429, body: { error: 'device_admin_busy' } });
        const cmd = { id: randomUUID(), op, args, taken: false };
        const timer = setTimeout(() => {
          const i = q.indexOf(cmd); if (i >= 0) q.splice(i, 1);
          resolve({ status: 504, body: { error: cmd.taken ? 'device_admin_unknown' : 'device_no_response' } });
        }, ms);
        timer.unref?.();
        cmd.finish = (r) => { clearTimeout(timer); const i = q.indexOf(cmd); if (i >= 0) q.splice(i, 1); resolve(r); };
        q.push(cmd);
      });
    },
    take(hostId) {
      const cmd = list(hostId).find((c) => !c.taken);
      if (!cmd) return null;
      cmd.taken = true;
      return { id: cmd.id, op: cmd.op, args: cmd.args };
    },
    // 그 PC가 가져간 명령의 결과만 받는다(다른 PC가 남의 명령 결과를 보내지 못하게).
    done(hostId, id, result) {
      const cmd = list(hostId).find((c) => c.id === id && c.taken);
      if (!cmd) return false;
      cmd.finish(result);
      return true;
    },
  };
}
