import type { NextConfig } from "next";

// 정적 내보내기(out/) — 휴대폰(Capacitor)·PC(Electron)·웹이 같은 화면을 쓴다.
const nextConfig: NextConfig = { output: "export", reactStrictMode: true };

export default nextConfig;
