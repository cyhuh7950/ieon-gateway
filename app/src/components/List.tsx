// 첫 화면: 방(여러 AI 직원)과 AI 직원(1:1) 목록. 한 화면에 함께, 새 소식이 오면 다시 불러온다.
import { useCallback, useEffect, useState } from "react";
import type { Client, Conversation, Room } from "../lib/api";
import { staffName } from "../lib/rooms";
import { CARD_TEXT, ENGINE, errText } from "../lib/texts";
import { Avatar, codeOf, type OnEvent } from "./common";

function stateOf(c: Conversation): [string, string] {
  if (c.heldBy) return ["warn", "확인 필요"];
  if (c.busy) return ["busy", "처리 중"];
  if (!c.deviceOnline) return ["off", "PC 꺼짐"];
  if (c.attention) return ["warn", `알림 ${c.attention}`];
  return ["ok", "대기"];
}

export function ListScreen({ api, server, onOpen, onRoom, onNewRoom, onEvent, onForget, onLost, notify }: {
  api: Client; server: string; onOpen: (c: Conversation) => void; onRoom: (r: Room) => void; onNewRoom: () => void; onEvent: OnEvent; onForget: () => Promise<string | null>; onLost: () => void;
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
        <h1>이어온</h1>
        <button className="ghost" onClick={load} aria-label="새로 고침">↻</button>
      </header>
      {hubMode && <p className="note warn">{CARD_TEXT.hub_mode}</p>}
      {err && <p className="note err" role="alert">{err}</p>}
      {list === null && !err && <p className="center muted">불러오는 중…</p>}
      {list !== null && (
        <>
          <div className="sec"><h2>방</h2>{list.length > 0 && <button className="small" onClick={onNewRoom}>+ 방 만들기</button>}</div>
          {rooms.length === 0 && <p className="muted hint">여러 AI 직원을 한 방에 모아 @이름으로 부를 수 있어요.</p>}
          <ul>
            {rooms.map((r) => (
              <li key={r.roomId}>
                <button className="row" onClick={() => onRoom(r)}>
                  <span className="avatar room" aria-hidden>👥</span>
                  <span className="who"><b>{r.name}</b><small>AI 직원 {r.members.length}명 · 대표 @{staffName(byId.get(r.lead)) || "—"}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="sec"><h2>AI 직원</h2></div>
          {list.length === 0 && <p className="muted hint">아직 연결된 대화가 없어요. 웹 화면에서 대화를 연결하면 여기에 나와요.</p>}
          <ul>
            {list.map((c) => {
              const [k, t] = stateOf(c);
              return (
                <li key={c.conversationId}>
                  <button className="row" onClick={() => onOpen(c)}>
                    <Avatar c={c} />
                    <span className="who"><b>{staffName(c)}</b><small>{[c.staff?.roleName, ENGINE[c.engine] ?? c.engine, c.host?.name, c.workMode ? "작업 모드" : null].filter(Boolean).join(" · ")}</small></span>
                    <span className={"chip " + k}>{t}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <footer className="foot muted">
        <span>{new URL(server).host}</span>
        <a className="link" href={server + "/privacy"} target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>
        {notify && <button className="link" onClick={notify.toggle} aria-pressed={notify.on} title="창을 보고 있지 않을 때 '○○가 답했어요' 알림(내용은 넣지 않음)">{notify.on ? "🔔 알림 켜짐" : "🔕 알림 꺼짐"}</button>}
        <button className="link" onClick={async () => {
          if (!confirm("이 기기 연결을 끊을까요?\n서버에서 이 기기의 열쇠를 지우고, 이 앱에 저장된 연결 정보도 지워요. 다시 쓰려면 새 연결 코드가 필요해요.\n대화 기록은 서버(내 PC·허브)에 그대로 남아요 — 지우려면 끊기 전에 대화 위쪽 ✎에서.")) return;
          const warn = await onForget(); if (warn) alert(warn);
        }}>이 기기 연결 끊기</button>
      </footer>
    </main>
  );
}
