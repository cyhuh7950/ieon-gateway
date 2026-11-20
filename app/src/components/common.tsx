import { t } from "../lib/i18n";
// 여러 화면이 같이 쓰는 부품: 아바타, 카드(허락·확인 필요·상태), 오류 코드, 새 소식 구독 형태.
import { ApiError, type Card, type Conversation } from "../lib/api";
import type { ServerEvent } from "../lib/sse";
import { CARD_TEXT } from "../lib/texts";

export type OnEvent = (f: (e: ServerEvent) => void) => () => void;
export const BLOCKING = new Set(["hub_mode", "device_offline", "engine_off", "held", "archived"]);
export const APPROVAL_KIND: Record<string, string> = { command: t('app.common.13'), file: t('app.common.14'), permissions: t('app.common.15') }; // 서버 approvals.kind
export const codeOf = (e: unknown) => (e instanceof ApiError ? (e.status === 429 ? "rate_limited" : e.status === 401 ? "unauthorized" : e.code) : "network");

export function Avatar({ c, small }: { c?: Conversation; small?: boolean }) {
  const n = c ? c.staff?.name ?? c.label : "?";
  return <span className={"avatar" + (small ? " sm" : "")} aria-hidden>{c?.staff?.icon || n.slice(0, 1)}</span>;
}

// RC1: 승인 카드 상태 글(서버 approvalState와 같은 이름). [카드 색, 글]
export function approvalResultText(state: string, exitCode?: number | null): [string, string] {
  const m: Record<string, [string, string]> = {
    approved: ["info", t('app.common.16')], running: ["info", t('app.common.17')], completed: ["info", t('app.tasks.33')],
    failed: ["err", t('app.common.18', { exit_code: (Number.isInteger(exitCode) ? t('app.common.1', { exit_code: exitCode }) : "") })],
    unknown: ["warn", t('app.common.19')],
    denied: ["info", t('app.common.20')], expired: ["info", t('app.common.21')], turn_ended: ["info", t('app.common.22')],
    handoff_done: ["info", t('app.tasks.29')], handoff_dropped: ["info", t('app.common.23')],
  };
  return m[state] ?? ["info", state];
}

export function CardView({ c, decide, review, who }: { c: Card; decide: (id: string, d: "allow" | "deny" | "done" | "drop") => void; review?: (id: string, executed: boolean) => void; who?: string }) {
  if (c.kind === "approval" && c.approvalId) {
    return (
      <div className="card warn">
        <b>{t('app.common.3', { who: who ? who + " — " : "", v: c.n ? t('app.common.2', { v: c.n }) : "", approval_kind: APPROVAL_KIND[c.approvalKind ?? ""] ?? "" })}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">{t('app.common.4', { cwd: c.cwd })}</small>}
        {c.expiresAt && <small className="muted">{t('app.common.5', { to_locale_time_string: new Date(c.expiresAt).toLocaleTimeString() })}</small>}
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "allow")}>{t('app.common.6')}</button><button onClick={() => decide(c.approvalId!, "deny")}>{t('app.tasks.18')}</button></div>
      </div>
    );
  }
  // RC5: 사람에게 넘긴 일 — AI에게는 하지 말라고 전함, 사람이 직접 처리했는지 기록
  if (c.kind === "handoff" && c.approvalId) {
    return (
      <div className="card warn">
        <b>{t('app.common.7', { who: who ? who + " — " : "", misc: c.n ? ` ${c.n}` : "", approval_kind: APPROVAL_KIND[c.approvalKind ?? ""] ?? "" })}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">{t('app.common.4', { cwd: c.cwd })}</small>}
        <small className="muted">{t('app.common.8')}</small>
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "done")}>{t('app.tasks.16')}</button><button onClick={() => decide(c.approvalId!, "drop")}>{t('app.tasks.17')}</button></div>
      </div>
    );
  }
  // RC1: 결정한 뒤 — 승인됨 → 실행 중 → 완료/실패/결과 불명(버튼 없음)
  if (c.kind === "approval_result" && c.approvalId) {
    const [tone, text] = approvalResultText(c.state ?? "", c.exitCode);
    return (
      <div className={"card " + tone}>
        <b>{who ? who + " — " : ""}{c.n ? t('app.tasks.9', { v: c.n }) : t('app.tasks.50')}{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}: {text}</b>
        {c.summary && <pre>{c.summary}</pre>}
        {c.cwd && <small className="muted">{t('app.common.4', { cwd: c.cwd })}</small>}
      </div>
    );
  }
  if (c.kind === "held" && c.requestId && review) {
    return (
      <div className="card warn">
        <b>{t('app.common.9')}</b>
        <p>{c.status === "unknown" ? t('app.common.24') : t('app.common.25')}</p>
        {c.resume && <p className="muted small">{c.resume.sameSession ? t('app.common.26') : t('app.common.27')}{c.resume.historyKept ? "" : t('app.common.28')}</p>}
        {c.status === "unknown" && <div className="acts"><button onClick={() => review(c.requestId!, true)}>{t('app.common.10')}</button><button onClick={() => review(c.requestId!, false)}>{t('app.common.11')}</button></div>}
      </div>
    );
  }
  const tv = CARD_TEXT[c.kind];
  return tv ? <div className="card info"><p>{tv}</p></div> : null;
}

export function Composer({ value, onChange, onSubmit, disabled, placeholder, left }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean; placeholder: string; left?: React.ReactNode }) {
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim()) onSubmit(); }}>
      {left}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={1} maxLength={8000}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
      <button className="primary" disabled={disabled || !value.trim()}>{t('app.common.12')}</button>
    </form>
  );
}
