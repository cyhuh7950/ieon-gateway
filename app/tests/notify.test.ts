import { describe, expect, it } from "vitest";
import { iga, noteFor } from "../src/lib/notify";

const names = (id: string) => ({ c1: "코덱스" } as Record<string, string>)[id] ?? "";

describe("알림 글(원문 없이)", () => {
  it("이름 뒤 이/가", () => {
    expect(iga("문서담당")).toBe("문서담당이"); expect(iga("코덱스")).toBe("코덱스가"); expect(iga("Claude")).toBe("Claude가"); expect(iga("AI 직원")).toBe("AI 직원이");
  });
  it("답·실패·확인 필요·허락 대기만 알리고, 접수(queued)·결정된 허락은 알리지 않음", () => {
    expect(noteFor({ event: "request", data: { conversationId: "c1", requestId: "r1", status: "completed" } }, names)).toEqual({ title: "이어온", body: "코덱스가 답했어요", conversationId: "c1", tag: "r:r1" });
    expect(noteFor({ event: "request", data: { conversationId: "c1", requestId: "r1", status: "failed" } }, names)?.body).toBe("코덱스에게 보내지 못했어요");
    expect(noteFor({ event: "request", data: { conversationId: "c1", requestId: "r1", status: "unknown" } }, names)?.body).toBe("코덱스 — 확인이 필요해요");
    expect(noteFor({ event: "approval", data: { conversationId: "c1", approvalId: "apv_1", status: "pending" } }, names)?.body).toBe("코덱스가 허락을 기다려요");
    expect(noteFor({ event: "request", data: { conversationId: "c1", requestId: "r1", status: "queued" } }, names)).toBeNull();
    expect(noteFor({ event: "approval", data: { conversationId: "c1", approvalId: "apv_1", status: "allowed" } }, names)).toBeNull();
  });
  it("이름을 모르면 'AI 직원', 대화 번호가 없으면 알리지 않음, 글에는 이름과 정해진 말만", () => {
    expect(noteFor({ event: "request", data: { conversationId: "zz", requestId: "r2", status: "completed" } }, names)?.body).toBe("AI 직원이 답했어요");
    expect(noteFor({ event: "request", data: { requestId: "r2", status: "completed" } }, names)).toBeNull();
    const n = noteFor({ event: "request", data: { conversationId: "c1", requestId: "r3", status: "completed", answer: "비밀 답" } as any }, names)!;
    expect(JSON.stringify(n)).not.toContain("비밀");
  });
});
