// 여러 화면이 같이 쓰는 부품: 아바타, 카드(허락·확인 필요·상태), 오류 코드, 새 소식 구독 형태.
import { ApiError, type Card, type Conversation } from "../lib/api";
import type { ServerEvent } from "../lib/sse";
import { CARD_TEXT } from "../lib/texts";

export type OnEvent = (f: (e: ServerEvent) => void) => () => void;
export const BLOCKING = new Set(["hub_mode", "device_offline", "engine_off", "held", "archived"]);
export const APPROVAL_KIND: Record<string, string> = { command: " — 명령 실행", file: " — 파일 바꾸기", permissions: " — 권한 넓히기" }; // 서버 approvals.kind
export const codeOf = (e: unknown) => (e instanceof ApiError ? (e.status === 429 ? "rate_limited" : e.status === 401 ? "unauthorized" : e.code) : "network");

export function Avatar({ c, small }: { c?: Conversation; small?: boolean }) {
  const n = c ? c.staff?.name ?? c.label : "?";
  return <span className={"avatar" + (small ? " sm" : "")} aria-hidden>{c?.staff?.icon || n.slice(0, 1)}</span>;
}

export function CardView({ c, decide, review, who }: { c: Card; decide: (id: string, d: "allow" | "deny") => void; review?: (id: string, executed: boolean) => void; who?: string }) {
  if (c.kind === "approval" && c.approvalId) {
    return (
      <div className="card warn">
        <b>{who ? who + " — " : ""}허락이 필요해요{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">폴더: {c.cwd}</small>}
        {c.expiresAt && <small className="muted">{new Date(c.expiresAt).toLocaleTimeString()}까지 정하지 않으면 거부돼요.</small>}
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "allow")}>허용</button><button onClick={() => decide(c.approvalId!, "deny")}>거부</button></div>
      </div>
    );
  }
  if (c.kind === "held" && c.requestId && review) {
    return (
      <div className="card warn">
        <b>확인이 필요한 질문</b>
        <p>{c.status === "unknown" ? "보낸 질문이 실행됐는지 알 수 없어요. 직접 확인한 뒤 알려 주세요." : "처리 중인 질문이 있어요."}</p>
        {c.status === "unknown" && <div className="acts"><button onClick={() => review(c.requestId!, true)}>실행됐어요</button><button onClick={() => review(c.requestId!, false)}>실행되지 않았어요</button></div>}
      </div>
    );
  }
  const t = CARD_TEXT[c.kind];
  return t ? <div className="card info"><p>{t}</p></div> : null;
}

export function Composer({ value, onChange, onSubmit, disabled, placeholder, left }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean; placeholder: string; left?: React.ReactNode }) {
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim()) onSubmit(); }}>
      {left}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={1} maxLength={8000}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
      <button className="primary" disabled={disabled || !value.trim()}>보내기</button>
    </form>
  );
}
