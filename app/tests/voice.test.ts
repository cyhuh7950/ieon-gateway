import { afterEach, describe, expect, it } from "vitest";
import { VOICE_NOTICE, VoiceError, listenOnce, speakable, voiceKind, voiceSupport } from "../src/lib/voice";

const g = globalThis as any;
afterEach(() => { delete g.window; delete g.ieonDesktop; delete g.webkitSpeechRecognition; delete g.speechSynthesis; });

describe("음성(기기 내장)", () => {
  it("읽기 좋게: 코드 덩어리·링크는 줄이고 기호는 빼고 4000자까지", () => {
    expect(speakable("**완료**했어요.\n```js\nconst a = 1\n```\n자세히: https://example.com/x?y=1")).toBe("완료했어요. 코드 생략. 자세히: 링크.");
    expect(speakable("가".repeat(5000)).length).toBe(4000);
    expect(speakable("")).toBe("");
  });
  it("PC 설치형은 읽어 주기 + 받아쓰기 안내(Win+H), 웹은 Web Speech, 아무것도 없으면 none", async () => {
    g.window = g; g.ieonDesktop = { platform: "win32" }; g.speechSynthesis = {};
    expect(voiceKind()).toBe("desktop");
    expect(await voiceSupport()).toEqual({ kind: "desktop", listen: "hint", speak: true });
    delete g.ieonDesktop; g.webkitSpeechRecognition = function () {};
    expect(voiceKind()).toBe("web");
    expect(await voiceSupport()).toEqual({ kind: "web", listen: "web", speak: true });
    delete g.webkitSpeechRecognition; delete g.speechSynthesis;
    expect(voiceKind()).toBe("none");
  });
  it("웹 받아쓰기: 한국어로 한 번, 글자만 돌려줌 — 못 들으면 no_speech, 마이크 막힘은 not_allowed", async () => {
    let made: any;
    class FakeSR { lang = ""; interimResults = true; onresult: any; onerror: any; onend: any; constructor() { made = this; } start() { setTimeout(() => { this.onresult?.({ results: [[{ transcript: " 오늘 할 일 알려 줘 " }]] }); this.onend?.(); }, 1); } }
    g.window = g; g.webkitSpeechRecognition = FakeSR;
    expect(await listenOnce("web")).toBe("오늘 할 일 알려 줘");
    expect(made.lang).toBe("ko-KR");
    expect(made.interimResults).toBe(false);
    class Silent extends FakeSR { start() { setTimeout(() => this.onend?.(), 1); } }
    g.webkitSpeechRecognition = Silent;
    await expect(listenOnce("web")).rejects.toMatchObject({ code: "no_speech" });
    class Denied extends FakeSR { start() { setTimeout(() => { this.onerror?.({ error: "not-allowed" }); }, 1); } }
    g.webkitSpeechRecognition = Denied;
    await expect(listenOnce("web")).rejects.toBeInstanceOf(VoiceError);
  });
  it("처음 안내: 기기 회사 서버를 거칠 수 있음·서버에 저장 안 함·승인은 말로 하지 않음", () => {
    expect(VOICE_NOTICE).toContain("기기 회사");
    expect(VOICE_NOTICE).toContain("저장하지 않아요");
    expect(VOICE_NOTICE).toContain("카드 버튼으로만");
  });
});
