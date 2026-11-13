import { describe, expect, it } from "vitest";
import { ApiError, RETRYABLE, cleanCode, client, newKey, normalizeServer, pair } from "../src/lib/api";
import { SseParser, subscribe } from "../src/lib/sse";
import { CARD_TEXT, errText } from "../src/lib/texts";

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("서버 주소·코드", () => {
  it("주소는 출처(origin)만, 기본 https, http(PC형 Tailscale)도 허용, 다른 scheme 거절", () => {
    expect(normalizeServer("ieun-gateway.sinsan.kr")).toBe("https://ieun-gateway.sinsan.kr");
    expect(normalizeServer(" https://ieun-gateway.sinsan.kr/settings#x ")).toBe("https://ieun-gateway.sinsan.kr");
    expect(normalizeServer("http://100.64.1.2:28760/")).toBe("http://100.64.1.2:28760");
    expect(normalizeServer("javascript:alert(1)")).toBeNull();
    expect(normalizeServer("ftp://x")).toBeNull();
    expect(normalizeServer("")).toBeNull();
  });
  it("코드는 숫자 8자리만, 요청 열쇠는 서버 규칙([\\w-]{8,64})", () => {
    expect(cleanCode("1234 5678 9")).toBe("12345678");
    for (let i = 0; i < 20; i++) expect(newKey()).toMatch(/^[\w-]{8,64}$/);
    expect(newKey()).not.toBe(newKey());
  });
});

describe("API", () => {
  it("연결: 코드·이름을 보내고 열쇠를 받음, 틀린 코드는 bad_code", async () => {
    const calls: any[] = [];
    const ok = await pair("https://h", "1234-5678", "폰", (async (u: string, init: RequestInit) => { calls.push([u, JSON.parse(String(init.body))]); return res(201, { token: "t".repeat(64), deviceId: "ad_1" }); }) as any);
    expect(calls[0]).toEqual(["https://h/v1/app/pair", { code: "12345678", name: "폰" }]);
    expect(ok).toEqual({ server: "https://h", token: "t".repeat(64), deviceId: "ad_1" });
    await expect(pair("https://h", "00000000", "폰", (async () => res(403, { error: "bad_code" })) as any)).rejects.toMatchObject({ status: 403, code: "bad_code" });
    await expect(pair("https://h", "00000000", "폰", (async () => { throw new TypeError("x"); }) as any)).rejects.toMatchObject({ code: "network" });
  });
  it("열쇠는 Authorization: Bearer로만, 질문은 요청 열쇠와 함께, 오류는 서버 코드 그대로", async () => {
    const seen: any[] = [];
    const f = (async (u: string, init: RequestInit) => {
      seen.push({ u, init });
      if (u.endsWith("/requests")) return res(202, { requestId: "r1" });
      if (u.endsWith("/cards")) return res(409, { error: "hub_mode" });
      return res(200, { conversations: [] });
    }) as any;
    const api = client({ server: "https://h", token: "TOK" }, f);
    expect(await api.ask("c1", "안녕", "app-key-0001")).toBe("r1");
    const h = seen[0].init.headers;
    expect(h.authorization).toBe("Bearer TOK");
    expect(h["idempotency-key"]).toBe("app-key-0001");
    expect(seen[0].init.credentials).toBeUndefined();
    await expect(api.cards("c1")).rejects.toBeInstanceOf(ApiError);
    await expect(api.cards("c1")).rejects.toMatchObject({ code: "hub_mode" });
  });
  it("다시 보내기는 보내지 않은 것이 확실한 실패만(결과 불명 session_changed는 아님)", () => {
    expect(RETRYABLE.has("desktop_holds_thread")).toBe(true);
    expect(RETRYABLE.has("session_in_use")).toBe(true);
    expect(RETRYABLE.has("session_changed")).toBe(false);
    expect(RETRYABLE.has("session_load_failed")).toBe(false);
  });
  it("문구: 아는 코드는 설명, 모르는 코드는 코드 그대로, 상태 카드 문구", () => {
    expect(errText("hub_mode")).toContain("허브");
    expect(errText("zzz")).toContain("zzz");
    expect(CARD_TEXT.device_offline).toContain("PC");
  });
});

describe("새 소식(SSE)", () => {
  it("조각난 스트림·keepalive·CRLF를 이벤트로 묶음, 틀린 JSON은 버림", () => {
    const p = new SseParser();
    expect(p.push(": ok\n\nevent: requ")).toEqual([]);
    const a = p.push('est\ndata: {"conversationId":"c1","requestId":"r1","status":"queued"}\n\n: keepalive\n\n');
    expect(a).toEqual([{ event: "request", data: { conversationId: "c1", requestId: "r1", status: "queued" } }]);
    expect(p.push('event: approval\r\ndata: {"approvalId":"apv_1","status":"pending"}\r\n\r\nevent: x\ndata: {bad\n\n')).toEqual([{ event: "approval", data: { approvalId: "apv_1", status: "pending" } }]);
  });
  it("열쇠를 헤더로 보내고, 401이면 멈춤(다시 붙지 않음)", async () => {
    let n = 0; let auth = "";
    const states: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { n++; auth = (init.headers as any).authorization; return new Response(null, { status: 401 }); }) as any;
    subscribe({ server: "https://h", token: "TOK" }, () => {}, { f, onState: (s) => states.push(s) });
    await new Promise((r) => setTimeout(r, 50));
    expect(auth).toBe("Bearer TOK");
    expect(states).toEqual(["unauthorized"]);
    expect(n).toBe(1);
  });
  it("스트림으로 온 이벤트를 넘겨 줌, 끊으면 멈춤", async () => {
    const got: any[] = [];
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: request\ndata: {"requestId":"r9","status":"completed"}\n\n')); } });
    const stop = subscribe({ server: "https://h", token: "T" }, (e) => got.push(e), { f: (async () => new Response(body, { status: 200 })) as any });
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(got).toEqual([{ event: "request", data: { requestId: "r9", status: "completed" } }]);
  });
});
