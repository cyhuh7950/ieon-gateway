// AP-5 새 판 알림: 판 비교, 서버에 더 새 판이 있을 때만 받을 주소, 휴대폰·PC 앱이 아니면 묻지 않음.
import { describe, expect, it } from "vitest";
import { checkUpdate, newer } from "../src/lib/update";

const meta = { android: { version: "0.1.6", file: "ieon-android-0.1.6.apk" }, desktop: { version: "0.1.5", file: "ieon-setup-0.1.5.exe" } };
const fakeFetch = (async () => ({ ok: true, json: async () => meta })) as unknown as typeof fetch;

describe("새 판 알림", () => {
  it("판 번호는 숫자로 비교", () => {
    expect(newer("0.1.10", "0.1.9")).toBe(true);
    expect(newer("0.1.5", "0.1.5")).toBe(false);
    expect(newer("0.1.4", "0.1.5")).toBe(false);
  });
  it("더 새 판이면 받을 주소, 같으면 없음", async () => {
    expect(await checkUpdate("https://hub.example", "android", "0.1.5", fakeFetch)).toEqual({ version: "0.1.6", url: "https://hub.example/download/ieon-android-0.1.6.apk" });
    expect(await checkUpdate("https://hub.example", "desktop", "0.1.5", fakeFetch)).toBeNull();
    expect(await checkUpdate("https://hub.example", null, "0.1.0", fakeFetch)).toBeNull();
  });
});
