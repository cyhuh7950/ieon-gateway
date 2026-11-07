# 중계 배포 계획 (M4-b, sinsan-server)

기준: 2026-11-06. 상태: **W1~W7 완료(배포·오픈빌더 봇 테스트·PC 연결 실측, 6~7절). 남은 것: 실제 채널 배포 여부 결정, 미확인 항목(7절).**

## 1. 결정

- 배포 서버: **`sinsan-server`(168.107.4.6)**. 처음 후보였던 `ysna-server`는 쓰지 않는다(신산님 결정, 2026-11-06).
- 도메인: 신산님이 **`ieun-gateway.sinsan.kr`**로 바꿨다(이전 `ieon-gateway`가 아님 — 철자가 `ieun`). A 레코드 168.107.4.6, DNS 전용.
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
| DNS | 서버에서도 `ieun-gateway.sinsan.kr` → 168.107.4.6 |

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
- NPM 프록시 호스트(신산님이 NPM 화면에서 직접): 도메인 `ieun-gateway.sinsan.kr` → 호스트명 `ieon-relay`, 포트 `28770`, 스킴 http, 웹소켓 끔, Block Common Exploits 켬, SSL은 Let's Encrypt 인증서 발급 + Force SSL + HTTP/2. Cloudflare 프록시(주황 구름)는 쓰지 않고 DNS 전용을 유지한다.

## 4. 단계와 승인 항목 (모두 별도 승인)

| 단계 | 작업 | 승인 | 되돌리기 |
| --- | --- | --- | --- |
| W1 | PC에서 비밀 값 생성(`.local\relay\relay.secrets`), 파일 묶음 준비 | 로컬 쓰기 | 파일 삭제 |
| W2 | 서버에 `~/deploy/ieon-gateway/relay/` 생성, 파일·비밀 파일(600) 복사 | 서버 쓰기 | 폴더 삭제 |
| W3 | `docker compose build` → `up -d`(이미지 `ieon-relay:0.0.1`, 컨테이너 `ieon-relay`) | 서버 쓰기 | `docker compose down`, `docker rmi ieon-relay:0.0.1` |
| W4 | NPM 프록시 호스트·인증서(신산님 화면 조작) | 신산님 직접 | NPM에서 프록시 호스트 삭제 |
| W5 | 확인: 컨테이너 healthy, `https://ieun-gateway.sinsan.kr/health` → `{ok:true,pc:false}`, 틀린 비밀 경로 404, 그 밖의 경로 404 | 읽기 | — |
| W6 | 오픈빌더(Aidot 봇) 스킬 URL 등록(신산님 직접) → 테스트 발화 → "PC 연결 끊김" 응답 확인(모델 호출 없음) | 신산님 직접 | 스킬 URL 삭제 |
| W7 | PC 연결·실제 질문 흐름: 메신저 프로세스 기동(`kakaoRelayUrl`·토큰 설정)과 모델 호출이 필요 | **별도 승인**(서버·포트 기동, 모델 호출 횟수) | 메신저 `stop` |

- 기존 서비스·DNS·NPM 기존 설정은 바꾸지 않는다. 변경은 `~/deploy/ieon-gateway`·컨테이너 1개·이미지 1개·NPM 프록시 호스트 1개뿐이다.
- 자원 영향: 메모리 최대 128MB, 디스크 수십 MB(이미지는 기존 `node:22-alpine` 위에 코드 몇 KB 추가).

## 5. 남은 확인

- Aidot 봇의 용도(운영 중인지)와 콜백 승인이 그 봇에 적용됐는지(W6 전).
- 콜백 유효 시간·횟수 실측(W7).

## 6. 배포 결과 (2026-11-06)

- W1: PC `.local\relay\relay.secrets`(git 제외, 값은 출력하지 않음)에 비밀 값 2개 생성. W2: `~/deploy/ieon-gateway/relay/`에 파일 복사, `relay.secrets` 권한 600. W3: `docker compose build`·`up -d`로 이미지 `ieon-relay:0.0.1`·컨테이너 `ieon-relay` 기동(healthy, 호스트 포트 게시 없음, 새 이미지는 로컬 `node:22-alpine` 위에 빌드).
- W4: 신산님이 NPM에서 프록시 호스트 `ieun-gateway.sinsan.kr` → `http://ieon-relay:28770`, Let's Encrypt 인증서 등록(Online).
- W5 확인(이 PC 외부 접속): `GET /health` 200 `{"ok":true,"pc":false}`, 틀린 스킬 비밀 경로 404, `/` 404, 토큰 없는 `/pc/poll` 401, HTTP→HTTPS 301, 인증서 Let's Encrypt(CN=ieun-gateway.sinsan.kr, 만료 2027-02-03).
- 변경 범위: `~/deploy/ieon-gateway`·컨테이너 1개·이미지 1개·NPM 프록시 호스트 1개. 기존 서비스·DNS 변경 없음.
- **스킬 URL**(신산님이 오픈빌더에 입력): `https://ieun-gateway.sinsan.kr/kakao/skill/<IEON_RELAY_KAKAO_SECRET 값>` — 값은 `.local\relay\relay.secrets`에서 읽는다(채팅·문서에 쓰지 않음).
- **PC 쪽 설정(W7 전):** `.local\.env`에 `KAKAO_RELAY_TOKEN=<IEON_RELAY_PC_TOKEN 값>`, `.local\messenger\config.json`에 `"kakaoRelayUrl": "https://ieun-gateway.sinsan.kr"`.
- 되돌리기: NPM에서 프록시 호스트 삭제 → 서버에서 `cd ~/deploy/ieon-gateway/relay && docker compose down` → `docker rmi ieon-relay:0.0.1` → 폴더 삭제.

## 7. W6·W7 실측 결과 (2026-11-06)

- W6(오픈빌더 봇 테스트, 배포 없음): PC 꺼짐 상태에서 `안녕` → "PC 연결 끊김" 응답, 서버 로그 `pc_down` 1건.
- W7(PC 연결): 서버·연결부(실제 엔진 실행 켬)·메신저를 켜고 서버에 카카오 `default` 봇(이름 "카카오 Aidot 시험")을 웹 봇 관리 API로 등록, `.env`에 `KAKAO_RELAY_TOKEN`(신산님 입력), config에 `kakaoRelayUrl` 추가. 메신저 로그 `kakao started`, 중계 `/health`는 `pc:true`.
- 통과: `/whoami`(허용 전에는 "허용 목록에 없음", 사용자 키를 `allowedUsers.kakao`에 넣고 메신저를 다시 켠 뒤 "허용됨"), `/sessions`(Codex 시험 세션·Claude 시험 세션 2개), `/use 1`, `/status`("보낼 수 있음"), 실제 질문 "1+1은?" → `2`, 40문장 요청 → 답이 말풍선 3개로 나뉘어 전부 도착(줄임 안내 없음). 모든 응답은 카카오의 "잠시만 기다려 주세요" 뒤에 콜백으로 왔다.
- 모델 호출 **2회**(Codex 시험 thread `01a18790-63c7…`만, 승인 10회 중). 업무 대화·Claude 세션은 쓰지 않았다. 시험 후 `stop`으로 서버·연결부·메신저를 모두 끄고 live를 껐다.
- **미확인:** 콜백 유효 시간·횟수의 정확한 값, 응답까지 걸린 정확한 시간(두 질문 모두 사용자가 느끼기에 정상 범위), 실제 카카오톡 채널(배포 후) 대화, Claude 세션 경유.
- **추가 시험(같은 날, 콜백 제한 15초로 짧게 설정):** 150문장 요청 → 약 15초 뒤 "답이 오래 걸리고 있습니다. 끝나면 /last 를 보내 받아 보세요." 안내가 콜백으로 왔고, 답이 끝나기 전의 `/last`는 "보관된 답이 없습니다.", 끝난 뒤의 `/last`는 보관된 답을 말풍선 3개로 돌려주며 마지막에 "…(길어서 줄임 — 전체는 웹 화면에서 확인)"이 붙었다(115번 문장에서 줄임). 한 번 받은 뒤의 `/last`는 비었다. 이번 시험의 모델 호출 1회(카카오 시험 누적 3회), 콜백 전송 실패 0건. 시험 후 제한 시간 설정(`kakaoCallbackLimitMs`)은 제거하고 `stop`.
- **개선 완료(2026-11-06):** 답을 아직 만드는 중에 `/last`를 보내면 "아직 답을 만드는 중입니다. 잠시 뒤 /last 를 다시 보내 주세요."로 안내한다(사용자 키별로 진행 중인 질문 수를 센다). 단위 테스트 추가, 실제 카카오에서는 아직 확인하지 않음. 콜백 유효 시간의 정확한 값은 여전히 미측정(이번 시험은 로직 확인).

## 8. P2: 중계 호스트를 `ieon-gateway.sinsan.kr`로 이전 (계획, 2026-11-08)

결정(HUB_AND_PC_PROFILES 5절): `ieon-gateway.sinsan.kr`=PC 완결형(중계만), `ieun-gateway.sinsan.kr`=허브형. 지금 카카오 중계가 `ieun-gateway`를 쓰고 있으므로 `ieon-gateway`로 옮긴다.

### 8-1. 읽기 전용 확인 (2026-11-08, 변경 없음)

| 항목 | 결과 |
| --- | --- |
| DNS | 두 호스트 모두 `168.107.4.6`(Cloudflare 권한 서버·1.1.1.1·8.8.8.8), Cloudflare "DNS 전용" |
| `https://ieun-gateway.sinsan.kr/health` | 200 `{"ok":true,"pc":false}`(중계 정상, PC 미연결) |
| `http://ieon-gateway.sinsan.kr/health` | 404(NPM 기본, 프록시 호스트 없음) |
| `https://ieon-gateway.sinsan.kr` | TLS 연결 실패(인증서 없음) |
| 중계 코드의 호스트 의존 | 없음(`src/relay/relay.mjs`는 Host 헤더를 보지 않음) → **컨테이너·코드·비밀 값 변경 없이** NPM 프록시 호스트만 추가하면 된다 |

### 8-2. 단계 (모두 별도 승인)

| 단계 | 하는 일 | 누가 | 바뀌는 곳 |
| --- | --- | --- | --- |
| W8 | NPM에 프록시 호스트 추가: 도메인 `ieon-gateway.sinsan.kr` → 전달 `http` · `ieon-relay` · `28770`(W4와 같게), SSL 탭에서 Let's Encrypt 새 인증서·Force SSL·HTTP/2. 기존 `ieun-gateway` 호스트는 그대로 둔다 | 신산님(NPM 화면) | Oracle NPM 프록시 호스트 1개·인증서 1개 |
| W9 | 바깥에서 확인: `/health` 200, 틀린 스킬 비밀 경로 404, `/` 404, 토큰 없는 `/pc/poll` 401, HTTP→HTTPS 301, 인증서 CN=`ieon-gateway.sinsan.kr` | 어울(읽기만) | 없음 |
| W10 | PC가 새 주소로 접속: 웹 봇 관리 → 설정 → 카카오 중계 주소를 `https://ieon-gateway.sinsan.kr`로 저장(P1-a, 파일 값은 그대로 두어 되돌리기 쉬움) → 이 PC 이어온을 실제 실행 끔으로 켜고 메신저 시작 → `/health`의 `pc`가 true | 어울(신산님 승인) | 이 PC 서버 DB 설정 1건, 이어온 서버·메신저 기동 |
| W11 | 오픈빌더(Aidot 봇) 스킬 URL의 **주소 부분만** `ieun-gateway.sinsan.kr` → `ieon-gateway.sinsan.kr`로 바꿈(뒤의 `/kakao/skill/<비밀 값>`은 그대로) → 봇 테스트에서 `/whoami`·`/sessions` | 신산님(오픈빌더) | 카카오 스킬 URL 1개 |
| W12 | 마무리: 이 PC 이어온 `stop`, 결과 기록. `ieun-gateway`의 중계 프록시 호스트는 **P4(허브 배포) 때 허브용으로 바꾼다**(그때까지는 되돌리기용으로 남겨 둠) | 어울 | 없음 |

- 모델 호출 0(`/whoami`·`/sessions`만, 실제 실행 끔). 실제 질문까지 보려면 별도 승인(Codex 시험 thread 1회).
- W8·W11은 신산님 계정 화면 작업이라 어울이 대신하지 않는다. 비밀 값(스킬 경로·PC 토큰)은 채팅·문서에 쓰지 않는다.
- 두 호스트가 같은 컨테이너를 가리키는 동안에는 어느 주소로 들어와도 같은 중계라, W10과 W11의 순서가 바뀌어도 끊기지 않는다.

### 8-2-1. 진행 결과 (2026-11-08)

| 단계 | 결과 |
| --- | --- |
| W8 | **완료(신산님, NPM 화면 2026-11-07 생성).** `ieon-gateway.sinsan.kr` → `http://ieon-relay:28770`, Let's Encrypt, Online |
| W9 | **PASS(어울, 읽기만).** `ieon-gateway`: `/health` 200 `{"ok":true,"pc":false}`, `/` 404, 틀린 스킬 비밀 404, 토큰 없는 `/pc/poll` 401, HTTP→HTTPS 301, 인증서 CN=`ieon-gateway.sinsan.kr`(만료 2027-02-05) |
| 발견 | NPM의 `ieun-gateway.sinsan.kr`이 `http://ieun-relay:28770`(아직 없는 컨테이너)을 가리켜 **모든 경로 502**. 신산님이 허브용으로 미리 바꾼 것으로 보인다. 따라서 오픈빌더 스킬 URL이 아직 `ieun-gateway`면 카카오 봇이 응답하지 못하고, PC 파일 설정의 중계 주소(`ieun-gateway`)로는 연결되지 않는다 → W10·W11을 서둘러야 한다 |
| W10 | **PASS(신산님 승인, 2026-11-08).** 이 PC 서버가 꺼진 상태에서 DB 설정 `messenger.kakao`에 `validateKakao`를 거친 `{"relayUrl":"https://ieon-gateway.sinsan.kr"}`를 저장(웹 설정 P1-a와 같은 값·위치, 웹 토큰은 다루지 않음. 이전 값 없음=파일 값 사용 중이었음) → `ieon.ps1 start`(실제 실행 끔) → `messenger` → `https://ieon-gateway.sinsan.kr/health` = `{"ok":true,"pc":true}` |
| W11 | **PASS(신산님).** 오픈빌더 스킬 URL이 `https://ieon-gateway.sinsan.kr/kakao/skill/<비밀>`로 바뀐 것을 신산님 화면으로 확인. 카카오 `/whoami` 응답: 플랫폼 kakao, 봇 default(카카오 Aidot 시험), 허용 여부 "허용됨"(사용자 ID는 기록하지 않음). 모델 호출 0 |
| W12 | **완료.** `ieon.ps1 stop`(메신저·연결부·서버 종료, 실제 실행 끔), 로컬 28760 응답 없음 확인 |

되돌리기 보완: `ieun-gateway`가 이미 다른 대상을 가리키므로, W11을 되돌리려면 NPM의 `ieun-gateway` 전달 대상도 `ieon-relay`로 되돌려야 한다.

### 8-3. 되돌리기

- W11: 오픈빌더 스킬 URL의 주소를 `ieun-gateway.sinsan.kr`로 되돌림.
- W10: 웹 설정의 카카오 칸에서 "파일 값으로"(파일 값 `https://ieun-gateway.sinsan.kr`).
- W8: NPM에서 `ieon-gateway.sinsan.kr` 프록시 호스트 삭제(인증서 삭제는 선택). 컨테이너·`ieun-gateway` 호스트는 건드리지 않았으므로 그대로 동작.
