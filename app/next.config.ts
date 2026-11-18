import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// 정적 내보내기(out/) — 휴대폰(Capacitor)·PC(Electron)·웹이 같은 화면을 쓴다.
// AP-5: 새 판 알림용으로 이 앱의 판 번호를 화면 코드에 넣는다.
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const nextConfig: NextConfig = { output: "export", reactStrictMode: true, env: { NEXT_PUBLIC_APP_VERSION: version } };

export default nextConfig;
