import type { Metadata, Viewport } from "next";
import "./globals.css";
import { t } from "../lib/i18n";

export const metadata: Metadata = { title: t('common.product'), description: t('app.layout.1') };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0f766e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
