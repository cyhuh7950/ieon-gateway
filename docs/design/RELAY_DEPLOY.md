# 중계 배포 계획 (M4-b, sinsan-server)

기준: 2026-11-06. 상태: **계획·초안만 있음. 서버에는 아무것도 올리지 않았다.** 쓰기 작업은 아래 4절 항목별로 신산님 승인 후 진행한다.

## 1. 결정

- 배포 서버: **`sinsan-server`(168.107.4.6)**. 처음 후보였던 `ysna-server`는 쓰지 않는다. `ieon-gateway.sinsan.kr` A 레코드가 이미 `168.107.4.6`이라 DNS 변경이 필요 없다(신산님 결정, 2026-11-06).
- 방식: Docker 컨테이너 + 기존 nginx-proxy-manager(NPM)의 reverse proxy·TLS.
- Teams 앱 비밀번호는 중계에 두지 않는다(PC에만). MULTI_BOTS 6-1.

## 2. 읽기 전용 조사 결과 (2026-11-06, 변경 없음)

| 항목 | 결과 |
| --- | --- |
| 서버 | Ubuntu 22.04.5, aarch64, 가동 2주 이상, 공개 IP 168.107.4.6 |
| 접속 | SSH 별칭 `sinsan-server`(ubuntu), docker 그룹 소속 |
| Docker | 29.1.3, Compose 2.40.3. 로컬에 `node:22-alpine`·`node:24.18.0-alpine3.23` 있음(새로 받지 않아도 됨) |
| 자원 | 디스크 97G 중 26G 여유(74%), 메모리 가용 약 6.4G |
| 프록시 | `nginx-proxy-manager`가 80/81/443 사용. 네트워크 `proxy-network`(172.19.0.0/16)와 `stockdata_net` |
| 다른 서비스 | 약 30개 컨테이너(moaworks·sectorflow·daon·alpha-lab 등). 기존 서비스 약 15개가 `proxy-network`에서 컨테이너 이름으로 프록시됨 |
| 포트 | 호스트 28700~28799 사용 없음. 방화벽 ufw 비활성 |
| 이어온 흔적 | 컨테이너·이미지·`~/deploy/ieon*` 없음 |
| DNS | 서버에서도 `ieon-gateway.sinsan.kr` → 168.107.4.6 |

## 3. 배포 구성

```
카카오 ──HTTPS──▶ NPM(443, TLS) ──proxy-network──▶ ieon-relay:28770 (컨테이너, 호스트 포트 게시 없음)
                                                         ▲ PC가 먼저 접속(긴 대기 폴링)
```

- 폴더: `~/deploy/ieon-gateway/relay/` — `Dockerfile`, `compose.yaml`, `src/relay/`(중계 코드 2개 파일), `relay.secrets`(권한 600).
- 파일 원본은 저장소 `deploy/relay/`와 `src/relay/`. 서버에는 git 자격 증명을 두지 않고 이 PC에서 묶어 `scp`로 올린다.
- 컨테이너: 비루트(`node`), 읽기 전용 파일 시스템, `cap_drop: ALL`, `no-new-privileges`, 메모리 128MB·프로세스 64개 제한, `restart: unless-stopped`, 내부 포트 28770.
- 네트워크: `proxy-network`에만 붙인다(기존 서비스와 같은 관례). 같은 네트워크의 다른 서비스(예: `shared-db`)에 닿을 수는 있으나 중계에는 어떤 계정도 없다. 전용 네트워크는 NPM 컨테이너 변경이 필요해 택하지 않았다.
- 비밀 값 2개는 **이 PC에서 무작위로 만들어** `.local\relay\relay.secrets`(git 제외)에 두고, 값은 채팅·로그에 출력하지 않는다. 같은 파일을 서버로 복사한다. PC의 `.local\.env`에는 신산님이 `KAKAO_RELAY_TOKEN`(= `IEON_RELAY_PC_TOKEN` 값)을 직접 옮겨 적는다. 스킬 URL의 비밀 값(`IEON_RELAY_KAKAO_SECRET`)은 신산님이 그 파일에서 읽어 오픈빌더에 입력한다.
- NPM 프록시 호스트(신산님이 NPM 화면에서 직접): 도메인 `ieon-gateway.sinsan.kr` → 호스트명 `ieon-relay`, 포트 `28770`, 스킴 http, 웹소켓 끔, Block Common Exploits 켬, SSL은 Let's Encrypt 인증서 발급 + Force SSL + HTTP/2. Cloudflare 프록시(주황 구름)는 쓰지 않고 DNS 전용을 유지한다.

## 4. 단계와 승인 항목 (모두 별도 승인)

| 단계 | 작업 | 승인 | 되돌리기 |
| --- | --- | --- | --- |
| W1 | PC에서 비밀 값 생성(`.local\relay\relay.secrets`), 파일 묶음 준비 | 로컬 쓰기 | 파일 삭제 |
| W2 | 서버에 `~/deploy/ieon-gateway/relay/` 생성, 파일·비밀 파일(600) 복사 | 서버 쓰기 | 폴더 삭제 |
| W3 | `docker compose build` → `up -d`(이미지 `ieon-relay:0.0.1`, 컨테이너 `ieon-relay`) | 서버 쓰기 | `docker compose down`, `docker rmi ieon-relay:0.0.1` |
| W4 | NPM 프록시 호스트·인증서(신산님 화면 조작) | 신산님 직접 | NPM에서 프록시 호스트 삭제 |
| W5 | 확인: 컨테이너 healthy, `https://ieon-gateway.sinsan.kr/health` → `{ok:true,pc:false}`, 틀린 비밀 경로 404, 그 밖의 경로 404 | 읽기 | — |
| W6 | 오픈빌더(Aidot 봇) 스킬 URL 등록(신산님 직접) → 테스트 발화 → "PC 연결 끊김" 응답 확인(모델 호출 없음) | 신산님 직접 | 스킬 URL 삭제 |
| W7 | PC 연결·실제 질문 흐름: 메신저 프로세스 기동(`kakaoRelayUrl`·토큰 설정)과 모델 호출이 필요 | **별도 승인**(서버·포트 기동, 모델 호출 횟수) | 메신저 `stop` |

- 기존 서비스·DNS·NPM 기존 설정은 바꾸지 않는다. 변경은 `~/deploy/ieon-gateway`·컨테이너 1개·이미지 1개·NPM 프록시 호스트 1개뿐이다.
- 자원 영향: 메모리 최대 128MB, 디스크 수십 MB(이미지는 기존 `node:22-alpine` 위에 코드 몇 KB 추가).

## 5. 남은 확인

- Aidot 봇의 용도(운영 중인지)와 콜백 승인이 그 봇에 적용됐는지(W6 전).
- 콜백 유효 시간·횟수 실측(W7).
