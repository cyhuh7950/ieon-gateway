// 방에서 @이름 다루기(서버 mentionsOf와 같은 규칙: 이름은 글자·숫자·_·- 1~20자, 대소문자 무시). 아무도 안 부르면 대표가 답한다.
import type { Conversation } from "./api";

export const staffName = (c: Conversation | undefined) => (c ? c.staff?.name ?? String(c.label).replace(/\s+/g, "") : "");

export function mentionTargets(text: string, members: Conversation[], lead: string): string[] {
  const names = [...String(text).matchAll(/@([\p{L}\p{N}_-]{1,20})/gu)].map((m) => m[1].toLowerCase());
  const hit = [...new Set(names.flatMap((n) => members.filter((c) => staffName(c).toLowerCase() === n).map((c) => c.conversationId)))];
  return hit.length ? hit : [lead];
}

// 입력 끝에 @이름 붙이기(이미 있으면 그대로)
export function addMention(text: string, name: string): string {
  const tag = "@" + name;
  if (new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "iu").test(text)) return text;
  const t = text.replace(/\s+$/, "");
  return (t ? t + " " : "") + tag + " ";
}

export const WAITING = new Set(["queued", "dispatching", "running", "approval_required"]);

// 방에서 보내지 않은 이유(웹 화면 ROOM_BUSY와 같은 뜻)
export const ROOM_BUSY: Record<string, string> = {
  conversation_busy: "지금 다른 일 중이라 보내지 않았어요",
  device_unavailable: "PC 연결이 끊겨 보내지 않았어요",
  session_not_running: "Claude 세션이 꺼져 있어 보내지 않았어요",
  shared_server_down: "공유 서버가 꺼져 있어 보내지 않았어요",
  session_archived: "보관된 세션이라 보내지 않았어요",
  active_limit: "동시 처리 한도라 보내지 않았어요",
};

export const ROOM_ERR: Record<string, string> = {
  bad_room_name: "방 이름은 1~30자로 정하세요.",
  bad_members: "AI 직원을 1~10명 고르세요.",
  bad_lead: "대표는 고른 AI 직원 중에서 정하세요.",
  too_long: "공통 안내가 너무 길어요(1000자까지).",
  bad_handoff: "넘길 수 없어요(끝난 답만, 방의 다른 AI 직원에게만).",
  bad_retry: "다시 보낼 수 없는 글이에요.",
  bad_staff_name: "이름은 빈칸 없이 글자·숫자·_·- 1~20자로 정하세요(@이름으로 부를 수 있게).",
  staff_name_taken: "같은 이름의 AI 직원이 이미 있어요.",
  bad_icon: "아이콘은 이모지나 글자 하나로 정하세요.",
};
