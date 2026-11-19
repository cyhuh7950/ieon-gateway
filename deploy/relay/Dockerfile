# 이어온 공개 수신 중계 이미지(MULTI_BOTS M4-b). 외부 패키지가 없어 npm install이 필요 없다.
# 서버에 이미 있는 node:22-alpine을 쓴다(새로 받지 않음).
FROM node:22-alpine
WORKDIR /app
COPY src/relay/ ./src/relay/
# I18N-a: 안내 글은 언어별 사전에서(src/i18n·locales)
COPY src/i18n/ ./src/i18n/
COPY locales/ ./locales/
ENV NODE_ENV=production
USER node
CMD ["node", "src/relay/main.mjs"]
