// 방: AI 직원 여러 명. @이름으로 부르고(안 부르면 대표), 사용 중이면 알림만(자동으로 기다렸다 보내지 않음),
// 끝난 답은 사람이 눌러 다른 AI 직원에게 넘기고, 보내지 않은 게 확실한 글만 한 번 다시 보낸다. 허락 카드는 그 AI 직원 것을 방에서 바로.
import { useCallback, useEffect, useRef, useState } from "react";
import { newKey, type Card, type Client, type Conversation, type RoomDetail, type RoomPost } from "../lib/api";
import { ROOM_BUSY, ROOM_ERR, WAITING, addMention, mentionTargets, staffName } from "../lib/rooms";
import { CARD_TEXT, errText } from "../lib/texts";
import { Avatar, CardView, Composer, codeOf, type OnEvent } from "./common";
import { MicButton, ReadButton, SpeakerToggle, useAutoRead, useVoice } from "./Voice";

export function RoomScreen({ api, roomId, onBack, onEdit, onEvent, onLost }: { api: Client; roomId: string; onBack: () => void; onEdit: (r: RoomDetail, convs: Conversation[]) => void; onEvent: OnEvent; onLost: () => void }) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [hubMode, setHubMode] = useState(false);
  const [approvals, setApprovals] = useState<{ who: string; card: Card }[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [handing, setHanding] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const v = useVoice();
  const fail = useCallback((x: unknown) => { const c = codeOf(x); if (c === "unauthorized") onLost(); else setNote(ROOM_ERR[c] ?? errText(c)); }, [onLost]);

  const load = useCallback(async () => {
    try {
      const [r, cs] = await Promise.all([api.room(roomId), api.conversations()]);
      setRoom(r); setConvs(cs.conversations); setHubMode(Boolean(cs.hubMode));
      // 답을 기다리는 AI 직원의 허락 카드만 가져온다(W1 허락은 요청 상태를 바꾸지 않고 따로 쌓인다)
      const waitingOn = [...new Set(r.posts.filter((p) => p.kind === "ask" && WAITING.has(p.status ?? "") && p.conversationId).map((p) => p.conversationId!))];
      const got = await Promise.all(waitingOn.map(async (cid) => (await api.cards(cid)).filter((c) => c.kind === "approval").map((card) => ({ who: "@" + staffName(cs.conversations.find((c) => c.conversationId === cid)), card }))));
      setApprovals(got.flat());
    } catch (x) { fail(x); }
  }, [api, roomId, fail]);
  useEffect(() => { load(); }, [load]);
  const members = (room?.members ?? []).map((id) => convs.find((c) => c.conversationId === id)).filter((c): c is Conversation => Boolean(c));
  const memberIds = useRef(new Set<string>()); memberIds.current = new Set(room?.members ?? []);
  useEffect(() => onEvent((e) => { if (memberIds.current.has(e.data?.conversationId) || e.data?.roomId === roomId) load(); }), [onEvent, load, roomId]);
  const waiting = Boolean(room?.posts.some((p) => p.kind === "ask" && WAITING.has(p.status ?? "")));
  useEffect(() => { if (!waiting) return; const t = setInterval(load, 4000); return () => clearInterval(t); }, [waiting, load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [room?.posts.length, approvals.length]);

  useAutoRead(v, (room?.posts ?? []).filter((p) => p.kind === "ask").map((p) => ({ id: p.postId, text: p.status === "completed" ? p.answer : null })), Boolean(room));
  const apply = (posts: RoomPost[]) => setRoom((r) => (r ? { ...r, posts } : r));
  const post = async () => {
    const t = text.trim();
    setSending(true); setNote("");
    try { apply(await api.roomPost(roomId, t, newKey())); setText(""); } catch (x) { fail(x); } finally { setSending(false); }
  };
  const retry = async (p: RoomPost) => { try { apply(await api.roomRetry(roomId, p.postId, newKey())); } catch (x) { fail(x); } };
  const handoff = async (p: RoomPost, to: string, noteText: string) => {
    try { apply(await api.roomHandoff(roomId, { requestId: p.requestId!, to, note: noteText }, newKey())); setHanding(null); } catch (x) { fail(x); }
  };
  const decide = async (approvalId: string, d: "allow" | "deny" | "done" | "drop") => { try { await api.decide(approvalId, d); } catch (x) { fail(x); } load(); };

  if (!room) return <main className="chat"><header className="bar"><button className="ghost" onClick={onBack} aria-label="목록으로">‹</button><span className="who"><b>방</b></span></header>{note ? <p className="note err">{note}</p> : <p className="center muted">불러오는 중…</p>}</main>;
  const nameOf = (id: string | null) => "@" + (staffName(convs.find((c) => c.conversationId === id)) || id);
  const leadName = staffName(convs.find((c) => c.conversationId === room.lead));
  const targets = text.trim() ? mentionTargets(text, members, room.lead).map((id) => nameOf(id)).join(", ") : "";

  return (
    <main className="chat">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="목록으로">‹</button>
        <span className="avatar room" aria-hidden>👥</span>
        <span className="who"><b>{room.name}</b><small>AI 직원 {room.members.length}명 · 대표 @{leadName}</small></span>
        <SpeakerToggle v={v} />
        <button className="ghost" onClick={() => onEdit(room, convs)} aria-label="방 설정">⚙</button>
      </header>
      <section className="log" aria-live="polite">
        {room.guide && <p className="note info">공통 안내: {room.guide}</p>}
        {room.posts.length === 0 && <p className="center muted">@이름으로 부른 AI 직원이 답해요. 아무도 안 부르면 대표 @{leadName}가 답해요.</p>}
        {room.posts.map((p) => {
          if (p.kind === "user") return <p key={p.postId} className="bubble me">{p.text}</p>;
          const who = nameOf(p.conversationId);
          const retryBtn = p.canRetry && <button className="small" onClick={() => retry(p)}>{who}에게 다시 보내기</button>;
          if (p.kind === "busy") return <div key={p.postId} className="notice"><p>{who} — {ROOM_BUSY[p.code ?? ""] ?? errText(p.code)}</p>{retryBtn}</div>;
          const others = members.filter((m) => m.conversationId !== p.conversationId);
          return (
            <div key={p.postId} className="turn">
              <small className="whoTag">{who}</small>
              {p.status === "completed" && <div className="ai-wrap"><p className="bubble ai">{p.answer ?? "(보관하지 않은 답)"}</p><ReadButton v={v} text={p.answer ?? ""} /></div>}
              {WAITING.has(p.status ?? "") && <p className="bubble ai muted">{p.status === "approval_required" ? "허락을 기다리는 중…" : "답을 기다리는 중…"}</p>}
              {p.status === "failed" && <div className="notice"><p>{errText(p.errorCode)}</p>{retryBtn}</div>}
              {p.status === "unknown" && <div className="notice"><p>결과를 확인할 수 없어요. {who} 1:1 대화의 확인 카드에서 정리하세요(자동으로 다시 보내지 않아요).</p></div>}
              {p.status === "completed" && p.answer && others.length > 0 && (handing === p.postId
                ? <Handoff others={others} onCancel={() => setHanding(null)} onSend={(to, n) => handoff(p, to, n)} />
                : <button className="link left" onClick={() => setHanding(p.postId)}>다른 AI 직원에게 넘기기</button>)}
            </div>
          );
        })}
        {approvals.map(({ who, card }) => <CardView key={card.approvalId} c={card} who={who} decide={decide} />)}
        {note && <p className="note err" role="alert">{note}</p>}
        <div ref={endRef} />
      </section>
      {hubMode && <p className="note warn">{CARD_TEXT.hub_mode}</p>}
      {v.hint && <p className="note info vhint" role="status">{v.hint} <button className="link" onClick={() => v.setHint("")}>닫기</button></p>}
      {v.notice}
      <div className="mentions" role="group" aria-label="부를 AI 직원">
        {members.map((m) => <button key={m.conversationId} type="button" className="mchip" onClick={() => setText((t) => addMention(t, staffName(m)))}><Avatar c={m} small /> @{staffName(m)}</button>)}
      </div>
      {targets && <small className="to muted">→ {targets}에게 보내요</small>}
      <Composer value={text} onChange={setText} onSubmit={post} left={<MicButton v={v} onText={(s) => setText((x) => (x.trim() ? x.trim() + " " : "") + s)} />} disabled={sending || hubMode} placeholder={`@이름 (안 부르면 @${leadName})`} />
    </main>
  );
}

function Handoff({ others, onSend, onCancel }: { others: Conversation[]; onSend: (to: string, note: string) => void; onCancel: () => void }) {
  const [to, setTo] = useState(others[0].conversationId);
  const [note, setNote] = useState("");
  return (
    <div className="card">
      <b>누구에게 넘길까요?</b>
      <div className="mentions in">
        {others.map((m) => <button key={m.conversationId} type="button" className={"mchip" + (to === m.conversationId ? " on" : "")} aria-pressed={to === m.conversationId} onClick={() => setTo(m.conversationId)}><Avatar c={m} small /> @{staffName(m)}</button>)}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="함께 보낼 말(비우면 '이 답을 보고 이어서 해 주세요')" maxLength={1000} />
      <div className="acts"><button className="primary" onClick={() => onSend(to, note)}>넘기기</button><button onClick={onCancel}>그만두기</button></div>
    </div>
  );
}
