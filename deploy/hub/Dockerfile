# 이어온 허브 전달기 이미지(P4). 외부 패키지가 없다. 서버에 이미 있는 node:22-alpine을 쓴다(새로 받지 않음).
# 빌드: 이 폴더에 src/hub/forward.mjs를 같은 경로로 복사한 뒤 docker compose build
FROM node:22-alpine
WORKDIR /app
COPY src/hub/ ./src/hub/
ENV NODE_ENV=production
CMD ["node", "src/hub/forward.mjs"]
