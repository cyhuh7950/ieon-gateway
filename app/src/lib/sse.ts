// 새 소식(GET /v1/events, text/event-stream). EventSource는 Authorization 헤더를 못 보내므로 fetch 스트림으로 읽는다.
// 서버는 번호·상태만 보낸다(원문 없음) — 받은 번호로 다시 불러온다.
import type { Conn } from "./api";

export type ServerEvent = { event: string; data: any };

export class SseParser {
  private buf = "";
  push(text: string): ServerEvent[] {
    this.buf += text.replace(/\r\n/g, "\n");
    const out: ServerEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue; // 살아 있음 표시
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        const value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (!data.length) continue;
      try { out.push({ event, data: JSON.parse(data.join("\n")) }); } catch { /* 형식이 틀린 소식은 버린다 */ }
    }
    return out;
  }
}

// 끊기면 2·4·8…최대 30초 뒤 다시 붙는다. 401이면 멈추고 알린다(기기 열쇠가 끊김).
export function subscribe(conn: Conn, on: (e: ServerEvent) => void, opts: { onState?: (s: "open" | "retry" | "unauthorized") => void; f?: typeof fetch } = {}) {
  const f = opts.f ?? fetch;
  const ac = new AbortController();
  let wait = 2000;
  (async () => {
    while (!ac.signal.aborted) {
      try {
        const res = await f(conn.server + "/v1/events", { headers: { authorization: "Bearer " + conn.token, accept: "text/event-stream" }, signal: ac.signal });
        if (res.status === 401) { opts.onState?.("unauthorized"); return; }
        if (!res.ok || !res.body) throw new Error("sse_" + res.status);
        opts.onState?.("open");
        wait = 2000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        const p = new SseParser();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const e of p.push(dec.decode(value, { stream: true }))) on(e);
        }
      } catch {
        if (ac.signal.aborted) return;
      }
      opts.onState?.("retry");
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  })();
  return () => ac.abort();
}
