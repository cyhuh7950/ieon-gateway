// 이어온 서버 API(설명서 API_GUIDE 7-1). 앱 열쇠는 Authorization: Bearer로만 보낸다(쿠키 없음).
export type Conn = { server: string; token: string; deviceId?: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

type Fetch = typeof fetch;

// "ieun-gateway.sinsan.kr", "https://…/", "http://100.x.y.z:28760/settings" → 출처(origin)만
export function normalizeServer(input: string): string | null {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const cleanCode = (s: string) => String(s ?? "").replace(/\D/g, "").slice(0, 8);

// 같은 질문을 두 번 보내지 않게 하는 요청 열쇠(서버 규칙: [\w-]{8,64})
export function newKey(): string {
  const r = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return ("app-" + r).replace(/[^\w-]/g, "").slice(0, 64);
}

async function body(res: Response): Promise<any> {
  if (res.status === 204) return null;
  return res.json().catch(() => ({}));
}

export async function pair(server: string, code: string, name: string, f: Fetch = fetch): Promise<Conn> {
  let res: Response;
  try {
    res = await f(server + "/v1/app/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: cleanCode(code), name }) });
  } catch {
    throw new ApiError(0, "network");
  }
  const b = await body(res);
  if (res.status !== 201 || typeof b?.token !== "string") throw new ApiError(res.status, b?.error ?? "pair_failed");
  return { server, token: b.token, deviceId: b.deviceId };
}

export type Staff = { name: string; roleName: string | null; icon: string | null };
export type Conversation = {
  conversationId: string; label: string; engine: string; deviceOnline: boolean; busy: boolean;
  attention: number; staff?: Staff; workMode?: boolean; heldBy?: { requestId: string; status: string } | null;
  host?: { id: string; name: string };
};
export type Card = { kind: string; approvalId?: string; approvalKind?: string; summary?: string; cwd?: string; expiresAt?: string; requestId?: string; status?: string; errorCode?: string | null; engine?: string };
export type Message = { requestId: string; question: string; answer: string };
export type RequestView = { requestId: string; status: string; errorCode: string | null; answer: string | null };

export function client(conn: Conn, f: Fetch = fetch) {
  const call = async (path: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await f(conn.server + path, { ...init, headers: { authorization: "Bearer " + conn.token, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });
    } catch {
      throw new ApiError(0, "network");
    }
    const b = await body(res);
    if (res.status >= 400) throw new ApiError(res.status, b?.error ?? "http_" + res.status);
    return b;
  };
  return {
    conversations: async (): Promise<{ conversations: Conversation[]; hubMode?: boolean }> => call("/v1/conversations"),
    cards: async (id: string): Promise<Card[]> => (await call(`/v1/conversations/${encodeURIComponent(id)}/cards`)).cards ?? [],
    messages: async (id: string): Promise<Message[]> => (await call(`/v1/conversations/${encodeURIComponent(id)}/messages`)).messages ?? [],
    ask: async (id: string, question: string, key: string): Promise<string> =>
      (await call(`/v1/conversations/${encodeURIComponent(id)}/requests`, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ question }) })).requestId,
    request: async (requestId: string): Promise<RequestView> => call(`/v1/requests/${encodeURIComponent(requestId)}`),
    decide: async (approvalId: string, decision: "allow" | "deny"): Promise<string> =>
      (await call(`/v1/approvals/${encodeURIComponent(approvalId)}`, { method: "POST", body: JSON.stringify({ decision }) })).status,
    review: async (requestId: string, executed: boolean) => call(`/v1/requests/${encodeURIComponent(requestId)}/review`, { method: "POST", body: JSON.stringify({ executed }) }),
  };
}
export type Client = ReturnType<typeof client>;

// 보내지 않은 것이 확실한 실패만 "다시 보내기"를 보여 준다(결과 불명은 자동·수동 재전송 대상이 아님 — 확인 카드로).
export const RETRYABLE = new Set(["desktop_holds_thread", "thread_busy", "conversation_busy", "active_limit", "usage_limit", "device_unavailable",
  "session_not_running", "shared_server_down", "account_not_logged_in", "session_in_use", "network"]);
