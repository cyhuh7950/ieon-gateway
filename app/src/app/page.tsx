"use client";
// 이어온 앱: 연결 → 목록(방·AI 직원) → 1:1 대화 / 방(AP-3b). 새 소식(SSE) 하나를 모든 화면이 나눠 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client, type Conn, type Conversation, type Room } from "../lib/api";
import { subscribe, type ServerEvent } from "../lib/sse";
import { clearConn, loadConn, saveConn } from "../lib/storage";
import { ChatScreen } from "../components/Chat";
import { ListScreen } from "../components/List";
import { PairScreen } from "../components/Pair";
import { RoomScreen } from "../components/Room";
import { RoomForm } from "../components/RoomForm";

type View = { kind: "list" } | { kind: "chat"; conv: Conversation } | { kind: "room"; roomId: string } | { kind: "roomForm"; room: Room | null; convs: Conversation[] | null };

export default function Home() {
  const [conn, setConn] = useState<Conn | null | undefined>(undefined);
  const [view, setView] = useState<View>({ kind: "list" });
  const [lost, setLost] = useState(false);
  const listeners = useRef(new Set<(e: ServerEvent) => void>());

  useEffect(() => { loadConn().then(setConn); }, []);
  useEffect(() => {
    if (!conn) return;
    return subscribe(conn, (e) => listeners.current.forEach((f) => f(e)), { onState: (s) => setLost(s === "unauthorized") });
  }, [conn]);
  const onEvent = useCallback((f: (e: ServerEvent) => void) => { listeners.current.add(f); return () => { listeners.current.delete(f); }; }, []);
  const api = useMemo(() => (conn ? client(conn) : null), [conn]);
  const onLost = useCallback(() => setLost(true), []);
  // 안드로이드 뒤로 가기·브라우저 뒤로: 목록이 아닌 화면에 있는 동안 기록을 딱 하나 쌓아 두고, 뒤로 가면 목록으로.
  // 화면의 ‹ 버튼으로 목록에 갈 때는 그 기록을 되돌려(history.back) 쌓인 기록이 남지 않게 한다.
  const pushed = useRef(false);
  useEffect(() => {
    const back = () => { pushed.current = false; setView({ kind: "list" }); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    if (view.kind !== "list" && !pushed.current) { history.pushState({ ieon: 1 }, ""); pushed.current = true; }
  }, [view.kind]);
  const toList = useCallback(() => { if (pushed.current) history.back(); else setView({ kind: "list" }); }, []);

  if (conn === undefined) return <main className="center muted">불러오는 중…</main>;
  if (!conn || !api || lost) return <PairScreen lost={lost} onDone={async (c) => { await saveConn(c); setLost(false); setView({ kind: "list" }); setConn(c); }} />;
  const forget = async () => { await clearConn(); setView({ kind: "list" }); setConn(null); };
  switch (view.kind) {
    case "chat": return <ChatScreen key={view.conv.conversationId} api={api} conv={view.conv} onBack={toList} onEvent={onEvent} onLost={onLost} />;
    case "room": return <RoomScreen key={view.roomId} api={api} roomId={view.roomId} onBack={toList} onEvent={onEvent} onLost={onLost} onEdit={(room, convs) => setView({ kind: "roomForm", room, convs })} />;
    case "roomForm": return <RoomForm api={api} room={view.room} convs={view.convs} onLost={onLost}
      onBack={() => setView(view.room ? { kind: "room", roomId: view.room.roomId } : { kind: "list" })}
      onSaved={(r) => setView({ kind: "room", roomId: r.roomId })} onDeleted={toList} />;
    default: return <ListScreen api={api} server={conn.server} onOpen={(conv) => setView({ kind: "chat", conv })} onRoom={(r) => setView({ kind: "room", roomId: r.roomId })}
      onNewRoom={() => setView({ kind: "roomForm", room: null, convs: null })} onEvent={onEvent} onForget={forget} onLost={onLost} />;
  }
}
