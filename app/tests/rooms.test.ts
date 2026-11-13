import { describe, expect, it } from "vitest";
import { client, type Conversation } from "../src/lib/api";
import { ROOM_BUSY, WAITING, addMention, mentionTargets, staffName } from "../src/lib/rooms";

const conv = (id: string, name: string | null, label = id): Conversation => ({ conversationId: id, label, engine: "codex_thread", deviceOnline: true, busy: false, attention: 0, staff: name ? { name, roleName: null, icon: null } : undefined });
const A = conv("c_a", "코덱스"); const B = conv("c_b", "Claude"); const C = conv("c_c", null, "문서 담당");

describe("@이름(서버 mentionsOf와 같은 규칙)", () => {
  it("이름이 없으면 대화 이름에서 빈칸을 뺀 이름", () => {
    expect(staffName(C)).toBe("문서담당");
    expect(staffName(undefined)).toBe("");
  });
  it("부른 사람만, 대소문자 무시, 중복 없이 — 아무도 안 부르면 대표", () => {
    expect(mentionTargets("@코덱스 @claude 같이 봐 줘 @코덱스", [A, B, C], "c_c")).toEqual(["c_a", "c_b"]);
    expect(mentionTargets("그냥 질문", [A, B, C], "c_c")).toEqual(["c_c"]);
    expect(mentionTargets("@없는사람 질문", [A, B], "c_a")).toEqual(["c_a"]);
    expect(mentionTargets("@문서담당 정리", [A, C], "c_a")).toEqual(["c_c"]);
  });
  it("@이름 붙이기: 끝에 한 칸 띄워 붙이고, 이미 있으면 그대로", () => {
    expect(addMention("", "코덱스")).toBe("@코덱스 ");
    expect(addMention("이거 봐 줘  ", "코덱스")).toBe("이거 봐 줘 @코덱스 ");
    expect(addMention("@코덱스 이거", "코덱스")).toBe("@코덱스 이거");
    expect(addMention("@코덱스2 이거", "코덱스")).toBe("@코덱스2 이거 @코덱스 ");
  });
  it("기다림 상태·사용 중 문구", () => {
    expect(WAITING.has("approval_required")).toBe(true);
    expect(WAITING.has("completed")).toBe(false);
    expect(ROOM_BUSY.conversation_busy).toContain("보내지 않았어요");
  });
});

describe("방·AI 직원 API", () => {
  it("방 글·다시 보내기·넘기기는 요청 열쇠와 함께, 방 만들기는 POST·고치기는 PUT, 이름 바꾸기는 지금 역할 유지", async () => {
    const seen: { u: string; m?: string; h: Record<string, string>; b: any }[] = [];
    const f = (async (u: string, init: RequestInit) => {
      seen.push({ u, m: init.method, h: init.headers as Record<string, string>, b: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(u.includes("/staff") ? { name: "새이름", icon: "🛠", roleName: null } : { posts: [{ postId: "p1" }], roomId: "room_1", rooms: [] }), { status: 200 });
    }) as any;
    const api = client({ server: "https://h", token: "T" }, f);
    await api.roomPost("room_1", "@코덱스 안녕", "app-k-0001");
    await api.roomRetry("room_1", "post_9", "app-k-0002");
    await api.roomHandoff("room_1", { requestId: "r1", to: "c_b", note: "" }, "app-k-0003");
    await api.saveRoom(null, { name: "팀", members: ["c_a"], lead: "c_a", guide: "" });
    await api.saveRoom("room_1", { name: "팀2", members: ["c_a"], lead: "c_a", guide: "" });
    await api.deleteRoom("room_1");
    await api.setStaff("c_a", { name: "새이름", icon: "🛠", roleId: "role_dev" });
    expect(seen.map((s) => [s.m ?? "GET", s.u.replace("https://h", "")])).toEqual([
      ["POST", "/v1/rooms/room_1/posts"], ["POST", "/v1/rooms/room_1/retry"], ["POST", "/v1/rooms/room_1/handoff"],
      ["POST", "/v1/rooms"], ["PUT", "/v1/rooms/room_1"], ["DELETE", "/v1/rooms/room_1"], ["PUT", "/v1/conversations/c_a/staff"]]);
    expect(seen.slice(0, 3).map((s) => s.h["idempotency-key"])).toEqual(["app-k-0001", "app-k-0002", "app-k-0003"]);
    expect(seen[1].b).toEqual({ postId: "post_9" });
    expect(seen[6].b).toEqual({ name: "새이름", icon: "🛠", roleId: "role_dev" });
  });
});
