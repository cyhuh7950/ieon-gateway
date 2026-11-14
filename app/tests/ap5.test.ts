import { describe, expect, it } from "vitest";
import { client } from "../src/lib/api";

describe("AP-5a 지우기", () => {
  it("이 기기 연결 끊기는 POST /v1/app/forget, 대화 보관 기록 지우기는 DELETE …/messages — 둘 다 열쇠로만", async () => {
    const seen: { u: string; m?: string; h: Record<string, string> }[] = [];
    const f = (async (u: string, init: RequestInit) => { seen.push({ u, m: init.method, h: init.headers as Record<string, string> }); return new Response(u.endsWith("/messages") ? null : JSON.stringify({ revoked: true }), { status: u.endsWith("/messages") ? 204 : 200 }); }) as any;
    const api = client({ server: "https://h", token: "T" }, f);
    await api.deleteMessages("c 1");
    await api.forget();
    expect(seen.map((s) => [s.m, s.u])).toEqual([["DELETE", "https://h/v1/conversations/c%201/messages"], ["POST", "https://h/v1/app/forget"]]);
    expect(seen.every((s) => s.h.authorization === "Bearer T")).toBe(true);
  });
});
