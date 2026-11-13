import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "이어온", description: "이어온 — 내 AI 직원과 대화" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0f766e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
