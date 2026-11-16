// RC3 작업 화면: 질문(작업) 하나하나의 진행·승인 대기·결과를 모아 보고, 여기서 바로 허용·거부·중지(웹 작업 서랍과 같은 내용).
import { useCallback, useEffect, useState } from "react";
import type { Client, PendingApproval, Task, TaskDetail } from "../lib/api";
import { codeOf, type OnEvent } from "./common";
import { errText } from "../lib/texts";

export const TSTATE: Record<string, string> = { queued: "기다리는 중", dispatching: "보내는 중", running: "실행 중", completed: "완료", failed: "실패", cancelled: "중지됨", unknown: "확인 필요", approval_required: "권한 확인 대기" };
export const ASTATE: Record<string, string> = { pending: "승인 대기", approved: "승인됨", running: "실행 중", completed: "실행 완료", failed: "실행 실패", unknown: "결과 불명", denied: "거부함", expired: "시간 지남(거부)", turn_ended: "차례 끝(거부)" };
const AKIND: Record<string, string> = { command: "명령 실행", file: "파일 수정", permissions: "권한 추가" };
const when = (s: string | null) => (s ? new Date(s).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const taskState = (t: Pick<Task, "status" | "stopRequested">) => (t.stopRequested && ["dispatching", "running"].includes(t.status) ? "멈추는 중" : TSTATE[t.status] ?? t.status);

export function TasksScreen({ api, onBack, onOpenConv, onEvent, onLost }: { api: Client; onBack: () => void; onOpenConv: (conversationId: string) => void; onEvent: OnEvent; onLost: () => void }) {
  const [aps, setAps] = useState<PendingApproval[] | null>(null);
  const [active, setActive] = useState<Task[]>([]);
  const [recent, setRecent] = useState<Task[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [note, setNote] = useState("");
  const fail = useCallback((x: unknown) => { const c = codeOf(x); if (c === "unauthorized") onLost(); else setNote(errText(c)); }, [onLost]);
  const load = useCallback(async () => {
    try {
      const [a, act, all] = await Promise.all([api.pendingApprovals(), api.tasks("active"), api.tasks("all")]);
      setAps(a); setActive(act); setRecent(all.filter((t) => !act.some((x) => x.requestId === t.requestId)));
    } catch (x) { fail(x); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onEvent(() => load()), [onEvent, load]);
  useEffect(() => { if (!active.length && !(aps ?? []).length) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [active.length, aps, load]);
  const show = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail(await api.task(id)); } catch (x) { fail(x); }
  };
  const decide = async (id: string, d: "allow" | "deny") => { try { await api.decide(id, d); } catch (x) { fail(x); } load(); };
  const stop = async (id: string) => {
    try { await api.stop(id); } catch (x) { const c = codeOf(x); setNote(c === "stop_unsupported" ? "이 세션은 원래 창에서 멈추세요" : c === "not_running" ? "이미 끝난 질문이에요" : errText(c)); }
    load();
  };
  const row = (t: Task) => (
    <li key={t.requestId} className="task">
      <p className="t1"><b>{t.label}</b> <span className="chip">{taskState(t)}</span> <small className="muted">{when(t.createdAt)}</small>
        {t.pendingApprovals > 0 && <span className="chip">승인 대기 {t.pendingApprovals}</span>}</p>
      <p className="muted small">{t.preview}</p>
      <p className="acts">
        <button className="link" onClick={() => show(t.requestId)} aria-expanded={open === t.requestId}>자세히</button>
        {t.canStop && <button className="link" onClick={() => stop(t.requestId)}>중지</button>}
        <button className="link" onClick={() => onOpenConv(t.conversationId)}>대화로</button>
      </p>
      {open === t.requestId && (detail?.requestId === t.requestId ? (
        <dl className="more">
          <dt>질문</dt><dd>{detail.question}</dd>
          <dt>상태</dt><dd>{taskState(detail)}{detail.errorCode ? ` (${errText(detail.errorCode)})` : ""}</dd>
          {detail.approvals.map((a) => (
            <div key={a.approvalId}><dt>승인 요청 {a.n ?? ""}</dt><dd>{AKIND[a.kind] ?? a.kind} — {a.summary} → {ASTATE[a.state] ?? a.state}{a.state === "failed" && Number.isInteger(a.exitCode) ? ` (종료 코드 ${a.exitCode})` : ""}</dd></div>
          ))}
          {detail.answer && <><dt>답</dt><dd>{detail.answer}</dd></>}
        </dl>
      ) : <p className="muted small">불러오는 중…</p>)}
    </li>
  );
  return (
    <main className="list tasks">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="목록으로">‹</button>
        <h1>작업</h1>
        <button className="ghost" onClick={load} aria-label="새로 고침">↻</button>
      </header>
      {note && <p className="note err" role="alert">{note}</p>}
      {aps === null ? <p className="center muted">불러오는 중…</p> : (
        <>
          <div className="sec"><h2>승인 대기 {aps.length}</h2></div>
          {aps.length === 0 && <p className="muted hint">기다리는 승인이 없어요.</p>}
          <ul>
            {aps.map((a) => (
              <li key={a.approvalId} className="task">
                <p className="t1"><b>{a.label}</b> <span className="chip">승인 요청 {a.n ?? ""}</span> <small>{AKIND[a.kind] ?? a.kind}</small></p>
                <p className="muted small">{a.summary}{a.cwd ? ` (작업 폴더 ${a.cwd})` : ""}</p>
                <p className="acts"><button className="small" onClick={() => decide(a.approvalId, "allow")}>허용(이번 한 번)</button> <button className="small" onClick={() => decide(a.approvalId, "deny")}>거부</button></p>
              </li>
            ))}
          </ul>
          <div className="sec"><h2>진행 중·확인 필요 {active.length}</h2></div>
          {active.length === 0 && <p className="muted hint">진행 중인 질문이 없어요.</p>}
          <ul>{active.map(row)}</ul>
          <div className="sec"><h2>최근</h2></div>
          {recent.length === 0 && <p className="muted hint">아직 질문이 없어요.</p>}
          <ul>{recent.map(row)}</ul>
        </>
      )}
    </main>
  );
}
