# 이어온 허브(ieun) 이미지(W0). 서버·허브 연결부·메신저를 한 컨테이너에서 src/hub/run.mjs가 돌린다.
# 빌드 맥락은 저장소 루트(compose.yaml의 context). 서버에 이미 있는 node:24-bookworm-slim을 쓴다.
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY scripts/ ./scripts/
ENV NODE_ENV=production HOME=/data/home CODEX_HOME=/data/codex
CMD ["node", "src/hub/run.mjs", "/data"]
