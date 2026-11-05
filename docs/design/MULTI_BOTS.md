# 여러 봇·Teams·카카오톡 연결 설계

- 상태: **설계 확정안 · 구현 승인 전.** 신산님이 확인하면 WORK_PLAN에 단계를 올리고 M0부터 구현한다.
- 작성: 2026-11-05 · 요청: 신산님 · 근거: 2026-11-05 인터뷰(9절) · 관련: [DESIGN](DESIGN.md), [NEW_SESSIONS](NEW_SESSIONS.md), [메신저 설명서](../MESSENGER_MANUAL.md)

## 1. 목표

1. **같은 메신저에서 봇 여러 개를 동시에 운영한다**(텔레그램·디스코드·슬랙). 어떤 용도로 봇을 나눌지는 사용자가 정한다. 이어온은 봇마다 허용 사용자, 볼 수 있는 세션, 대화방 연결을 따로 관리하는 틀만 제공한다.
2. **Teams를 연결한다**(개인 Microsoft 계정, Teams 무료). 연결 방식은 여러 봇과 같은 구조로 만든다.
3. **카카오톡**은 설계에 포함하되 **구현은 승인 후**에 한다(채널 개설·콜백 승인 필요).

진행 순서: 여러 봇(M0~M3) → 공개 수신 중계(M4) → Teams(M5) → 카카오톡(M6, 승인 후).

## 2. 지금 하나만 되는 이유(바꿀 곳)

| 위치 | 지금 | 바꾼 뒤 |
| --- | --- | --- |
| `messenger/main.mjs` | `.env`에서 메신저마다 정해진 이름의 토큰 하나만 읽어 봇 하나를 켬 | `config.json`의 `bots` 목록대로 봇마다 연결을 띄움 |
| `rooms.json` | 키 `<메신저>:<대화방>` | 키 `<메신저>:<봇ID>:<대화방>[:<주제>]` |
| 허용 사용자 | 메신저 단위 `allowedUsers` | 공통 + 봇별 추가 |
| 서버 토큰 | 모든 봇이 `app_messenger` 하나 | 봇마다 서버 앱 ID `app_bot_<봇ID>`와 토큰 |

## 3. 설정

**봇 등록은 설정 파일로만 한다.** 봇 토큰은 `.local\.env`에만 두고, 설정에는 토큰이 들어 있는 **변수 이름**만 적는다. 추가·삭제한 뒤에는 `messenger`를 다시 켠다.

`.local\messenger\config.json`:

```json
{
  "serverUrl": "http://127.0.0.1:28760",
  "envFile": "D:/Project/ieon-gateway/.local/.env",
  "roomsPath": "D:/Project/ieon-gateway/.local/messenger/rooms.json",
  "allowedUsers": { "telegram": ["7253893482"], "discord": ["…"], "slack": ["…"] },
  "bots": [
    { "id": "main", "platform": "telegram", "tokenEnv": "TELEGRAM_BOT_TOKEN",
      "serverTokenFile": "D:/Project/ieon-gateway/.local/messenger/token" },
    { "id": "review", "platform": "telegram", "tokenEnv": "TELEGRAM_BOT_TOKEN_REVIEW",
      "serverTokenFile": "D:/Project/ieon-gateway/.local/messenger/bots/review.token",
      "allowedUsers": ["123456789"] },
    { "id": "work", "platform": "slack", "appTokenEnv": "SLACK_APP_TOKEN_WORK", "botTokenEnv": "SLACK_BOT_TOKEN_WORK",
      "serverTokenFile": "D:/Project/ieon-gateway/.local/messenger/bots/work.token" }
  ]
}
```

| 항목 | 뜻 |
| --- | --- |
| `id` | 봇 구분 이름(영문·숫자·`-`, 메신저 안에서 중복 불가). 서버 앱 ID는 `app_bot_<id>` |
| `platform` | `telegram` · `discord` · `slack` · `teams`(M5) · `kakao`(M6) |
| `tokenEnv` / `appTokenEnv`·`botTokenEnv` | `.env`의 토큰 변수 이름(슬랙은 두 개) |
| `serverTokenFile` | 이 봇이 이어온 서버에 접속하는 토큰 파일. 서버 `server.json` `users`에는 그 해시와 `appId: app_bot_<id>`를 등록 |
| `allowedUsers` | 이 봇에만 추가로 허용할 사용자(공통 목록에 더해짐) |

- **봇 수 제한은 두지 않는다.** 설정에 적은 만큼 켠다.
- 같은 토큰을 두 봇에 쓰면 시작할 때 거부한다(메신저가 같은 토큰의 동시 수신을 막거나 메시지를 나눠 보내기 때문).
- 봇 추가 도우미: `pwsh scripts/ieon.ps1 add-bot <id> <platform>`. 서버 토큰을 만들어 `server.json`에 해시를 등록하고 `config.json`에 봇 항목을 추가한다. 메신저 봇 토큰은 신산님이 `.env`에 직접 넣는다.

### 3-1. 기존 설정 자동 전환

`bots`가 없으면 지금처럼 동작한다. 메신저마다 `.env`의 기본 토큰 이름(`TELEGRAM_BOT_TOKEN` 등)이 있으면 그 메신저의 `default` 봇으로 보고, 서버 토큰은 기존 `userTokenFile`(`app_messenger`)을 쓴다. `rooms.json`의 옛 키 `<메신저>:<대화방>`는 처음 읽을 때 `<메신저>:default:<대화방>`로 바꿔 저장한다. **설정을 바꾸지 않아도 지금과 같이 동작한다.**

## 4. 세션 범위(봇별 서버 앱 ID)

봇마다 서버 앱 ID를 따로 두고, 세션 `bindings[].appIds`(기존 세션) 또는 새 세션 등록 시 정해지는 `appIds`로 어느 봇이 볼 수 있는지 정한다. 웹·메신저·내 프로그램을 구분하는 지금 방식을 그대로 쓴다.

| 세션 | 보이는 곳 |
| --- | --- |
| 기존 세션 연결(사람이 `server.json`에 등록) | `appIds`에 적은 앱. 봇에 보이게 하려면 `app_bot_<id>`를 넣는다(`default` 봇은 기존 `app_messenger`) |
| 봇에서 `/new`로 만든 새 세션 | **만든 봇 + 웹**(`app_bot_<id>`, `app_web`) |
| 웹에서 만든 새 세션 | 웹 + `new-sessions.json` `creatorApps`의 메신저 앱(지금과 같음) |

- 새 세션 `creatorApps`에 봇 앱 ID를 하나씩 적지 않아도 되게, `creatorApps`에 `"app_bot_*"`(모든 봇) 표기를 허용한다.
- 다른 봇에서 만든 세션은 `/sessions`에 나오지 않고, 이름으로 `/sleep`·`/close`해도 "없음"으로 나온다.

## 5. 대화방 동작

- **연결은 봇마다 따로** 저장한다. 같은 그룹에 봇 A·B가 있으면 A는 세션 X, B는 세션 Y에 연결할 수 있다.
- **그룹·채널에서는 부른 봇만 답한다.** 부르기:
  - `@봇` 멘션
  - 그 봇이 보낸 메시지에 답장
  - 텔레그램 `/명령@봇이름`
- 그 방에 우리 봇이 **하나뿐이면** 지금처럼 부르지 않아도 받는다. 봇은 같은 방의 다른 우리 봇을 알 수 없으므로, "하나뿐"은 그 방에서 연결(`/use`·`/new`)된 우리 봇이 하나인지로 판단한다(같은 메신저의 모든 봇이 한 프로세스라 `rooms.json`으로 확인 가능).
- **1:1 대화**는 그 봇이 항상 답한다.
- `/whoami`는 봇 ID와 서버 앱 ID도 보여 준다.

## 6. Teams·카카오톡 공개 수신 중계(M4)

Teams와 카카오톡은 메신저 쪽이 **공개 HTTPS 주소로 메시지를 보내는** 방식이다. 이 PC는 지금처럼 공개 포트를 열지 않는다.

```
Teams(Azure Bot) / 카카오 오픈빌더 ──HTTPS──▶ Oracle 중계(ieon-gateway.sinsan.kr)
                                                  ▲ 대기 중 메시지 보관(짧게), 서명 검증
                                                  │ PC가 먼저 접속(긴 대기 폴링·웹소켓)해 가져감
                                          SINSAN PC 메신저 봇 프로세스 → 이어온 서버
```

- 중계는 **메시지 전달만** 한다. 질문 원문은 PC가 가져가면 바로 지우고 로그에 남기지 않는다. 이어온 서버·DB·토큰은 PC에 그대로 둔다.
- 메신저 서명 검증(Teams Bot Framework JWT, 카카오 스킬 요청 확인)은 중계에서 하고, 중계↔PC는 별도 토큰으로 인증한다.
- PC가 꺼져 있으면 중계가 "PC 연결 끊김"으로 바로 답한다(카카오 5초 제한).
- Oracle `ieon-gateway.sinsan.kr`(A 레코드 확인됨)에 TLS·reverse proxy를 둔다. **Oracle 배포·포트·방화벽 변경은 후보와 되돌리는 방법을 제시하고 별도 승인 후 진행한다.**

## 7. Teams(M5)

- 개인 Microsoft 계정(Teams 무료)에서 쓴다. Azure에 Bot 리소스를 만들고 Teams 채널을 켠다. 메시지 수신 주소는 6절 중계.
- 봇은 `bots`에 `platform: "teams"`로 등록한다(앱 ID·비밀번호 변수 이름). 봇별 범위·대화방 동작은 4·5절과 같다.
- **확인 필요(M5 시작 전):** 개인용 Teams에서 사용자 지정 봇을 대화에 추가하는 것이 허용되는지(조직용 Teams처럼 앱 업로드가 되는지). 안 되면 Teams 범위를 다시 정한다. 신산님이 이전에 한 Teams 연결 시험 방법을 이때 확인한다.
- Azure 계정·Bot 등록·비밀번호 발급은 신산님이 직접 한다.

## 8. 카카오톡(M6, 승인 후)

- 카카오톡 채널(비즈니스 채널)을 개설하고 카카오 i 오픈빌더에서 봇을 만들어 스킬 서버로 6절 중계를 등록한다.
- 스킬 요청에는 **5초 안에** 답해야 하므로, AI 답은 **콜백(AI 챗봇 콜백) 기능**으로 나중에 보낸다. 콜백은 오픈빌더 신청·승인이 필요하다. 승인 전에는 "접수됨"만 바로 답하고 결과는 "/status"로 확인하는 방식이 가능하다.
- 사용자 구분은 카카오가 주는 봇 사용자 키로 하고, 허용 사용자는 `/whoami`로 확인해 등록한다.
- **구현은 채널 개설·콜백 승인 후 신산님 승인을 받고 시작한다.**

## 9. 인터뷰 기록 (2026-11-05, 신산님)

| 질문 | 답 |
| --- | --- |
| 용도 | 봇을 어떤 용도로 나눌지는 사용자가 정한다. 설계는 그 틀을 제공 |
| 봇 등록 방법 | 설정 파일(`config.json` `bots`), 토큰은 `.env` |
| 봇별 허용 사용자 | 공통 + 봇별 추가 |
| 세션 범위 | 봇별 서버 앱 ID로 구분 |
| 봇에서 만든 새 세션 | 만든 봇 + 웹 |
| 같은 방에 봇 여러 개 | 봇마다 따로 연결, 부른 봇만 답 |
| 부르는 방법 | 멘션·답장·`/명령@봇`, 1:1은 항상 |
| 봇 수 | 제한 없음 |
| 기존 설정 | 기본(`default`) 봇으로 자동 전환 |
| 메신저 범위 | 텔레그램·디스코드·슬랙 + Teams(신산님이 연결 시험한 적 있음) |
| Teams 계정 | 개인 Microsoft 계정(Teams 무료) |
| 공개 수신 주소 | Oracle 서버에 중계 서버 |
| 카카오톡 | 설계에 포함, 구현은 승인 후 |
| 순서 | 여러 봇 먼저 |
| 시험 봇 | 신산님이 만들고 토큰을 `.env`에 |
| 모델 호출 | 엔진별 10회 새로 승인 |

## 10. 구현 단계와 검증

| 단계 | 내용 | 완료 기준 |
| --- | --- | --- |
| M0 | 설정 `bots` 읽기·검사(중복 토큰·ID 거부), 기본 봇 자동 전환, `rooms.json` 키 변환, `add-bot` 도우미(모델 0) | 단위 테스트: 기존 설정만으로 지금과 같이 동작, 옛 키 변환, 중복 거부 |
| M1 | 봇별 연결 실행(텔레그램·디스코드·슬랙), 봇별 서버 토큰·허용 사용자 | 대역 메신저로 봇 2개 동시 수신·응답, 허용 사용자 분리 |
| M2 | 대화방 동작: 봇별 연결, 그룹에서 부른 봇만 답, `/whoami` 봇 표시 | 대역으로 같은 방 두 봇 시험 |
| M3 | 세션 범위: 봇별 앱 ID, `/new` 세션은 만든 봇+웹, `creatorApps`의 `app_bot_*` | 서버 테스트 + **실제 텔레그램 봇 2개** 시험(신산님이 두 번째 봇 생성) |
| M4 | Oracle 공개 수신 중계 | **별도 승인 후**: 후보·되돌리기 제시 → 배포 → 서명 검증·PC 끊김 응답 시험 |
| M5 | Teams 연결 | 개인 Teams 봇 추가 가능 여부 확인 → Azure Bot 등록(신산님) → 질문·답 |
| M6 | 카카오톡 | 채널 개설·콜백 승인 후 **별도 승인** |

- 모델 호출: 이번 실증용으로 **Codex·Claude 각 10회 새로 승인**(2026-11-05). 대부분은 모델 없이 시험하고, 실제 답 확인에만 쓴다.
- 시험은 시험용 세션·봇만 쓴다. 업무 대화 `01a0dadd-…`는 건드리지 않는다.
