import { t } from "../lib/i18n";
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
    if (!room || !confirm(t('app.room_form.1', { name: room.name }))) return;
    try { await api.deleteRoom(room.roomId); onDeleted(); } catch (x) { fail(x); }
  };
  return (
    <main className="list">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label={t('app.room_form.4')}>‹</button>
        <h1>{room ? t('app.room.11') : t('app.room_form.7')}</h1>
      </header>
      <form className="sheet page" onSubmit={save}>
        <label>{t('app.room_form.2')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder={t('app.room_form.5')} required /></label>
        <fieldset>
          <legend>{t('app.room_form.9')}</legend>
          {convs.map((c) => (
            <label key={c.conversationId} className="check">
              <input type="checkbox" checked={members.includes(c.conversationId)} onChange={() => toggle(c.conversationId)} />
              <Avatar c={c} small /> @{staffName(c)}
            </label>
          ))}
        </fieldset>
        <label>{t('app.room_form.10')}
          <select value={lead} onChange={(e) => setLead(e.target.value)} disabled={!members.length}>
            {members.map((id) => <option key={id} value={id}>@{staffName(convs.find((c) => c.conversationId === id))}</option>)}
          </select>
        </label>
        <details open={Boolean(guide)}><summary>{t('app.room_form.11')}</summary><textarea value={guide} onChange={(e) => setGuide(e.target.value)} maxLength={1000} rows={3} placeholder={t('app.room_form.6')} /></details>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy || !members.length}>{room ? t('app.chat.10') : t('app.room_form.8')}</button>
        {room && <button type="button" className="link danger" onClick={remove}>{t('app.room_form.3')}</button>}
      </form>
    </main>
  );
}
