"use client";
// 이어온 앱 AP-3a: 연결(서버 주소 + 연결 코드) → AI 직원 목록 → 1:1 대화(질문·답·카드·승인·다시 보내기), 새 소식으로 바로 갱신.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, RETRYABLE, cleanCode, client, newKey, normalizeServer, pair, type Card, type Client, type Conn, type Conversation } from "../lib/api";
import { subscribe, type ServerEvent } from "../lib/sse";
import { clearConn, loadConn, platformName, saveConn } from "../lib/storage";
import { CARD_TEXT, ENGINE, errText } from "../lib/texts";

const APPROVAL_KIND: Record<string, string> = { command: " — 명령 실행", file: " — 파일 바꾸기", permissions: " — 권한 넓히기" }; // 서버 approvals.kind
const BLOCKING = new Set(["hub_mode", "device_offline", "engine_off", "held", "archived"]);
const codeOf = (e: unknown) => (e instanceof ApiError ? (e.status === 429 ? "rate_limited" : e.status === 401 ? "unauthorized" : e.code) : "network");

export default function Home() {
  const [conn, setConn] = useState<Conn | null | undefined>(undefined);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [lost, setLost] = useState(false);
  const listeners = useRef(new Set<(e: ServerEvent) => void>());

  useEffect(() => { loadConn().then(setConn); }, []);
  useEffect(() => {
    if (!conn) return;
    return subscribe(conn, (e) => listeners.current.forEach((f) => f(e)), { onState: (s) => setLost(s === "unauthorized") });
  }, [conn]);
  const onEvent = useCallback((f: (e: ServerEvent) => void) => { listeners.current.add(f); return () => { listeners.current.delete(f); }; }, []);

  if (conn === undefined) return <main className="center muted">불러오는 중…</main>;
  if (!conn || lost) return <PairScreen lost={lost} onDone={async (c) => { await saveConn(c); setLost(false); setConn(c); }} />;
  const api = client(conn);
  const forget = async () => { await clearConn(); setCurrent(null); setConn(null); };
  return current
    ? <ChatScreen api={api} conv={current} onBack={() => setCurrent(null)} onEvent={onEvent} onLost={() => setLost(true)} />
    : <ListScreen api={api} server={conn.server} onOpen={setCurrent} onEvent={onEvent} onForget={forget} onLost={() => setLost(true)} />;
}

function PairScreen({ lost, onDone }: { lost: boolean; onDone: (c: Conn) => Promise<void> }) {
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => `이어온 ${platformName()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(lost ? errText("unauthorized") : "");
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const s = normalizeServer(server);
    if (!s) return setErr("서버 주소를 확인하세요(예: ieun-gateway.sinsan.kr).");
    if (cleanCode(code).length !== 8) return setErr("연결 코드는 숫자 8자리예요.");
    setBusy(true); setErr("");
    try { await onDone(await pair(s, code, name.trim() || "이어온 앱")); } catch (x) { setErr(errText(codeOf(x))); } finally { setBusy(false); }
  };
  return (
    <main className="pair">
      <div className="logo" aria-hidden>이</div>
      <h1>이어온 연결</h1>
      <p className="muted">웹 화면 <b>설정 → 내 프로그램 연결 → 이어온 앱 연결</b>에서 <b>연결 코드 만들기</b>를 누르면 나오는 서버 주소와 8자리 코드를 넣으세요.</p>
      <form onSubmit={submit}>
        <label>서버 주소<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ieun-gateway.sinsan.kr" inputMode="url" autoCapitalize="none" autoCorrect="off" required /></label>
        <label>연결 코드<input value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="12345678" inputMode="numeric" maxLength={8} required /></label>
        <details><summary>이 기기 이름</summary><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="이 기기 이름" /></details>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? "연결 중…" : "연결"}</button>
      </form>
    </main>
  );
}

function Avatar({ c }: { c: Conversation }) {
  const n = c.staff?.name ?? c.label;
  return <span className="avatar" aria-hidden>{c.staff?.icon || n.slice(0, 1)}</span>;
}

function stateOf(c: Conversation): [string, string] {
  if (c.heldBy) return ["warn", "확인 필요"];
  if (c.busy) return ["busy", "처리 중"];
  if (!c.deviceOnline) return ["off", "PC 꺼짐"];
  if (c.attention) return ["warn", `알림 ${c.attention}`];
  return ["ok", "대기"];
}

function ListScreen({ api, server, onOpen, onEvent, onForget, onLost }: { api: Client; server: string; onOpen: (c: Conversation) => void; onEvent: (f: (e: ServerEvent) => void) => () => void; onForget: () => void; onLost: () => void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [hubMode, setHubMode] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { const r = await api.conversations(); setList(r.conversations); setHubMode(Boolean(r.hubMode)); setErr(""); }
    catch (x) { const c = codeOf(x); if (c === "unauthorized") onLost(); else setErr(errText(c)); }
  }, [api, onLost]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onEvent(() => load()), [onEvent, load]);
  return (
    <main className="list">
      <header className="bar">
        <h1>AI 직원</h1>
        <button className="ghost" onClick={load} aria-label="새로 고침">↻</button>
      </header>
      {hubMode && <p className="note warn">{CARD_TEXT.hub_mode}</p>}
      {err && <p className="note err" role="alert">{err}</p>}
      {list === null && !err && <p className="center muted">불러오는 중…</p>}
      {list?.length === 0 && <p className="center muted">아직 연결된 대화가 없어요. 웹 화면에서 대화를 연결하면 여기에 나와요.</p>}
      <ul>
        {list?.map((c) => {
          const [k, t] = stateOf(c);
          return (
            <li key={c.conversationId}>
              <button className="row" onClick={() => onOpen(c)}>
                <Avatar c={c} />
                <span className="who"><b>{c.staff?.name ?? c.label}</b><small>{[c.staff?.roleName, ENGINE[c.engine] ?? c.engine, c.host?.name, c.workMode ? "작업 모드" : null].filter(Boolean).join(" · ")}</small></span>
                <span className={"chip " + k}>{t}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="foot muted">
        <span>{new URL(server).host}</span>
        <button className="link" onClick={() => { if (confirm("이 기기에서 연결 정보를 지울까요? 다시 쓰려면 새 연결 코드가 필요해요.")) onForget(); }}>이 기기 연결 지우기</button>
      </footer>
    </main>
  );
}

type Item = { id: string; question: string; key: string; requestId?: string; state: "sending" | "queued" | "done" | "failed" | "unknown" | "rejected"; answer?: string; errorCode?: string | null; retried?: boolean };

function ChatScreen({ api, conv, onBack, onEvent, onLost }: { api: Client; conv: Conversation; onBack: () => void; onEvent: (f: (e: ServerEvent) => void) => () => void; onLost: () => void }) {
  const id = conv.conversationId;
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const fail = useCallback((x: unknown) => { const c = codeOf(x); if (c === "unauthorized") onLost(); else setNote(errText(c)); }, [onLost]);
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const loadCards = useCallback(async () => { try { setCards(await api.cards(id)); } catch (x) { fail(x); } }, [api, id, fail]);
  useEffect(() => {
    (async () => {
      try { setItems((await api.messages(id)).map((m) => ({ id: m.requestId, key: m.requestId, requestId: m.requestId, question: m.question, answer: m.answer, state: "done" }))); }
      catch (x) { fail(x); }
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

  const send = async (question: string, key: string, existing?: Item) => {
    if (existing && existing.key === key) patch(key, { state: "sending", errorCode: null });
    else {
      if (existing) patch(existing.key, { retried: true });
      setItems((xs) => [...xs, { id: key, key, question, state: "sending" }]);
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
  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setText(""); setNote("");
    send(q, newKey());
  };
  // 서버에 닿았는지 모르는 실패(network)는 같은 요청 열쇠로 — 서버가 같은 질문을 두 번 보내지 않는다.
  const retry = (it: Item) => send(it.question, it.errorCode === "network" && it.state === "rejected" ? it.key : newKey(), it);

  const decide = async (approvalId: string, d: "allow" | "deny") => { try { await api.decide(approvalId, d); } catch (x) { fail(x); } loadCards(); };
  const review = async (requestId: string, executed: boolean) => { try { await api.review(requestId, executed); } catch (x) { fail(x); } loadCards(); refresh(requestId); };
  const blocked = cards.some((c) => BLOCKING.has(c.kind)) || items.some((x) => x.state === "sending" || x.state === "queued");

  return (
    <main className="chat">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="목록으로">‹</button>
        <Avatar c={conv} />
        <span className="who"><b>{conv.staff?.name ?? conv.label}</b><small>{[conv.staff?.roleName, ENGINE[conv.engine] ?? conv.engine].filter(Boolean).join(" · ")}</small></span>
      </header>
      <section className="log" aria-live="polite">
        {items.length === 0 && <p className="center muted">{blocked ? "아직 주고받은 말이 없어요." : "아직 주고받은 말이 없어요. 아래에 질문을 쓰세요."}</p>}
        {items.map((it) => (
          <div key={it.id} className="turn">
            <p className="bubble me">{it.question}</p>
            {it.state === "sending" && <p className="bubble ai muted">보내는 중…</p>}
            {it.state === "queued" && <p className="bubble ai muted">답을 기다리는 중…</p>}
            {it.state === "done" && <p className="bubble ai">{it.answer}</p>}
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
      <form className="composer" onSubmit={submit}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={blocked ? "지금은 보낼 수 없어요" : "질문 쓰기"} rows={1} maxLength={8000}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
        <button className="primary" disabled={blocked || !text.trim()}>보내기</button>
      </form>
    </main>
  );
}

function CardView({ c, decide, review }: { c: Card; decide: (id: string, d: "allow" | "deny") => void; review: (id: string, executed: boolean) => void }) {
  if (c.kind === "approval" && c.approvalId) {
    return (
      <div className="card warn">
        <b>허락이 필요해요{APPROVAL_KIND[c.approvalKind ?? ""] ?? ""}</b>
        <pre>{c.summary}</pre>
        {c.cwd && <small className="muted">폴더: {c.cwd}</small>}
        {c.expiresAt && <small className="muted">{new Date(c.expiresAt).toLocaleTimeString()}까지 정하지 않으면 거부돼요.</small>}
        <div className="acts"><button className="primary" onClick={() => decide(c.approvalId!, "allow")}>허용</button><button onClick={() => decide(c.approvalId!, "deny")}>거부</button></div>
      </div>
    );
  }
  if (c.kind === "held" && c.requestId) {
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
