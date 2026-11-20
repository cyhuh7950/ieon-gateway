import { t } from "./i18n";
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
  const tv = text.replace(/\s+$/, "");
  return (tv ? tv + " " : "") + tag + " ";
}

export const WAITING = new Set(["queued", "dispatching", "running", "approval_required"]);

// 방에서 보내지 않은 이유(웹 화면 ROOM_BUSY와 같은 뜻)
export const ROOM_BUSY: Record<string, string> = {
  conversation_busy: t('app.rooms.1'),
  host_busy: t('app.rooms.2'),
  device_unavailable: t('app.rooms.3'),
  session_not_running: t('app.rooms.4'),
  shared_server_down: t('app.rooms.5'),
  session_archived: t('app.rooms.6'),
  active_limit: t('app.rooms.7'),
};

export const ROOM_ERR: Record<string, string> = {
  bad_room_name: t('app.rooms.8'),
  bad_members: t('app.rooms.9'),
  bad_lead: t('app.rooms.10'),
  too_long: t('app.rooms.11'),
  bad_handoff: t('app.rooms.12'),
  bad_retry: t('app.rooms.13'),
  bad_staff_name: t('app.rooms.14'),
  staff_name_taken: t('app.rooms.15'),
  bad_icon: t('app.rooms.16'),
};
