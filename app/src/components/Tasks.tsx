import { t } from "../lib/i18n";
// RC3 작업 화면: 질문(작업) 하나하나의 진행·승인 대기·결과를 모아 보고, 여기서 바로 허용·거부·중지(웹 작업 서랍과 같은 내용).
import { useCallback, useEffect, useState } from "react";
import type { Client, PendingApproval, Task, TaskDetail } from "../lib/api";
import { codeOf, type OnEvent } from "./common";
import { errText } from "../lib/texts";

export const TSTATE: Record<string, string> = { queued: t('app.tasks.21'), dispatching: t('app.tasks.22'), running: t('app.tasks.23'), completed: t('app.tasks.24'), failed: t('app.tasks.25'), cancelled: t('app.tasks.26'), unknown: t('app.list.14'), approval_required: t('app.tasks.27') };
export const ASTATE: Record<string, string> = { handoff: t('app.tasks.28'), handoff_done: t('app.tasks.29'), handoff_dropped: t('app.tasks.30'), pending: t('app.tasks.31'), approved: t('app.tasks.32'), running: t('app.tasks.23'), completed: t('app.tasks.33'), failed: t('app.tasks.34'), unknown: t('app.tasks.35'), denied: t('app.tasks.36'), expired: t('app.tasks.37'), turn_ended: t('app.tasks.38') };
const AKIND: Record<string, string> = { command: t('app.tasks.39'), file: t('app.tasks.40'), permissions: t('app.tasks.41') };
const when = (s: string | null) => (s ? new Date(s).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const taskState = (tv: Pick<Task, "status" | "stopRequested">) => (tv.stopRequested && ["dispatching", "running"].includes(tv.status) ? t('app.tasks.42') : TSTATE[tv.status] ?? tv.status);

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
      setAps(a); setActive(act); setRecent(all.filter((tv) => !act.some((x) => x.requestId === tv.requestId)));
    } catch (x) { fail(x); }
  }, [api, fail]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onEvent(() => load()), [onEvent, load]);
  useEffect(() => { if (!active.length && !(aps ?? []).length) return; const tv = setInterval(load, 5000); return () => clearInterval(tv); }, [active.length, aps, load]);
  const show = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail(await api.task(id)); } catch (x) { fail(x); }
  };
  const decide = async (id: string, d: "allow" | "deny" | "done" | "drop") => { try { await api.decide(id, d); } catch (x) { fail(x); } load(); };
  const stop = async (id: string) => {
    try { await api.stop(id); } catch (x) { const c = codeOf(x); setNote(c === "stop_unsupported" ? t('app.chat.14') : c === "not_running" ? t('app.chat.15') : errText(c)); }
    load();
  };
  const row = (tv: Task) => (
    <li key={tv.requestId} className="task">
      <p className="t1"><b>{tv.label}</b> <span className="chip">{taskState(tv)}</span> <small className="muted">{when(tv.createdAt)}</small>
        {tv.pendingApprovals > 0 && <span className="chip">{t('app.tasks.4', { pending_approvals: tv.pendingApprovals })}</span>}</p>
      <p className="muted small">{tv.preview}</p>
      <p className="acts">
        <button className="link" onClick={() => show(tv.requestId)} aria-expanded={open === tv.requestId}>{t('app.tasks.5')}</button>
        {tv.canStop && <button className="link" onClick={() => stop(tv.requestId)}>{t('app.chat.4')}</button>}
        <button className="link" onClick={() => onOpenConv(tv.conversationId)}>{t('app.tasks.6')}</button>
      </p>
      {open === tv.requestId && (detail?.requestId === tv.requestId ? (
        <dl className="more">
          <dt>{t('app.tasks.7')}</dt><dd>{detail.question}</dd>
          <dt>{t('app.tasks.8')}</dt><dd>{taskState(detail)}{detail.errorCode ? ` (${errText(detail.errorCode)})` : ""}</dd>
          {detail.approvals.map((a) => (
            <div key={a.approvalId}><dt>{t('app.tasks.9', { v: a.n ?? "" })}</dt><dd>{AKIND[a.kind] ?? a.kind} — {a.summary} → {ASTATE[a.state] ?? a.state}{a.state === "failed" && Number.isInteger(a.exitCode) ? t('app.tasks.1', { exit_code: a.exitCode }) : ""}</dd></div>
          ))}
          {detail.resume?.known && <><dt>{t('app.tasks.10')}</dt><dd>{({ same: t('app.tasks.43'), needs_review: t('app.tasks.44'), mismatch: t('app.tasks.45') } as Record<string, string>)[detail.resume.verdict ?? ""] ?? detail.resume.verdict} {t('app.tasks.11')} {detail.resume.then?.engine}{detail.resume.sameEngine ? "" : t('app.tasks.2', { engine: detail.resume.now?.engine })}{detail.resume.sameHost === false ? t('app.tasks.46') : ""}{detail.resume.historyKept ? "" : t('app.tasks.47')}{detail.resume.deviceOnline === false ? t('app.tasks.48') : ""}</dd></>}
          {detail.answer && <><dt>{t('app.tasks.12')}</dt><dd>{detail.answer}</dd></>}
        </dl>
      ) : <p className="muted small">{t('app.list.3')}</p>)}
    </li>
  );
  return (
    <main className="list tasks">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label={t('app.chat.12')}>‹</button>
        <h1>{t('app.tasks.13')}</h1>
        <button className="ghost" onClick={load} aria-label={t('app.list.12')}>↻</button>
      </header>
      {note && <p className="note err" role="alert">{note}</p>}
      {aps === null ? <p className="center muted">{t('app.list.3')}</p> : (
        <>
          <div className="sec"><h2>{t('app.tasks.14', { aps: aps.length })}</h2></div>
          {aps.length === 0 && <p className="muted hint">{t('app.tasks.15')}</p>}
          <ul>
            {aps.map((a) => (
              <li key={a.approvalId} className="task">
                <p className="t1"><b>{a.label}</b> <span className="chip">{a.handoff ? t('app.tasks.49') : t('app.tasks.50')} {a.n ?? ""}</span> <small>{AKIND[a.kind] ?? a.kind}</small></p>
                <p className="muted small">{a.summary}{a.cwd ? t('app.tasks.3', { cwd: a.cwd }) : ""}</p>
                <p className="acts">{a.handoff
                  ? <><button className="small" onClick={() => decide(a.approvalId, "done")}>{t('app.tasks.16')}</button> <button className="small" onClick={() => decide(a.approvalId, "drop")}>{t('app.tasks.17')}</button></>
                  : <><button className="small" onClick={() => decide(a.approvalId, "allow")}>{t('app.tasks.51')}</button> <button className="small" onClick={() => decide(a.approvalId, "deny")}>{t('app.tasks.18')}</button></>}</p>
              </li>
            ))}
          </ul>
          <div className="sec"><h2>{t('app.tasks.19', { active: active.length })}</h2></div>
          {active.length === 0 && <p className="muted hint">{t('app.tasks.20')}</p>}
          <ul>{active.map(row)}</ul>
          <div className="sec"><h2>{t('app.tasks.52')}</h2></div>
          {recent.length === 0 && <p className="muted hint">{t('app.tasks.53')}</p>}
          <ul>{recent.map(row)}</ul>
        </>
      )}
    </main>
  );
}
