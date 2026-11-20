import { t } from "./i18n";
// AP-4a 알림: 새 소식(번호·상태만)으로 "○○가 답했어요"만 만든다 — 질문·답 원문은 넣지 않는다(APP_AP4_PLAN 1절).
export type NotifyEvent = { event: string; data: { conversationId?: string; requestId?: string; approvalId?: string; status?: string } };
export type Note = { title: string; body: string; conversationId: string; tag: string };

// 이름 뒤 "이/가": 끝 글자가 받침 있는 한글이면 "이", 그 밖(받침 없음·영문·숫자)은 "가"
export function iga(name: string): string {
  return t('app.notify.5', { name }); // 이름 뒤 조사(사전의 {name|이가})
}

export function noteFor(e: NotifyEvent, nameOf: (conversationId: string) => string): Note | null {
  const d = e.data ?? {};
  if (!d.conversationId) return null;
  const who = nameOf(d.conversationId) || t('app.notify.7');
  if (e.event === "request" && d.requestId) {
    if (d.status === "completed") return { title: t('common.product'), body: t('app.notify.1', { who }), conversationId: d.conversationId, tag: "r:" + d.requestId };
    if (d.status === "failed") return { title: t('common.product'), body: t('app.notify.2', { who }), conversationId: d.conversationId, tag: "r:" + d.requestId };
    if (d.status === "unknown") return { title: t('common.product'), body: t('app.notify.3', { who }), conversationId: d.conversationId, tag: "r:" + d.requestId };
    return null; // 접수(queued)는 내가 보낸 것이라 알리지 않음
  }
  if (e.event === "approval" && d.approvalId && d.status === "pending") return { title: t('common.product'), body: t('app.notify.4', { who }), conversationId: d.conversationId, tag: "a:" + d.approvalId };
  return null;
}

// 이 기기 알림 켜기(기본: PC 앱 켜짐, 그 밖은 꺼짐 — 브라우저는 사용자가 켤 때 허용을 물음)
const KEY = "ieon.notify.v1";
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export const notifyOn = (desktop: boolean) => { const v = ls()?.getItem(KEY); return v === null || v === undefined ? desktop : v === "1"; };
export const setNotifyOn = (on: boolean) => ls()?.setItem(KEY, on ? "1" : "0");
