// AP-4b 휴대폰 알림(안드로이드, Firebase). 앱을 닫아도 서버가 "○○가 답했어요"를 보낸다 — 원문 없음(서버 push.mjs가 글을 정함).
// 연결되면 한 번 알림 허용을 묻고, 받은 알림 주소(FCM 토큰)를 서버에 알린다. 알림을 누르면 그 대화를 연다.
// 휴대폰 앱이 아니면(PC 앱·웹) 아무것도 하지 않는다(그쪽은 AP-4a 알림).
import { Capacitor } from "@capacitor/core";

type Plugin = typeof import("@capacitor/push-notifications").PushNotifications;
export type PushDeps = { plugin?: Plugin | null; native?: boolean; onState?: (state: string) => void };

async function loadPlugin(deps: PushDeps): Promise<Plugin | null> {
  if (deps.plugin !== undefined) return deps.plugin;
  if (!(deps.native ?? Capacitor.isNativePlatform()) || Capacitor.getPlatform() !== "android") return null;
  try { return (await import("@capacitor/push-notifications")).PushNotifications; } catch { return null; }
}

// sendToken(토큰) → 서버에 알림. onOpen(대화 ID) → 그 대화 열기. 돌려주는 함수로 듣기를 끈다.
export async function startPush(sendToken: (token: string) => Promise<unknown>, onOpen: (conversationId: string) => void, deps: PushDeps = {}): Promise<() => void> {
  const say = (s: string) => { try { deps.onState?.(s); } catch { /* 알리기 실패는 무시 */ } };
  let p: Plugin | null = null;
  try { p = await loadPlugin(deps); } catch (e) { say("load_error:" + String((e as Error)?.message ?? e).slice(0, 60)); return () => {}; }
  if (!p) { if (deps.plugin === undefined && (deps.native ?? Capacitor.isNativePlatform())) say("no_plugin"); return () => {}; }
  const subs: { remove: () => Promise<void> }[] = [];
  subs.push(await p.addListener("registration", (t) => { say("registered"); sendToken(t.value).catch((e) => say("send_error:" + String((e as Error)?.message ?? e).slice(0, 60))); }));
  subs.push(await p.addListener("registrationError", (e) => { say("register_error:" + String((e as { error?: string })?.error ?? e).slice(0, 80)); }));
  subs.push(await p.addListener("pushNotificationActionPerformed", (a) => {
    const id = (a.notification?.data as Record<string, string> | undefined)?.conversationId;
    if (id) onOpen(id);
  }));
  try {
    // 안드로이드 8+: 알림 갈래(서버가 channel_id "ieon"으로 보냄)
    await p.createChannel({ id: "ieon", name: "이어온", description: "AI 직원이 답했거나 허락을 기다릴 때", importance: 4 }).catch(() => {});
    let perm = await p.checkPermissions();
    say("perm:" + perm.receive);
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") { perm = await p.requestPermissions(); say("asked:" + perm.receive); }
    if (perm.receive === "granted") await p.register();
  } catch (e) { say("error:" + String((e as Error)?.message ?? e).slice(0, 80)); /* 알림을 못 켜도 앱은 그대로 */ }
  return () => { subs.forEach((s) => s.remove().catch(() => {})); };
}
