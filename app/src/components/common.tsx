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

// RC1: 승인 카드 상태 글(서버 approvalState와 같은 이름). [카드 색, 글]
export function approvalResultText(state: string, exitCode?: number | null): [string, string] {
  const m: Record<string, [string, string]> = {
    approved: ["info", "승인됨 — 엔진에 전달하는 중"], running: ["info", "승인됨 — 실행 중"], completed: ["info", "실행 완료"],
    failed: ["err", "실행 실패" + (Number.isInteger(exitCode) ? `(종료 코드 ${exitCode})` : "")],
    unknown: ["warn", "결과 불명 — 원래 세션에서 확인하세요(다시 실행하지 않아요)"],
    denied: ["info", "거부함 — 실행하지 않았어요"], expired: ["info", "시간이 지나 거부됨"], turn_ended: ["info", "차례가 끝나 거부됨"],
    handoff_done: ["info", "사람이 직접 처리함"], handoff_dropped: ["info", "사람에게 넘겼고 하지 않기로 함"],
  };
  return m[state] ?? ["info", state];
}

export function CardView({ c, decide, review, who }: { c: Card; decide: (id: string, d: "allow" | "deny" | "done" | "drop") => void; review?: (id: string, executed: boolean) => void; who?: string }) {
  if (c.kind === "approval" && c.approvalId) {
    return (
      <div className="card warn">
        <b>{who ? who + " — " : ""}{c.n ? `승인 요청 ${c.n} · ` : ""}허락이 필요해요{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">폴더: {c.cwd}</small>}
        {c.expiresAt && <small className="muted">{new Date(c.expiresAt).toLocaleTimeString()}까지 정하지 않으면 거부돼요.</small>}
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "allow")}>허용</button><button onClick={() => decide(c.approvalId!, "deny")}>거부</button></div>
      </div>
    );
  }
  // RC5: 사람에게 넘긴 일 — AI에게는 하지 말라고 전함, 사람이 직접 처리했는지 기록
  if (c.kind === "handoff" && c.approvalId) {
    return (
      <div className="card warn">
        <b>{who ? who + " — " : ""}사람이 직접 할 일{c.n ? ` ${c.n}` : ""}{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">폴더: {c.cwd}</small>}
        <small className="muted">AI에게는 하지 말라고 답했어요. 필요하면 직접 처리한 뒤 기록하세요.</small>
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "done")}>직접 처리함</button><button onClick={() => decide(c.approvalId!, "drop")}>하지 않음</button></div>
      </div>
    );
  }
  // RC1: 결정한 뒤 — 승인됨 → 실행 중 → 완료/실패/결과 불명(버튼 없음)
  if (c.kind === "approval_result" && c.approvalId) {
    const [tone, text] = approvalResultText(c.state ?? "", c.exitCode);
    return (
      <div className={"card " + tone}>
        <b>{who ? who + " — " : ""}{c.n ? `승인 요청 ${c.n}` : "승인 요청"}{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}: {text}</b>
        {c.summary && <pre>{c.summary}</pre>}
        {c.cwd && <small className="muted">폴더: {c.cwd}</small>}
      </div>
    );
  }
  if (c.kind === "held" && c.requestId && review) {
    return (
      <div className="card warn">
        <b>확인이 필요한 질문</b>
        <p>{c.status === "unknown" ? "보낸 질문이 실행됐는지 알 수 없어요. 직접 확인한 뒤 알려 주세요." : "처리 중인 질문이 있어요."}</p>
        {c.resume && <p className="muted small">{c.resume.sameSession ? "그때 보낸 세션과 지금 이 대화의 세션이 같아요." : "⚠ 그때 보낸 세션과 지금 연결된 세션이 달라요 — 그때 세션을 열어 확인하세요."}{c.resume.historyKept ? "" : " 이어온 보관 기록은 그 뒤 지워졌어요."}</p>}
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
