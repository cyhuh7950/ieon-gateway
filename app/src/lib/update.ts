// AP-5 새 판 알림: 연결한 서버(/v1/app/version)에 이 앱보다 새 판이 있으면 받을 주소를 돌려준다. 자동 설치는 하지 않는다(안드로이드가 막음, 사람이 누름).
import { Capacitor } from "@capacitor/core";

export const appVersion = (): string => process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
// "0.1.10" > "0.1.9"처럼 숫자로 비교
export function newer(a: string, b: string): boolean {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0; }
  return false;
}
type Meta = { android?: { version: string; file: string }; desktop?: { version: string; file: string } };
export function platformKind(): "android" | "desktop" | null {
  if ((globalThis as any).ieonDesktop) return "desktop";
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" ? "android" : null; } catch { return null; }
}
export async function checkUpdate(server: string, kind = platformKind(), current = appVersion(), f: typeof fetch = fetch): Promise<{ version: string; url: string } | null> {
  if (!kind) return null;
  try {
    const r = await f(server + "/v1/app/version");
    if (!r.ok) return null;
    const m = (await r.json()) as Meta;
    const it = m[kind];
    return it && newer(it.version, current) ? { version: it.version, url: server + "/download/" + encodeURIComponent(it.file) } : null;
  } catch { return null; }
}
