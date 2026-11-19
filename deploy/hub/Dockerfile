# 이어온 허브(ieun) 이미지(W0). 서버·허브 연결부·메신저를 한 컨테이너에서 src/hub/run.mjs가 돌린다.
# 빌드 맥락은 저장소 루트(compose.yaml의 context). 서버에 이미 있는 node:24-bookworm-slim을 쓴다.
FROM node:24-bookworm-slim
WORKDIR /app
# slim 이미지에는 HTTPS 인증서 묶음이 없다. Codex 실행 파일은 이 묶음으로 OpenAI에 접속한다(없으면 로그인·AI 호출 실패).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# SV2: 서버 Claude(허브 새 세션·엔진 칸). 판을 고정해 실측한 동작(환경 변수 로그인·setup-token 화면)이 바뀌지 않게 한다. 로그인은 이어온 화면에서 한 번.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.326 && npm cache clean --force
# 신산님 2026-11-20 "Antigravity는 설치만 하면 사용할 수 있어야": 공식 설치 스크립트(https://antigravity.google/cli/install.sh — 리눅스 arm64·x64 판을 골라 sha512 확인)로
# /usr/local/bin/agy에 설치. 받기에 실패해도 허브는 만든다(그때 Antigravity만 못 씀). 로그인은 이어온 화면의 Antigravity 계정(API 키).
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \n  && (curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin && /usr/local/bin/agy --version || echo "Antigravity 설치 실패 — 허브는 계속")
COPY src/ ./src/
COPY scripts/ ./scripts/
# 신산님 2026-11-19 "허브에서 설치 파일 받기"(저장소는 비공개 그대로): 새 서버 설치 묶음. 관리자가 만든 1시간짜리 설치 링크로만 내준다(/install/<열쇠>/…).
COPY deploy/ ./deploy/
RUN tar -czf /app/ieon-gateway.tar.gz package.json package-lock.json src scripts deploy
ENV NODE_ENV=production HOME=/data/home CODEX_HOME=/data/codex DISABLE_AUTOUPDATER=1
CMD ["node", "src/hub/run.mjs", "/data"]
