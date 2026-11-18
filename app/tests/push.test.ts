// AP-4b 휴대폰 알림: 허용을 묻고 등록 → 받은 알림 주소를 서버에 알림, 알림을 누르면 그 대화, 거절하면 등록하지 않음, 휴대폰 앱이 아니면 아무것도 안 함.
import { describe, expect, it } from "vitest";
import { startPush } from "../src/lib/push";

function fakePlugin(receive: string) {
  const handlers: Record<string, (x: any) => void> = {};
  const calls: string[] = [];
  const plugin: any = {
    addListener: async (name: string, f: (x: any) => void) => { handlers[name] = f; return { remove: async () => { delete handlers[name]; } }; },
    createChannel: async (c: any) => { calls.push("channel:" + c.id); },
    checkPermissions: async () => ({ receive }),
    requestPermissions: async () => { calls.push("ask"); return { receive: "granted" }; },
    register: async () => { calls.push("register"); handlers.registration?.({ value: "fcm-token-1" }); },
  };
  return { plugin, handlers, calls };
}

describe("휴대폰 알림", () => {
  it("허용을 묻고 등록해 알림 주소를 서버에 알리고, 알림을 누르면 그 대화를 연다", async () => {
    const f = fakePlugin("prompt");
    const sent: string[] = []; const opened: string[] = [];
    const stop = await startPush(async (t) => { sent.push(t); }, (id) => opened.push(id), { plugin: f.plugin });
    expect(f.calls).toEqual(["channel:ieon", "ask", "register"]);
    expect(sent).toEqual(["fcm-token-1"]);
    f.handlers.pushNotificationActionPerformed({ notification: { data: { conversationId: "c1" } } });
    expect(opened).toEqual(["c1"]);
    stop();
  });
  it("거절했으면 등록하지 않는다", async () => {
    const f = fakePlugin("denied");
    const sent: string[] = [];
    await startPush(async (t) => { sent.push(t); }, () => {}, { plugin: f.plugin });
    expect(f.calls).toEqual(["channel:ieon"]);
    expect(sent).toEqual([]);
  });
  it("휴대폰 앱이 아니면 아무것도 하지 않는다", async () => {
    const stop = await startPush(async () => {}, () => {}, { plugin: null });
    expect(typeof stop).toBe("function");
  });
});
