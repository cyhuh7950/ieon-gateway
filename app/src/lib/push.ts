import { t } from "./i18n";
// AP-4b 휴대폰 알림(안드로이드, Firebase). 앱을 닫아도 서버가 "○○가 답했어요"를 보낸다 — 원문 없음(서버 push.mjs가 글을 정함).
// 연결되면 한 번 알림 허용을 묻고, 받은 알림 주소(FCM 토큰)를 서버에 알린다. 알림을 누르면 그 대화를 연다.
// 휴대폰 앱이 아니면(PC 앱·웹) 아무것도 하지 않는다(그쪽은 AP-4a 알림).
// 휴대폰을 볼 수 없을 때 원인을 찾도록 단계마다 상태 이름(start·perm·asked·registered·…·오류 이름)을 onState로 알린다 — 원문·토큰 없음.
import { Capacitor } from "@capacitor/core";

type Plugin = typeof import("@capacitor/push-notifications").PushNotifications;
export type PushDeps = { plugin?: Plugin | null; native?: boolean; onState?: (state: string) => void; stepMs?: number };

const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 60);
// 단계 하나가 끝나지 않고 멈추는 경우도 알 수 있게 시간 제한
const within = <T,>(p: Promise<T>, ms: number, name: string) => Promise.race([p, new Promise<never>((_, bad) => setTimeout(() => bad(new Error(name + "_timeout")), ms))]);

// sendToken(토큰) → 서버에 알림. onOpen(대화 ID) → 그 대화 열기. 돌려주는 함수로 듣기를 끈다.
export async function startPush(sendToken: (token: string) => Promise<unknown>, onOpen: (conversationId: string) => void, deps: PushDeps = {}): Promise<() => void> {
  const say = (s: string) => { try { deps.onState?.(s); } catch { /* 알리기 실패는 무시 */ } };
  const ms = deps.stepMs ?? 15_000;
  const subs: { remove: () => Promise<void> }[] = [];
  const stop = () => { subs.forEach((s) => s.remove().catch(() => {})); };
  let p: Plugin | null = null;
  try {
    if (deps.plugin !== undefined) p = deps.plugin;
    else {
      const native = deps.native ?? Capacitor.isNativePlatform();
      const platform = Capacitor.getPlatform();
      if (!native || platform !== "android") return stop; // PC 앱·웹·아이폰(나중)
      say("start:" + platform);
      p = (await within(import("@capacitor/push-notifications"), ms, "load")).PushNotifications;
    }
    if (!p) return stop;
    subs.push(await within(p.addListener("registration", (tv) => { say("registered"); sendToken(tv.value).then(() => say("token_sent")).catch((e) => say("send_error:" + msg(e))); }), ms, "listen"));
    subs.push(await within(p.addListener("registrationError", (e) => { say("register_error:" + msg((e as { error?: string })?.error ?? e)); }), ms, "listen"));
    subs.push(await within(p.addListener("pushNotificationActionPerformed", (a) => {
      const id = (a.notification?.data as Record<string, string> | undefined)?.conversationId;
      if (id) onOpen(id);
    }), ms, "listen"));
    // 안드로이드 8+: 알림 갈래(서버가 channel_id "ieon"으로 보냄)
    await within(p.createChannel({ id: "ieon", name: t('common.product'), description: t('app.push.1'), importance: 4 }), ms, "channel").catch((e) => say("channel_error:" + msg(e)));
    let perm = await within(p.checkPermissions(), ms, "check");
    say("perm:" + perm.receive);
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") { perm = await within(p.requestPermissions(), 120_000, "ask"); say("asked:" + perm.receive); }
    if (perm.receive === "granted") { await within(p.register(), ms, "register"); say("register_called"); }
  } catch (e) {
    say("error:" + msg(e)); // 알림을 못 켜도 앱은 그대로
  }
  return stop;
}
