"use client";
// 이어온 앱: 연결 → 목록(방·AI 직원) → 1:1 대화 / 방(AP-3b). 새 소식(SSE) 하나를 모든 화면이 나눠 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client, type Conn, type Conversation, type Room } from "../lib/api";
import { subscribe, type ServerEvent } from "../lib/sse";
import { clearConn, loadConn, saveConn } from "../lib/storage";
import { noteFor, notifyOn, setNotifyOn } from "../lib/notify";
import { startPush } from "../lib/push";
import { checkUpdate } from "../lib/update";
import { staffName } from "../lib/rooms";
import { ChatScreen } from "../components/Chat";
import { codeOf } from "../components/common";
import { ListScreen } from "../components/List";
import { PairScreen } from "../components/Pair";
import { RoomScreen } from "../components/Room";
import { RoomForm } from "../components/RoomForm";
import { TasksScreen } from "../components/Tasks";

type View = { kind: "list" } | { kind: "tasks" } | { kind: "chat"; conv: Conversation } | { kind: "room"; roomId: string } | { kind: "roomForm"; room: Room | null; convs: Conversation[] | null };

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
  // AP-4a 알림: 이 창을 보고 있지 않을 때만, 원문 없이 "○○가 답했어요". 누르면 그 대화로.
  const canNotify = typeof window !== "undefined" && "Notification" in window;
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false); notifyRef.current = notify;
  useEffect(() => { setNotify(canNotify && notifyOn(Boolean((globalThis as any).ieonDesktop)) && Notification.permission === "granted"); }, [canNotify]);
  const names = useRef(new Map<string, Conversation>());
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!api || !canNotify) return;
    return onEvent(async (e) => {
      if (!notifyRef.current || Notification.permission !== "granted" || document.hasFocus()) return;
      const id = e.data?.conversationId;
      if (id && !names.current.has(id)) { try { (await api.conversations()).conversations.forEach((c) => names.current.set(c.conversationId, c)); } catch { /* 이름 없이 */ } }
      const n = noteFor(e, (cid) => staffName(names.current.get(cid)));
      if (!n || shown.current.has(n.tag)) return;
      shown.current.add(n.tag);
      const x = new Notification(n.title, { body: n.body, tag: n.tag });
      x.onclick = () => { (globalThis as any).ieonDesktop?.focus?.(); window.focus(); const c = names.current.get(n.conversationId); if (c) setView({ kind: "chat", conv: c }); x.close(); };
    });
  }, [api, canNotify, onEvent]);
  // AP-4b 휴대폰 알림: 연결되면 알림 허용을 묻고 알림 주소를 서버에 알림. 알림을 누르면 그 대화로.
  useEffect(() => {
    if (!api) return;
    let stop = () => {};
    startPush((t) => api.pushToken(t), async (id) => {
      let c = names.current.get(id);
      if (!c) { try { (await api.conversations()).conversations.forEach((x) => names.current.set(x.conversationId, x)); c = names.current.get(id); } catch { /* 목록 그대로 */ } }
      if (c) setView({ kind: "chat", conv: c });
    }, { onState: (s) => { api.pushState(s).catch(() => {}); } }).then((f) => { stop = f; });
    return () => stop();
  }, [api]);
  // AP-5 새 판 알림: 연결한 서버에 더 새 판이 있으면 첫 화면 위에 "받기"
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => { if (conn) checkUpdate(conn.server).then(setUpdate); }, [conn]);
  const toggleNotify = useCallback(async () => {
    if (notify) { setNotify(false); setNotifyOn(false); return; }
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    const on = perm === "granted"; setNotify(on); setNotifyOn(on);
  }, [notify]);
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
  // AP-5a: 서버에서 이 기기 열쇠를 지운 뒤 앱에 저장된 연결 정보도 지운다. 서버에 닿지 않으면 알려 주고 앱 쪽만 지운다.
  const forget = async (): Promise<string | null> => {
    let warn: string | null = null;
    try { await api.forget(); } catch (x) { const c = codeOf(x); if (c !== "unauthorized") warn = "서버에 닿지 않아 서버 쪽 연결은 남아 있어요. 웹 화면 설정 → 내 프로그램 연결 → 이어온 앱 연결에서 끊어 주세요."; }
    await clearConn(); setView({ kind: "list" }); setConn(null);
    return warn;
  };
  switch (view.kind) {
    case "chat": return <ChatScreen key={view.conv.conversationId} api={api} conv={view.conv} onBack={toList} onEvent={onEvent} onLost={onLost} />;
    case "room": return <RoomScreen key={view.roomId} api={api} roomId={view.roomId} onBack={toList} onEvent={onEvent} onLost={onLost} onEdit={(room, convs) => setView({ kind: "roomForm", room, convs })} />;
    case "tasks": return <TasksScreen api={api} onBack={toList} onEvent={onEvent} onLost={onLost}
      onOpenConv={async (id) => { try { const c = (await api.conversations()).conversations.find((x) => x.conversationId === id); if (c) setView({ kind: "chat", conv: c }); } catch { /* 목록에 없으면 그대로 */ } }} />;
    case "roomForm": return <RoomForm api={api} room={view.room} convs={view.convs} onLost={onLost}
      onBack={() => setView(view.room ? { kind: "room", roomId: view.room.roomId } : { kind: "list" })}
      onSaved={(r) => setView({ kind: "room", roomId: r.roomId })} onDeleted={toList} />;
    default: return <>{update && <a className="update-bar" href={update.url}>새 판 {update.version}이 있어요 — 받기</a>}<ListScreen api={api} server={conn.server} onOpen={(conv) => setView({ kind: "chat", conv })} onRoom={(r) => setView({ kind: "room", roomId: r.roomId })}
      onNewRoom={() => setView({ kind: "roomForm", room: null, convs: null })} onTasks={() => setView({ kind: "tasks" })} onEvent={onEvent} onForget={forget} onLost={onLost} notify={canNotify ? { on: notify, toggle: toggleNotify } : null} /></>;
  }
}
