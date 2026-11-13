// 방 만들기·고치기·지우기(방 기록만 지움 — 각 AI 직원 세션·1:1 기록은 그대로).
import { useEffect, useState } from "react";
import type { Client, Conversation, Room } from "../lib/api";
import { ROOM_ERR, staffName } from "../lib/rooms";
import { errText } from "../lib/texts";
import { Avatar, codeOf } from "./common";

export function RoomForm({ api, room, convs: convs0, onBack, onSaved, onDeleted, onLost }: {
  api: Client; room: Room | null; convs: Conversation[] | null; onBack: () => void; onSaved: (r: Room) => void; onDeleted: () => void; onLost: () => void;
}) {
  const [convs, setConvs] = useState<Conversation[]>(convs0 ?? []);
  const [name, setName] = useState(room?.name ?? "");
  const [members, setMembers] = useState<string[]>(room?.members ?? []);
  const [lead, setLead] = useState(room?.lead ?? "");
  const [guide, setGuide] = useState(room?.guide ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fail = (x: unknown) => { const c = codeOf(x); if (c === "unauthorized") onLost(); else setErr(ROOM_ERR[c] ?? errText(c)); };
  useEffect(() => { if (!convs0) api.conversations().then((r) => setConvs(r.conversations)).catch(fail); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => {
    const next = members.includes(id) ? members.filter((m) => m !== id) : [...members, id];
    setMembers(next);
    if (!next.includes(lead)) setLead(next[0] ?? "");
  };
  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { onSaved(await api.saveRoom(room?.roomId ?? null, { name: name.trim(), members, lead, guide: guide.trim() })); } catch (x) { fail(x); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!room || !confirm(`"${room.name}" 방을 지울까요? 방 기록만 지워지고 각 AI 직원 대화는 그대로예요.`)) return;
    try { await api.deleteRoom(room.roomId); onDeleted(); } catch (x) { fail(x); }
  };
  return (
    <main className="list">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="뒤로">‹</button>
        <h1>{room ? "방 설정" : "방 만들기"}</h1>
      </header>
      <form className="sheet page" onSubmit={save}>
        <label>방 이름<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="예: 개발팀" required /></label>
        <fieldset>
          <legend>AI 직원(1~10명)</legend>
          {convs.map((c) => (
            <label key={c.conversationId} className="check">
              <input type="checkbox" checked={members.includes(c.conversationId)} onChange={() => toggle(c.conversationId)} />
              <Avatar c={c} small /> @{staffName(c)}
            </label>
          ))}
        </fieldset>
        <label>대표(아무도 안 부르면 답함)
          <select value={lead} onChange={(e) => setLead(e.target.value)} disabled={!members.length}>
            {members.map((id) => <option key={id} value={id}>@{staffName(convs.find((c) => c.conversationId === id))}</option>)}
          </select>
        </label>
        <details open={Boolean(guide)}><summary>공통 안내(선택)</summary><textarea value={guide} onChange={(e) => setGuide(e.target.value)} maxLength={1000} rows={3} placeholder="이 방에서 보내는 질문마다 앞에 붙는 안내" /></details>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy || !members.length}>{room ? "저장" : "만들기"}</button>
        {room && <button type="button" className="link danger" onClick={remove}>이 방 지우기</button>}
      </form>
    </main>
  );
}
