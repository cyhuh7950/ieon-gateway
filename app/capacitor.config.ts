import type { CapacitorConfig } from "@capacitor/cli";

// 서버 호출은 일반 fetch(서버가 앱 출처 https://localhost만 CORS 허용) — 새 소식(SSE) 스트림도 같은 길로 받는다.
// PC형은 Tailscale 주소(http)로 붙으므로 http 서버도 허용한다.
const config: CapacitorConfig = {
  appId: "kr.sinsan.ieon",
  appName: "이어온",
  webDir: "out",
  server: { androidScheme: "https", cleartext: true },
  android: { allowMixedContent: true },
};

export default config;
