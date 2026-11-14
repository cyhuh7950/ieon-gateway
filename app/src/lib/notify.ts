// AP-4a 알림: 새 소식(번호·상태만)으로 "○○가 답했어요"만 만든다 — 질문·답 원문은 넣지 않는다(APP_AP4_PLAN 1절).
export type NotifyEvent = { event: string; data: { conversationId?: string; requestId?: string; approvalId?: string; status?: string } };
export type Note = { title: string; body: string; conversationId: string; tag: string };

// 이름 뒤 "이/가": 끝 글자가 받침 있는 한글이면 "이", 그 밖(받침 없음·영문·숫자)은 "가"
export function iga(name: string): string {
  const c = name.charCodeAt(name.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? name + "이" : name + "가";
}

export function noteFor(e: NotifyEvent, nameOf: (conversationId: string) => string): Note | null {
  const d = e.data ?? {};
  if (!d.conversationId) return null;
  const who = nameOf(d.conversationId) || "AI 직원";
  if (e.event === "request" && d.requestId) {
    if (d.status === "completed") return { title: "이어온", body: `${iga(who)} 답했어요`, conversationId: d.conversationId, tag: "r:" + d.requestId };
    if (d.status === "failed") return { title: "이어온", body: `${who}에게 보내지 못했어요`, conversationId: d.conversationId, tag: "r:" + d.requestId };
    if (d.status === "unknown") return { title: "이어온", body: `${who} — 확인이 필요해요`, conversationId: d.conversationId, tag: "r:" + d.requestId };
    return null; // 접수(queued)는 내가 보낸 것이라 알리지 않음
  }
  if (e.event === "approval" && d.approvalId && d.status === "pending") return { title: "이어온", body: `${iga(who)} 허락을 기다려요`, conversationId: d.conversationId, tag: "a:" + d.approvalId };
  return null;
}

// 이 기기 알림 켜기(기본: PC 앱 켜짐, 그 밖은 꺼짐 — 브라우저는 사용자가 켤 때 허용을 물음)
const KEY = "ieon.notify.v1";
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export const notifyOn = (desktop: boolean) => { const v = ls()?.getItem(KEY); return v === null || v === undefined ? desktop : v === "1"; };
export const setNotifyOn = (on: boolean) => ls()?.setItem(KEY, on ? "1" : "0");
