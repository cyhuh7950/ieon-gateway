import { t } from "../lib/i18n";
import { LangSelect } from "./LangSelect";
// 첫 화면: 방(여러 AI 직원)과 AI 직원(1:1) 목록. 한 화면에 함께, 새 소식이 오면 다시 불러온다.
import { useCallback, useEffect, useState } from "react";
import type { Client, Conversation, Room } from "../lib/api";
import { staffName } from "../lib/rooms";
import { CARD_TEXT, ENGINE, errText } from "../lib/texts";
import { Avatar, codeOf, type OnEvent } from "./common";

function stateOf(c: Conversation): [string, string] {
  if (c.heldBy) return ["warn", t('app.list.14')];
  if (c.busy) return ["busy", t('app.list.15')];
  if (!c.deviceOnline) return ["off", t('app.list.16')];
  if (c.attention) return ["warn", t('app.list.1', { attention: c.attention })];
  return ["ok", t('app.list.17')];
}

export function ListScreen({ api, server, onOpen, onRoom, onNewRoom, onTasks, onEvent, onForget, onLost, notify }: {
  api: Client; server: string; onOpen: (c: Conversation) => void; onRoom: (r: Room) => void; onNewRoom: () => void; onTasks: () => void; onEvent: OnEvent; onForget: () => Promise<string | null>; onLost: () => void;
  notify: { on: boolean; toggle: () => void } | null;
}) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [hubMode, setHubMode] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const [r, rs] = await Promise.all([api.conversations(), api.rooms()]);
      setList(r.conversations); setRooms(rs); setHubMode(Boolean(r.hubMode)); setErr("");
    } catch (x) { const c = codeOf(x); if (c === "unauthorized") onLost(); else setErr(errText(c)); }
  }, [api, onLost]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onEvent(() => load()), [onEvent, load]);
  const byId = new Map((list ?? []).map((c) => [c.conversationId, c]));
  return (
    <main className="list">
      <header className="bar">
        <h1>{t('common.product')}</h1>
        <button className="ghost" onClick={onTasks} aria-label={t('app.list.11')}>{t('app.list.2')}</button>
        <button className="ghost" onClick={load} aria-label={t('app.list.12')}>↻</button>
      </header>
      {hubMode && <p className="note warn">{CARD_TEXT.hub_mode}</p>}
      {err && <p className="note err" role="alert">{err}</p>}
      {list === null && !err && <p className="center muted">{t('app.list.3')}</p>}
      {list !== null && (
        <>
          <div className="sec"><h2>{t('app.list.4')}</h2>{list.length > 0 && <button className="small" onClick={onNewRoom}>{t('app.list.5')}</button>}</div>
          {rooms.length === 0 && <p className="muted hint">{t('app.list.6')}</p>}
          <ul>
            {rooms.map((r) => (
              <li key={r.roomId}>
                <button className="row" onClick={() => onRoom(r)}>
                  <span className="avatar room" aria-hidden>👥</span>
                  <span className="who"><b>{r.name}</b><small>{t('app.list.7', { members: r.members.length, lead: staffName(byId.get(r.lead)) || "—" })}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="sec"><h2>{t('app.notify.7')}</h2></div>
          {list.length === 0 && <p className="muted hint">{t('app.list.8')}</p>}
          <ul>
            {list.map((c) => {
              const [k, tv] = stateOf(c);
              return (
                <li key={c.conversationId}>
                  <button className="row" onClick={() => onOpen(c)}>
                    <Avatar c={c} />
                    <span className="who"><b>{staffName(c)}</b><small>{[c.staff?.roleName, ENGINE[c.engine] ?? c.engine, c.host?.name, c.workMode ? t('app.list.18') : null].filter(Boolean).join(" · ")}</small></span>
                    <span className={"chip " + k}>{tv}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <footer className="foot muted">
        <span>{new URL(server).host}</span>
        <LangSelect />
        <a className="link" href={server + "/privacy"} target="_blank" rel="noopener noreferrer">{t('app.list.9')}</a>
        {notify && <button className="link" onClick={notify.toggle} aria-pressed={notify.on} title={t('app.list.13')}>{notify.on ? t('app.list.19') : t('app.list.20')}</button>}
        <button className="link" onClick={async () => {
          if (!confirm(t('app.list.21'))) return;
          const warn = await onForget(); if (warn) alert(warn);
        }}>{t('app.list.10')}</button>
      </footer>
    </main>
  );
}
