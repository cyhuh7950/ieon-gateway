# 이어온 메신저 설정 설명서 (텔레그램·디스코드·슬랙)

- 기준: 2026-11-05 main · 대상: 신산님
- 함께 보기: [사용 설명서](MANUAL.md)(서버·연결부·웹), [작업 기록](WORK_STATUS.md)

## 1. 구조 한눈에

```
신산님(메신저 대화방) ⇄ 메신저 봇 ⇄ 이어온 메신저 모듈(이 PC) ⇄ 이어온 서버 → 연결부 → Codex/Claude 세션
```

- 기본은 **메신저마다 봇 1개**(`default` 봇)이고, 대화방(채널·그룹·1:1)마다 세션 하나를 `/use`로 연결한다.
- 필요하면 **같은 메신저에 봇을 여러 개** 둘 수 있다(6.2). 봇마다 허용 사용자·볼 수 있는 세션·대화방 연결이 따로다. 어떤 용도로 나눌지는 신산님이 정한다.
- 세 메신저 모두 **봇이 이 PC에서 메신저 서버로 먼저 접속**한다(텔레그램 long polling, 디스코드 Gateway, 슬랙 Socket Mode). 그래서 공유기 포트·공개 주소·Tailscale이 필요 없다. 카카오톡은 이 방식을 지원하지 않아 공개 HTTPS 서버(Oracle 등)가 필요하고 지금은 제외한다.
- 로그인은 토큰 대신 **메신저 사용자 ID 허용 목록**이다. 목록 밖 사용자에게는 `/whoami` 외에 아무 응답도 하지 않는다.
- 질문 규칙은 웹과 같다: 사용 중이면 거절, 결과 불명이면 다시 보내지 않음, Codex 질문은 읽기 전용.

## 2. 관련 파일

| 파일 | 내용 | 누가 고치나 |
| --- | --- | --- |
| `.local\.env` | 봇 토큰. 기본 봇: `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_APP_TOKEN`(xapp-…), `SLACK_BOT_TOKEN`(xoxb-…). 추가 봇은 규칙 이름(6.2) | 신산님 직접(Claude·어울은 읽지 않음) |
| `.local\messenger\config.json` | 서버 주소, 이어온 접속 토큰 파일, 허용 사용자 ID(`allowedUsers`) | 신산님 또는 Claude(사용자 ID는 비밀 아님) |
| `.local\messenger\rooms.json` | 대화방 ↔ 세션 연결(`/use`가 자동 저장). 키는 `<메신저>:<봇 ID>:<대화방>`(옛 형식은 처음 켤 때 `default` 봇으로 자동 변환) | 자동 |
| 이어온 서버 DB(`.local\s2\pilot.db`) | 봇 목록·이름·역할·봇별 추가 허용 사용자(6.2) | 웹 봇 관리(M2) 또는 관리 API |
| `.local\run\messenger.log` | 기동·연결·메시지 도착 기록(토큰·질문·답 원문 없음) | 자동 |

`.local\`은 git에 올라가지 않는다. 토큰은 채팅·문서·스크린샷에 남기지 않는다.

## 3. 켜고 끄기

```powershell
cd D:\Project\ieon-gateway
pwsh scripts/ieon.ps1 start          # 서버·연결부(실제 엔진 실행 끔)
pwsh scripts/ieon.ps1 messenger      # 메신저 봇
pwsh scripts/ieon.ps1 stop           # 모두 끄기(봇 포함)
```

`messenger` 출력 예(`.local\run\messenger.log`, 토큰 값은 나오지 않는다):

```
{"event":"bots","bots":[{"bot":"telegram:default","state":"starting"},{"bot":"telegram:ieun01","state":"starting"},
  {"bot":"slack:ieun01","state":"token_missing","missing":["SLACK_BOT_IEUN01_APP_TOKEN","SLACK_BOT_IEUN01_BOT_TOKEN"]}]}
{"platform":"telegram","event":"started","bot":"@Test_cyhuh_01_bot","canReadAll":true,"botId":"default"}
{"platform":"telegram","event":"started","bot":"@ieun_cyhuh_bot","canReadAll":true,"botId":"ieun01"}
{"platform":"discord","event":"ready","bot":"코드리뷰","guilds":0,"invite":"https://discord.com/oauth2/authorize?client_id=…","botId":"ieun01"}
{"platform":"slack","event":"ready","bot":"ieonreview","team":"sinsan","botId":"ieun01"}
```

| 로그 | 뜻 | 할 일 |
| --- | --- | --- |
| `"bot":"<메신저>:<봇 ID>"` | 이어온이 아는 봇(서버에 등록된 봇) | — |
| `"state":"starting"` → 1분 뒤 `"connected"` | 연결 중 → 연결됨(상태는 1분마다 다시 보고) | — |
| `"state":"token_missing"`, `missing` | 그 이름의 토큰이 `.env`에 없거나 비어 있음 | `missing`에 나온 이름으로 `.env`에 넣고 메신저 다시 켜기 |
| `"state":"duplicate_token"` | 같은 토큰 값이 두 봇에 들어 있음(둘 다 안 켬) | 봇마다 다른 토큰으로 |
| `"canReadAll":false` | 텔레그램 그룹 일반 글을 못 받음 | 4.1의 `/setprivacy` → Disable |
| `"guilds":0` | 디스코드 봇이 아직 어느 서버에도 없음 | 4.2의 초대 |
- 토큰·공통 허용 목록(`config.json`)을 바꾼 뒤에는 `stop` → `start` → `messenger`로 다시 켠다. 서버에 등록한 봇 정보(이름·끄기·봇별 허용 사용자)는 1분 안에 저절로 반영된다.
- 실제 답을 받으려면 연결부의 실제 엔진 실행이 켜져 있어야 한다(`start -Live`, 모델 호출 승인 범위에서만). 꺼져 있으면 봇이 "연결부에서 실제 실행이 꺼져 있음"으로 답한다.

## 4. 메신저별 봇 만들기

### 4.1 텔레그램 (가장 쉬움)

1. 텔레그램에서 `@BotFather`를 열고 `/newbot`을 보낸다.
2. 표시 이름과 사용자 이름(끝이 `bot`, 예: `Test_cyhuh_01_bot`)을 정하면 토큰이 나온다.
3. `.env`에 `TELEGRAM_BOT_TOKEN=<토큰>`을 넣는다.
4. 봇 찾기: 텔레그램 검색에서 `@사용자이름`을 찾거나 기동 로그의 `open` 링크를 연다. **시작(Start)**을 누른다. 대화 목록에 봇이 일반 대화처럼 보인다.
5. 그룹에서 쓰려면: BotFather에서 `/setprivacy` → 봇 선택 → **Disable**(그래야 그룹의 일반 글을 봇이 읽는다). 성공하면 "Success! The new status is: DISABLED."가 나온다. 그룹에 봇을 초대한다. 그룹의 **주제(Topic)**마다 다른 세션을 연결할 수 있다.
   - **이미 그룹에 들어가 있던 봇은 내보냈다가 다시 넣어야** 바뀐 설정이 그 그룹에 적용된다.
   - 적용 여부는 메신저 로그의 `"canReadAll":true`로 확인한다(메신저를 다시 켜면 다시 읽음).

### 4.2 디스코드

1. https://discord.com/developers/applications → **New Application** → 이름 입력.
2. 왼쪽 **Bot** → **Reset Token**으로 토큰 발급 → `.env`의 `DISCORD_BOT_TOKEN`.
3. 같은 **Bot** 화면에서 **Message Content Intent**를 켠다(꺼져 있으면 메시지 내용을 못 읽는다). 한국어 화면에서는 "메시지 콘텐츠 인텐트".
4. 봇을 내 서버에 초대: 기동 로그의 `invite` 링크를 열거나, **OAuth2 → URL Generator**(한국어 "OAuth2 URL 생성기")에서 고른다.
   - 스코프: `bot` 하나
   - 봇 권한: `View Channels`(채널 보기)·`Send Messages`(메시지 보내기)·`Read Message History`(메시지 기록 보기) 세 개
   - 연동 유형: `Guild Install`(길드 설치)
   - 아래 **생성된 URL**을 복사해 브라우저에서 열고 서버를 골라 승인한다. 로그의 `guilds`가 1 이상이면 들어간 것이다.
5. 봇 찾기: 봇은 채널 목록이 아니라 **멤버 목록**(채널 화면 오른쪽 위 사람 모양 아이콘)에 보인다.
   - 채널에서 쓰기: 그 채널에 바로 글을 쓴다.
   - 1:1로 쓰기: 멤버 목록에서 봇을 누르고 메시지를 보내면 왼쪽 위 **다이렉트 메시지**에 봇 대화방이 생긴다.
6. 연결이 가끔 끊기면(`closed`, code 1006) 2초 뒤 자동으로 다시 붙는다. 4004는 토큰 오류, 4014는 Message Content Intent 꺼짐이며 자동 재접속하지 않는다.

### 4.3 슬랙

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**를 고른다. Claude/OpenAI 같은 AI 에이전트 템플릿이나 Slack CLI(`slack create`) 예제는 쓰지 않는다(아래 주의 참고).
2. 워크스페이스 선택 → 형식 **YAML** → 아래를 붙여넣고 Create.

```yaml
display_information:
  name: ieon
  description: 이어온 — 이 PC의 작업 세션에 질문을 전달합니다
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: ieon
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write
      - channels:history
      - groups:history
      - im:history
settings:
  event_subscriptions:
    bot_events:
      - message.channels
      - message.groups
      - message.im
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

3. **Basic Information → App-Level Tokens → Generate Token and Scopes**: 이름 `socket`, scope `connections:write` → `xapp-…` → `.env`의 `SLACK_APP_TOKEN`.
4. **Install App → Install to <워크스페이스>** → **Bot User OAuth Token**(`xoxb-…`) → `.env`의 `SLACK_BOT_TOKEN`.
5. 봇 쓰기:
   - 1:1: 왼쪽 사이드바 **Apps**에서 앱을 열고 **Messages** 탭에 쓴다(안 보이면 **+ Add apps**에서 검색).
   - 채널: 채널 화면 맨 위의 채널 이름(`# bot` 등) → 채널 정보 창의 **Agents & apps** 탭(예전 화면은 Integrations) → **Add agents and apps**로 추가. 또는 채널 입력창에 `/invite @앱이름` — 표시 이름이 정확해야 하므로 자동 완성 목록에서 고른다.
6. 슬랙에서는 `/`로 시작하는 글을 슬랙이 가로채므로 이어온 명령은 **`!`로 시작**한다(`!whoami`, `!sessions`, `!use 1` …).

**Socket Mode란**: 슬랙이 우리 공개 주소로 이벤트를 보내는 대신, 봇이 슬랙으로 먼저 접속해 연결을 유지하며 메시지를 받는 방식이다. 이 PC에 공개 주소가 있어도 포트를 열 필요가 없어 더 안전하다. App-Level Token(`xapp`)은 이 접속용, Bot Token(`xoxb`)은 답장용이다.

**주의 — 같은 앱에 다른 프로그램이 붙으면 메시지가 나뉜다**: Socket Mode는 같은 앱에 연결이 여러 개면 메시지를 그중 하나에만 보낸다. 2026-10-31에는 Slack CLI 예제(`D:\slack\my-app`에서 `slack run`, 앱 이름 `my-app (local)`)가 같은 앱에 붙어 있어 1:1 대화를 그 예제가 가져가 엉뚱하게 답했다. 이어온 봇이 쓰는 슬랙 앱에서는 `slack run` 같은 다른 프로그램을 실행하지 않는다. 가장 확실한 방법은 위 manifest로 이어온 전용 앱을 만드는 것이다.

## 5. 처음 연결하기(공통 순서)

1. 봇 토큰을 `.env`에 넣고 `start` → `messenger`.
2. 각 메신저에서 봇에게 `/whoami`(슬랙 `!whoami`)를 보낸다. 답: 플랫폼·사용자 ID·대화방·허용 여부.
3. 사용자 ID를 `.local\messenger\config.json`의 `allowedUsers`에 넣는다(예: `"telegram": ["7253893482"]`). Claude에게 ID를 알려 주면 대신 넣는다.
4. `stop` → `start` → `messenger`로 다시 켠다.
5. `/sessions`로 목록을 보고 `/use <번호>`로 이 대화방을 세션에 연결한다. 이후 일반 글은 그 세션에 질문으로 간다.

| 명령(슬랙은 `!`) | 동작 |
| --- | --- |
| `/whoami` | 내 사용자 ID·대화방·허용 여부(허용 전에도 동작) |
| `/sessions` | 연결 가능한 세션과 상태(보낼 수 있음·처리 중·엔진 꺼짐·확인 필요·PC 연결 끊김) |
| `/use <번호>` | 이 대화방을 그 세션에 연결(대화방마다 따로 저장) |
| `/status` | 연결된 세션 상태 |
| `/review done` · `/review not` | 결과 불명 질문을 원래 세션 확인 결과로 정리(다시 보내지 않음) |
| `/new codex|claude <이름>` | 새 세션을 만들고 이 대화방에 연결(새 세션 기능을 켠 경우, 6.4) |
| `/sleep`·`/archived`·`/restore`·`/close`·`/limits` | 새 세션 잠재우기·보관 목록·꺼내기·삭제·한도(6.4) |
| `/help` | 명령어 목록 |

## 6. 추가하기

### 6.1 대화방을 더 만들어 다른 세션에 연결

봇을 늘리지 않는다. 새 대화방을 만들고 같은 봇을 넣은 뒤 `/use <번호>`만 하면 된다.

- 텔레그램: 새 그룹(또는 그룹의 새 주제)에 봇 초대 → `/use`.
- 디스코드: 서버에 새 채널(예: `#claude-개발`) → 봇이 서버에 있으므로 바로 `/use`.
- 슬랙: 새 채널 → **Integrations → Add an App** → `!use`.

### 6.2 같은 메신저에 봇 추가(여러 봇)

> 이 절은 **여러 봇 기능 진행 중(M2-W까지 완료)** 상태 기준이다. 봇 등록·이름·부르는 이름·역할·볼 수 있는 세션은 **웹 화면의 봇 관리**에서 한다(④). 역할의 엔진·권한 제한과 AI 역할 안내, 봇에서 만든 새 세션의 소속은 M3에서 적용된다.

같은 봇을 다른 디스코드 서버·슬랙 워크스페이스에 넣는 것은 봇을 늘리는 것이 아니다(그 서버·워크스페이스에 초대·설치만 하면 된다). 아래는 **봇을 하나 더 만드는** 방법이다.

**① 봇 ID 정하기**

봇 ID는 이어온이 봇을 구분하는 이름표다. 영문 소문자·숫자·`-` 2~32자이고 **한 번 정하면 바꾸지 않는다**(토큰 변수 이름·대화방 연결이 여기에 묶임). 사람이 보는 이름·부르는 이름은 웹 봇 관리에서 따로 정한다. 지금 쓰는 봇의 봇 ID는 `default`다. 아래 예는 봇 ID `ieun01`.

| 이름 | 예 | 정하는 곳 |
| --- | --- | --- |
| 메신저 쪽 이름 | 텔레그램 `@ieun_cyhuh_bot`, 디스코드 `코드리뷰`, 슬랙 `ieon-review` | 각 메신저(신산님) |
| 봇 ID | `ieun01` | 이어온(신산님이 정해 등록) |
| 표시 이름·역할·부르는 이름 | `코드 리뷰 봇`, `리뷰` | 웹 봇 관리 |

**② 메신저에서 봇(앱) 만들기**

봇(앱)마다 토큰이 따로다. 같은 토큰을 두 봇이나 두 프로그램에 쓰지 않는다.

- 텔레그램: 4.1처럼 `@BotFather` → `/newbot`(이미 만든 봇은 `/mybots` → 봇 → API Token). 그룹에서 쓰면 `/setprivacy` → Disable.
- 디스코드: 4.2처럼 **New Application**을 하나 더 만든다(앱 하나에 봇 하나). Message Content Intent 켜기, OAuth2 URL로 서버에 초대.
- 슬랙: 4.3처럼 **From an app manifest**로 앱을 하나 더 만든다. manifest는 **처음부터 끝까지 전체**를 붙이고 `name`과 `display_name` 두 곳만 바꾼다(일부만 붙이면 오류가 나고 Socket Mode가 꺼진다).

  ```yaml
  display_information:
    name: ieon-review
    description: 이어온 — 이 PC의 작업 세션에 질문을 전달합니다
  features:
    app_home:
      home_tab_enabled: false
      messages_tab_enabled: true
      messages_tab_read_only_enabled: false
    bot_user:
      display_name: ieon-review
      always_online: true
  oauth_config:
    scopes:
      bot:
        - chat:write
        - channels:history
        - groups:history
        - im:history
  settings:
    event_subscriptions:
      bot_events:
        - message.channels
        - message.groups
        - message.im
    interactivity:
      is_enabled: false
    org_deploy_enabled: false
    socket_mode_enabled: true
    token_rotation_enabled: false
  ```

  App-Level Token은 이름 `socket`, scope `connections:write` 하나(`xapp-…`). Install App 후 Bot User OAuth Token(`xoxb-…`).

**③ 토큰을 `.local\.env`에 규칙 이름으로 넣기**(신산님 직접, 채팅에 붙이지 않는다)

| 메신저 | 변수 이름 규칙 | 봇 ID `ieun01` 예 |
| --- | --- | --- |
| 텔레그램 | `TELEGRAM_BOT_<ID>_TOKEN` | `TELEGRAM_BOT_IEUN01_TOKEN` |
| 디스코드 | `DISCORD_BOT_<ID>_TOKEN` | `DISCORD_BOT_IEUN01_TOKEN` |
| 슬랙 | `SLACK_BOT_<ID>_APP_TOKEN`(xapp-…), `SLACK_BOT_<ID>_BOT_TOKEN`(xoxb-…) | `SLACK_BOT_IEUN01_APP_TOKEN`, `SLACK_BOT_IEUN01_BOT_TOKEN` |

- `<ID>`는 봇 ID를 대문자로, `-`를 `_`로(`code-review` → `CODE_REVIEW`).
- 기본 봇(`default`)은 지금 이름(`TELEGRAM_BOT_TOKEN` 등)을 그대로 쓴다.
- 자주 하는 실수: 슬랙 순서를 `SLACK_APP_<ID>_TOKEN`처럼 바꿔 쓰기, 봇 ID 철자가 메신저마다 다름(`IEUN01`/`EUN01`), `xapp`·`xoxb` 값 뒤바뀜, 값이 비어 있음.

**④ 이어온에 봇 등록(웹 봇 관리)**

1. 웹 화면(`http://127.0.0.1:28760`)에 들어가 위쪽 오른쪽 **봇 관리**를 누른다(웹 토큰으로 접속했을 때만 보인다).
2. **봇 목록** 아래에서 메신저를 고르고 **새 봇 ID**를 넣는다. 입력하는 동안 넣어야 할 **토큰 변수 이름**이 보인다. **봇 추가**.
3. 목록에서 그 봇을 누르면 편집 칸이 열린다.
   - **이름**: 이어온에서 쓰는 이름(한글 가능)
   - **역할**: 역할 목록에서 고름(없어도 됨)
   - **부르는 이름**: 쉼표로 구분(예: `리뷰, 리뷰봇`). 같은 메신저의 다른 봇과 겹치면 저장되지 않는다. 비워 두면 봇 ID로 부른다.
   - **추가 허용 사용자**: 이 봇에만 더 허용할 메신저 사용자 ID(쉼표 구분)
   - **볼 수 있는 기존 세션**: 이 봇의 `/sessions`에 보일 세션을 체크
   - **켜기**: 끄면 메신저가 이 봇을 띄우지 않는다
   - **토큰 변수**·**상태**: 넣어야 할 토큰 이름과 메신저가 보고한 상태(연결됨·토큰 없음·토큰 중복·실제 봇 이름·텔레그램 그룹 일반 글 수신 꺼짐)
4. **저장** → 메신저에 1분 안에 반영된다(새 토큰을 넣었으면 메신저를 다시 켠다).
5. **역할 목록**: 역할 ID·이름·설명·만들 수 있는 엔진·허용 권한(읽기 전용·작업 폴더 안 읽기·쓰기)·AI 역할 안내·기본 세션을 정해 **역할 저장**. 쓰는 봇이 있는 역할은 지울 수 없다.

같은 일을 관리 API로도 할 수 있다(PowerShell, 이어온 서버가 켜져 있을 때).

```powershell
$h = @{ Authorization = "Bearer $((Get-Content D:\Project\ieon-gateway\.local\s2\user-token -Raw).Trim())" }
$body = [Text.Encoding]::UTF8.GetBytes('{"name":"ieun01 시험 봇"}')
foreach ($p in 'telegram', 'discord', 'slack') {
  Invoke-RestMethod "http://127.0.0.1:28760/v1/admin/bots/$p/ieun01" -Method Put -Headers $h -ContentType 'application/json; charset=utf-8' -Body $body
}
```

- 주소의 마지막이 봇 ID다. 메신저마다 따로 등록한다(같은 ID여도 메신저가 다르면 다른 봇).
- 끄기: 본문을 `{"name":"…","enabled":false}`로. 지우기: `-Method Delete`. `default` 봇은 지울 수 없다.
- 봇에게만 추가로 허용할 사용자: `{"name":"…","extraUsers":["<메신저 사용자 ID>"]}`(공통 허용 목록에 더해짐).
- 부르는 이름: `{"name":"…","callNames":["리뷰","리뷰봇"]}`(한글 가능, 같은 메신저의 다른 봇과 겹치면 거절). 지정하지 않으면 봇 ID(`ieun01`)로 부른다.

**⑤ 메신저 다시 켜고 확인**

```powershell
pwsh scripts/ieon.ps1 stop
pwsh scripts/ieon.ps1 start
pwsh scripts/ieon.ps1 messenger
```

- 3절 표대로 로그에서 봇마다 `connected`·`started`·`ready`를 확인한다.
- 그 봇에게 `/whoami`(슬랙 `!whoami`) → **봇 ID**와 **대화방** 키(`<메신저>:<봇 ID>:<대화방>`)가 봇마다 다르게 나오면 정상이다.
- 봇마다 `/sessions`가 다르게 나온다: 기존 세션은 서버 등록의 `appIds`에 그 봇(`app_bot_<메신저>_<봇 ID>`)이 있어야 보인다. 기본 봇은 지금처럼 `app_messenger`.

**⑥ 같은 방에 봇이 여러 개일 때(M2)**

| 상황 | 누가 답하나 |
| --- | --- |
| 1:1 대화 | 그 봇 |
| 그룹·채널에서 **부른** 글 | 부른 봇만. 부르기: 부르는 이름으로 시작(`리뷰, …`·`리뷰: …`·`리뷰야 …`·`@리뷰 …`), 메신저 멘션(`@ieun_cyhuh_bot`·`@코드리뷰`·슬랙 `@ieon-review`), 그 봇 메시지에 답장, 텔레그램 `/명령@봇username` |
| 그룹·채널에서 **부르지 않은** 글 | 그 방에서 세션에 연결된 우리 봇이 하나뿐이면 그 봇. 둘 이상 연결돼 있으면 **아무도 답하지 않음** |
| 아무 봇도 연결 안 된 방 | 부르지 않으면 두 봇이 함께 답할 수 있다 → 처음에는 부르는 이름·멘션으로 `/use`한다 |

- 부르는 이름은 떼고 나머지만 질문·명령으로 보낸다(`리뷰, /use 1` → `/use 1`).
- 역할에 기본 세션이 있으면 연결이 없는 방에서 첫 글을 받을 때 그 세션에 자동 연결하고 알린다.
- `/whoami`·`/help`에 봇 이름·역할·부르는 이름이 나온다.

### 6.3 다른 사람(또는 내 다른 계정) 허용

그 사람이 `/whoami`로 확인한 ID를 `allowedUsers`에 추가하고 다시 켠다. 허용된 사람은 연결된 세션에 질문할 수 있으므로 신산님 본인 계정만 넣는 것을 원칙으로 한다.

### 6.4 메신저에서 새 세션 만들기

이어온이 새 Codex·Claude 세션을 만들어 주는 기능이다. 먼저 [따라 하기 설명서](BEGINNER_GUIDE.md) 6-A-1로 기능을 켠다.

| 명령(슬랙은 `!`) | 하는 일 |
| --- | --- |
| `/new codex <이름>`, `/new claude <이름>` (끝에 `read_only` 가능) | 새 세션을 만들고 이 대화방에 연결 |
| `/sleep <이름>` | 바로 잠재우기(질문하면 다시 깨어남) |
| `/archived`, `/restore <이름>` | 보관 목록, 보관에서 꺼내기 |
| `/close <이름>` → `/close <이름> 확인` | 삭제(이어온 기록만, 되돌릴 수 없음) |
| `/limits` | 새 세션 수와 한도 |

- `full`(명령 실행·인터넷) 권한은 메신저에서 고를 수 없다.
- `/sessions`에는 새 세션 상태(첫 질문 전·깨어 있음·잠듦)가 함께 나오고, 보관된 세션은 빠진다.
- 보관 3일 전부터 하루 한 번, 그 세션에 연결된 대화방에 예고를 보낸다. 메신저 봇을 다시 켠 뒤 그 대화방에서 아직 아무 말도 없었으면 예고를 보내지 못한다.

### 6.5 기존 세션(Codex 대화·Claude 세션)을 봇 목록에 추가

봇 목록(`/sessions`)은 이어온 서버에 등록된 세션이다.

1. `.local\s2\server.json`의 `bindings`에 항목을 추가한다.
   ```json
   { "conversationId": "c_codex_work2", "label": "보여 줄 이름", "ownerUserId": "u_sinsan",
     "appIds": ["app_web", "app_messenger"], "hostId": "h_sinsan",
     "engine": "codex_thread", "sessionRef": "<Codex 대화 ID>" }
   ```
   `appIds`에 `app_messenger`가 있어야 메신저에서 보인다.
2. Codex 대화면 `.local\s2\connector.json`에도 넣는다.
   - `codex.allowlist`에 대화 ID 추가(없으면 실행 거부).
   - `codex.workingDirectories`에 `"<대화 ID>": "<원래 작업 폴더>"` 추가(없으면 이어온 폴더에서 실행됨).
   - 업무 대화 `01a0dadd-739f-74d2-93c5-9c405cc1019b`는 넣지 않는다(코드에서도 거부).
3. `stop` → `start` → `messenger` 후 `/sessions`에 보이는지 확인.

## 7. 문제 해결

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| 메신저 앱에서 봇이 안 보임 | 봇을 대화 목록에 불러오지 않음 | 텔레그램: `@이름` 검색·Start / 디스코드: 서버 멤버 목록 / 슬랙: Apps 또는 채널 Integrations |
| 봇이 아무 답도 안 함 | 허용 목록에 없음, 봇 미기동, 디스코드 Message Content Intent 꺼짐, 텔레그램 그룹 privacy 켜짐 | `/whoami`로 허용 여부 확인, `messenger.log` 확인 |
| 슬랙 1:1에서 엉뚱한 답 | 같은 앱에 다른 프로그램(`slack run` 등)이 접속 | 그 프로그램 종료 또는 이어온 전용 앱 생성 |
| `/invite @이름` → "A valid member name is required" | 표시 이름과 다름 | 자동 완성에서 고르거나 Integrations → Add an App |
| "연결부에서 실제 실행이 꺼져 있음" | 연결부 live 꺼짐 | 승인 범위에서 `stop` → `start -Live` → `messenger` |
| "Desktop에서 이 대화를 열고 있어 보내지 않았음" | 번갈아 쓰기 대화를 Codex 앱이 열고 있음 | 앱에서 그 대화를 닫고 다시 질문 |
| "엔진 꺼짐"(Claude) | Claude 채널 세션 미실행 | `pwsh scripts/ieon.ps1 claude` |
| "결과를 확인할 수 없음" | 결과 불명 | 원래 세션 확인 후 `/review done` 또는 `/review not` |
| 같은 세션에 여러 메신저에서 동시에 질문 → 하나만 처리 | 세션당 한 번에 하나 | 답을 받은 뒤 다음 질문 |
| 추가 봇이 안 켜짐(로그 `token_missing`) | 토큰 이름이 규칙과 다르거나 값이 비어 있음 | `missing`에 나온 이름 그대로 `.env`에 넣고 메신저 다시 켜기 |
| 추가 봇이 아예 로그에 없음 | 이어온 서버에 그 봇을 등록하지 않았거나 꺼져 있음 | 웹 봇 관리에서 추가·켜기(6.2 ④) |
| 같은 채널에서 두 봇이 함께 답함 | 그 방에 아직 어느 봇도 세션에 연결되지 않음 | 부르는 이름·멘션으로 각 봇을 `/use` |
| 그룹에서 아무 봇도 답하지 않음 | 두 봇이 모두 연결돼 있는데 부르지 않음 | 부르는 이름·멘션으로 부르기 |
| 텔레그램 그룹에서 봇이 일반 글에 반응 안 함 | privacy 켜짐, 또는 설정을 바꾼 뒤 그룹에 다시 넣지 않음 | `/setprivacy` → Disable 후 그룹에서 봇을 내보냈다가 다시 추가 |
| 디스코드 추가 봇이 채널에 없음(로그 `guilds`:0) | 서버에 초대하지 않음 | 4.2의 OAuth2 URL로 초대 |
| 슬랙 채널에 `my-app (local)`이 답함 | 예전 Slack CLI 예제(`slack run`)가 같은 앱에 붙음 | 그 프로그램 끄기, 채널 **Agents & apps**에서 그 앱 제거 |
| `/new`에 "새 세션 만들기가 꺼져 있음" | 기능 꺼짐 | [따라 하기 설명서](BEGINNER_GUIDE.md) 6-A-1 → `stop` → `start -Live` → `messenger` |
| `/close` 링크를 눌렀더니 같은 안내만 다시 나옴 | 텔레그램이 `/close`만 링크로 만든다 | `/close <이름> 확인`을 직접 입력 |
| 보관 예고가 안 옴 | 봇을 다시 켠 뒤 그 대화방에서 아직 아무 말도 없음 | 그 방에 아무 메시지나 한 번 보내 두기 |

## 8. 확인 상태(2026-10-31 · 2026-11-05 갱신)

| 항목 | 상태 |
| --- | --- |
| 텔레그램 1:1: `/whoami`·`/sessions`·`/use`·실제 Codex 답 | 확인 |
| 디스코드 채널: 같은 흐름·실제 Codex 답 | 확인 |
| 디스코드 1:1 | 지원, 미확인 |
| 슬랙 채널(`#bot`): 같은 흐름·실제 Codex 답 | 확인(예제 앱 토큰 사용 중) |
| 슬랙 1:1 | 예제 앱과 충돌로 미동작 → 전용 앱으로 재확인 필요 |
| 메신저에서 Claude 세션 | 미확인 |
| 텔레그램 그룹·주제 | 미확인 |
| **여러 봇(2026-11-05, M1):** 텔레그램 `default` `@Test_cyhuh_01_bot`·`ieun01` `@ieun_cyhuh_bot`, 디스코드 `default` `Test_bot`·`ieun01` `코드리뷰`, 슬랙 `default` `ieon`·`ieun01` `ieon-review` 동시 연결 | 확인 |
| 디스코드·슬랙 같은 채널에서 두 봇 `/whoami` → 봇 ID·대화방 키가 봇마다 다름 | 확인 |
| 텔레그램 `/setprivacy` Disable 후 `canReadAll` true | 확인 |
| 같은 방에서 부른 봇만 답하기(M2): 디스코드 `/whoami`·`@코드리뷰 /whoami`·`ieun01, /whoami`·`ieun01, /sessions`, 슬랙 `!whoami`·`@ieon-review !whoami`·`ieun01, !whoami`·`@ieon-review !sessions` | 확인(2026-11-06, 보완 후) |
| 웹 봇 관리 화면(M2-W): 역할·봇 추가·편집·부르는 이름 중복 거절·볼 수 있는 세션 | 시험 서버에서 확인 |
| 텔레그램 1:1 새 세션(2026-11-05): `/new codex`·질문·`/sessions`·`/sleep`·`/limits`·`/close` 확인 단계 | 확인 |
| 메신저에서 Claude 새 세션, 디스코드·슬랙 `/new`, 보관 예고 실제 전달 | 미확인 |
