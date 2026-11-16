// 1:1 대화: 기록·질문·답·카드(허락·확인 필요·상태)·다시 보내기, 머리에서 AI 직원 이름·아이콘 바꾸기(AP-3b).
import { useCallback, useEffect, useRef, useState } from "react";
import { RETRYABLE, newKey, type Card, type Client, type Conversation } from "../lib/api";
import { ROOM_ERR, staffName } from "../lib/rooms";
import { ENGINE, errText } from "../lib/texts";
import { Avatar, BLOCKING, CardView, Composer, codeOf, type OnEvent } from "./common";
import { MicButton, ReadButton, SpeakerToggle, useAutoRead, useVoice } from "./Voice";

type Item = { id: string; question: string; key: string; requestId?: string; state: "sending" | "queued" | "done" | "failed" | "unknown" | "rejected" | "stopped"; stopping?: boolean; answer?: string; errorCode?: string | null; retried?: boolean; voice?: boolean };

export function ChatScreen({ api, conv: conv0, onBack, onEvent, onLost }: { api: Client; conv: Conversation; onBack: () => void; onEvent: OnEvent; onLost: () => void }) {
  const [conv, setConv] = useState(conv0);
  const id = conv.conversationId;
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [byVoice, setByVoice] = useState(false); // 이번 입력에 말로 쓴 글이 들어갔는지(대화에 🎤 표시)
  const v = useVoice();
  const endRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const fail = useCallback((x: unknown) => { const c = codeOf(x); if (c === "unauthorized") onLost(); else setNote(errText(c)); }, [onLost]);
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const loadCards = useCallback(async () => { try { setCards(await api.cards(id)); } catch (x) { fail(x); } }, [api, id, fail]);
  useEffect(() => {
    (async () => {
      try { setItems((await api.messages(id)).map((m) => ({ id: m.requestId, key: m.requestId, requestId: m.requestId, question: m.question, answer: m.answer, state: "done" }))); }
      catch (x) { fail(x); }
      setLoaded(true);
      loadCards();
    })();
  }, [api, id, fail, loadCards]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [items, cards]);

  const refresh = useCallback(async (requestId: string) => {
    const it = itemsRef.current.find((x) => x.requestId === requestId);
    if (!it) return;
    try {
      const r = await api.request(requestId);
      if (r.status === "completed") patch(it.key, { state: "done", answer: r.answer ?? "" });
      else if (r.status === "failed") patch(it.key, { state: "failed", errorCode: r.errorCode });
      else if (r.status === "unknown") patch(it.key, { state: "unknown", errorCode: r.errorCode });
      else if (r.status === "cancelled") patch(it.key, { state: "stopped" });
      if (r.status !== "queued") loadCards();
    } catch (x) { fail(x); }
  }, [api, loadCards, fail]);

  // 새 소식: 이 대화의 요청·승인만. 놓친 소식에 대비해 처리 중이면 5초마다도 확인.
  useEffect(() => onEvent((e) => {
    if (e.data?.conversationId !== id) return;
    if (e.event === "request" && e.data.requestId && e.data.status !== "queued") refresh(e.data.requestId);
    if (e.event === "approval" || e.data.status === "approval_required") loadCards();
  }), [onEvent, id, refresh, loadCards]);
  useEffect(() => {
    const t = setInterval(() => { itemsRef.current.filter((x) => x.state === "queued" && x.requestId).forEach((x) => refresh(x.requestId!)); }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = async (question: string, key: string, existing?: Item, voice = existing?.voice ?? false) => {
    if (existing && existing.key === key) patch(key, { state: "sending", errorCode: null });
    else {
      if (existing) patch(existing.key, { retried: true });
      setItems((xs) => [...xs, { id: key, key, question, state: "sending", voice }]);
    }
    try {
      const requestId = await api.ask(id, question, key);
      patch(key, { requestId, state: "queued" });
    } catch (x) {
      const c = codeOf(x);
      if (c === "unauthorized") return onLost();
      patch(key, { state: "rejected", errorCode: c });
      loadCards();
    }
  };
  // 서버에 닿았는지 모르는 실패(network)는 같은 요청 열쇠로 — 서버가 같은 질문을 두 번 보내지 않는다.
  const retry = (it: Item) => send(it.question, it.errorCode === "network" && it.state === "rejected" ? it.key : newKey(), it);
  const decide = async (approvalId: string, d: "allow" | "deny" | "done" | "drop") => { try { await api.decide(approvalId, d); } catch (x) { fail(x); } loadCards(); };
  // RC2: 이 질문만 멈추기
  const stop = async (it: Item) => {
    if (!it.requestId) return;
    patch(it.key, { stopping: true });
    try { const s = await api.stop(it.requestId); if (s === "cancelled") patch(it.key, { state: "stopped" }); }
    catch (x) { patch(it.key, { stopping: false }); const c = codeOf(x); setNote(c === "stop_unsupported" ? "이 세션은 원래 창에서 멈추세요" : c === "not_running" ? "이미 끝난 질문이에요" : errText(c)); }
    refresh(it.requestId);
  };
  const review = async (requestId: string, executed: boolean) => { try { await api.review(requestId, executed); } catch (x) { fail(x); } loadCards(); refresh(requestId); };
  useAutoRead(v, items.map((x) => ({ id: x.key, text: x.state === "done" ? x.answer : null })), loaded);
  const blocked = cards.some((c) => BLOCKING.has(c.kind)) || items.some((x) => x.state === "sending" || x.state === "queued");

  return (
    <main className="chat">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="목록으로">‹</button>
        <Avatar c={conv} />
        <span className="who"><b>{staffName(conv)}</b><small>{[conv.staff?.roleName, ENGINE[conv.engine] ?? conv.engine].filter(Boolean).join(" · ")}</small></span>
        <SpeakerToggle v={v} />
        <button className="ghost" onClick={() => setEditing((x) => !x)} aria-label="이름·아이콘 바꾸기" aria-expanded={editing}>✎</button>
      </header>
      {editing && <StaffForm api={api} conv={conv} onDone={(c) => { setConv(c); setEditing(false); }} onLost={onLost}
        busy={items.some((x) => x.state === "sending" || x.state === "queued")} onCleared={() => { setItems([]); setEditing(false); }} />}
      <section className="log" aria-live="polite">
        {items.length === 0 && <p className="center muted">{blocked ? "아직 주고받은 말이 없어요." : "아직 주고받은 말이 없어요. 아래에 질문을 쓰세요."}</p>}
        {items.map((it) => (
          <div key={it.id} className="turn">
            <p className="bubble me">{it.voice && <span className="via">🎤 음성</span>}{it.question}</p>
            {it.state === "sending" && <p className="bubble ai muted">보내는 중…</p>}
            {it.state === "queued" && <div className="ai-wrap"><p className="bubble ai muted">{it.stopping ? "멈추는 중…" : "답을 기다리는 중…"}</p>{!it.stopping && <button className="small" onClick={() => stop(it)}>중지</button>}</div>}
            {it.state === "stopped" && <p className="bubble ai muted">중지됨 — 이 질문만 멈췄어요</p>}
            {it.state === "done" && <div className="ai-wrap"><p className="bubble ai">{it.answer}</p><ReadButton v={v} text={it.answer ?? ""} /></div>}
            {it.state === "unknown" && <p className="bubble ai warn">결과를 확인할 수 없어요. 아래 확인 카드에서 실행됐는지 알려 주세요(자동으로 다시 보내지 않아요).</p>}
            {(it.state === "failed" || it.state === "rejected") && (
              <div className="bubble ai err">
                <p>{errText(it.errorCode)}</p>
                {RETRYABLE.has(it.errorCode ?? "") && !it.retried && <button className="small" onClick={() => retry(it)}>다시 보내기</button>}
              </div>
            )}
          </div>
        ))}
        {cards.map((c, i) => <CardView key={c.approvalId ?? c.kind + i} c={c} decide={decide} review={review} />)}
        {note && <p className="note err" role="alert">{note}</p>}
        <div ref={endRef} />
      </section>
      {v.hint && <p className="note info vhint" role="status">{v.hint} <button className="link" onClick={() => v.setHint("")}>닫기</button></p>}
      {v.notice}
      <Composer value={text} onChange={(x) => { setText(x); if (!x.trim()) setByVoice(false); }} disabled={blocked}
        left={<MicButton v={v} onText={(s) => { setText((x) => (x.trim() ? x.trim() + " " : "") + s); setByVoice(true); }} />} placeholder={blocked ? "지금은 보낼 수 없어요" : "질문 쓰기"}
        onSubmit={() => { const q = text.trim(); setText(""); setNote(""); send(q, newKey(), undefined, byVoice); setByVoice(false); }} />
    </main>
  );
}

// 이름(@이름으로 부를 이름)·아이콘. 역할은 웹 화면에서 — 여기서는 지금 역할을 그대로 둔다.
function StaffForm({ api, conv, onDone, onLost, busy: working, onCleared }: { api: Client; conv: Conversation; onDone: (c: Conversation) => void; onLost: () => void; busy: boolean; onCleared: () => void }) {
  const [name, setName] = useState(staffName(conv));
  const [icon, setIcon] = useState(conv.staff?.icon ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const s = await api.setStaff(conv.conversationId, { name: name.trim(), icon: icon.trim() || null, roleId: conv.staff?.roleId ?? null });
      onDone({ ...conv, staff: { ...conv.staff, ...s } });
    } catch (x) { const c = codeOf(x); if (c === "unauthorized") onLost(); else setErr(ROOM_ERR[c] ?? errText(c)); } finally { setBusy(false); }
  };
  return (
    <form className="sheet" onSubmit={save}>
      <div className="grid2">
        <label>이름(@이름)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required /></label>
        <label>아이콘<input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🛠" className="icon-in" /></label>
      </div>
      <small className="muted">역할{conv.staff?.roleName ? `(지금: ${conv.staff.roleName})` : ""}은 웹 화면에서 정해요.</small>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>저장</button>
      <button type="button" className="link danger" disabled={working} onClick={async () => {
        if (!confirm("이 대화의 서버 보관 기록(질문·답)을 지울까요? 되돌릴 수 없어요. 원래 Codex·Claude 세션 기록은 그대로예요.")) return;
        try { await api.deleteMessages(conv.conversationId); onCleared(); } catch (x) { const c = codeOf(x); if (c === "unauthorized") onLost(); else setErr(errText(c)); }
      }}>이 대화의 서버 보관 기록 지우기</button>
    </form>
  );
}
