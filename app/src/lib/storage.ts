import { t } from "./i18n";
// 기기 열쇠 보관: 휴대폰은 Capacitor Preferences(앱 전용 저장소), PC(Electron)·웹은 그 앱의 저장소(localStorage).
// 열쇠 원문은 화면·로그에 다시 보이지 않는다.
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { Conn } from "./api";

const KEY = "ieon.conn.v1";

export async function loadConn(): Promise<Conn | null> {
  try {
    const raw = Capacitor.isNativePlatform() ? (await Preferences.get({ key: KEY })).value : localStorage.getItem(KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c && typeof c.server === "string" && typeof c.token === "string" ? c : null;
  } catch {
    return null;
  }
}

export async function saveConn(c: Conn): Promise<void> {
  const raw = JSON.stringify(c);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: KEY, value: raw });
  else localStorage.setItem(KEY, raw);
}

export async function clearConn(): Promise<void> {
  if (Capacitor.isNativePlatform()) await Preferences.remove({ key: KEY });
  else localStorage.removeItem(KEY);
}

export function platformName(): string {
  const w = globalThis as any;
  if (w.ieonDesktop) return "PC";
  try { return Capacitor.getPlatform() === "android" ? t('app.storage.1') : Capacitor.getPlatform() === "ios" ? t('app.storage.2') : t('app.storage.3'); } catch { return t('app.storage.3'); }
}
