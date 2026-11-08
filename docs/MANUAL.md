# 이어온 사용 설명서 (요약판)

- 기준: 2026-11-08(웹 중심 재설계 W0~W8·미검증 시험 반영) · 대상: 신산님
- 원칙: **모든 설정은 웹 화면에서, 토큰은 이어온이 내부에서 처리한다.** 사용자가 설정 파일을 고치거나 토큰을 옮기지 않는다([WEB_FIRST](design/WEB_FIRST.md)).
- 형태: PC 완결형(내 PC의 `http://127.0.0.1:28760`)과 허브형(`https://ieun-gateway.sinsan.kr` + PC 연결).
- 기능 두 가지: **기존 세션 연결**(이 PC에 이미 있는 Codex 대화·Claude Code 세션에 질문)과 **새 세션 만들기**(이어온이 새 Codex·Claude 세션과 작업 폴더를 만듦, 기본 꺼짐).
- 처음이라면 [따라 하기 설명서](BEGINNER_GUIDE.md)(설치·설정 포함), 내 프로그램 연결은 [개발 프로그램 연동 설명서](API_GUIDE.md)를 본다.
- 판정 근거: [첫 실증 결과서](validation/FIRST_CONTINUITY_RESULT.md), 설계: [DESIGN](design/DESIGN.md)

## 1. 이어온이 하는 일

이어온은 웹 화면에서 보낸 질문을 **이미 쓰고 있는 작업 세션**에 넣고 그 세션의 답을 돌려준다. 새 대화를 만들거나 대화를 복사하지 않는다.

| 엔진 | 연결 방식 | 사람이 보는 화면 |
| --- | --- | --- |
| Codex · 번갈아 쓰기(`alternate`, 기본) | 질문마다 같은 대화를 SDK로 다시 열어 이어 쓰고 바로 놓는다 | Codex Desktop(필요할 때) |
| Codex · 동시 사용(`shared_server`) | 공유 App Server 하나에 사람(TUI)과 이어온이 함께 붙는다 | 공식 Codex TUI |
| Claude Code · 채널 | 실행 중인 Claude Code 세션에 이어온 채널로 질문을 넣고 `reply`로 답을 받는다 | Claude Code 터미널 |

구성은 세 부분이다.

- **이어온 서버**(`127.0.0.1:28760`): 웹 화면·API, 대화와 요청 상태 보관.
- **연결부**: 이 PC에서 서버로 먼저 접속해 질문을 가져가 엔진에 넣는다. 외부에 포트를 열지 않는다.
- **엔진**: Codex 대화, 공유 App Server(`28761`), Claude 채널(`28762`).

## 2. 처음 한 번 준비

[따라 하기 1절](BEGINNER_GUIDE.md): 이어온 폴더에서 `pwsh scripts/install.ps1` 한 번. 부품 설치·설정과 내부 토큰 생성·로그온 자동 시작·바탕화면 바로 가기까지 한다. 설정·토큰은 `.local\`(git 제외)에 있고 화면에 나오지 않는다. **업무 대화 `01a0dadd-…`는 허용 목록에 넣지 않는다**(코드에서도 거부).

## 3. 켜고 끄기

- 이어온은 **로그온하면 창 없이 자동으로 켜진다**(작업 스케줄러 `ieon-gateway`). 서버가 연결부와 메신저를 함께 띄우고, 하나가 끝나면 다시 띄운다.
- AI 호출은 **봇 관리 → 이 PC 탭 → 실제 실행 켜기**로만 켜고 끈다(이 PC에서 연 화면만, 켤 때 확인).
- Codex 허용 대화·연결 방식·작업 폴더도 같은 칸에서 추가·빼기. 바꾸면 연결부가 새 설정으로 다시 시작한다.
- 완전히 끄기(자동 시작도 해제): `pwsh scripts/install.ps1 -Uninstall`(설정·기록은 남음).
- 다시 켜기·새 버전 적용: `pwsh scripts/install.ps1`(설정과 토큰은 그대로, 새 코드로 다시 시작).
- PC를 끄면 함께 꺼지고, 다음 로그온 때 자동으로 켜진다. 설치부터 지우기까지의 순서는 [따라 하기](BEGINNER_GUIDE.md) 10절.
- 로그: `.local\run\server.log`(질문·답변·토큰 원문은 남기지 않는다).

### 허브에 연결하기(허브형)

1. 이 PC 화면 **봇 관리 → 이 PC 탭 → 허브에 연결**: 허브 주소와 이 PC 이름 → "연결" → 6자리 코드.
2. 허브 화면 **봇 관리 → 기기 탭 → 연결 요청**: 같은 코드면 **승인**(같은 PC를 다시 연결하면 "기존 기기 대체").
3. 승인되면 토큰은 허브에서 이 PC로 내부 전달되고, 이 PC 서버가 허브용 연결부를 띄운다. 재부팅 뒤에도 자동으로 다시 연결된다. "연결 끊기"·"다시 연결"·"허브 잊기"는 같은 칸에서.
- 허브 연결 중에는 이 PC 서버가 자기 작업을 내주지 않는다(같은 PC가 두 서버의 질문을 함께 실행하지 않게).
- 실제 답을 받으려면 이 PC 화면의 실제 실행이 켜져 있어야 한다.
- 이 PC의 안전 설정(허용 목록·실제 실행·작업 폴더)은 허브에서 바꿀 수 없다.
- 허브 주소는 `https`만 받는다. 허브는 기기마다 1분 240번까지 받고 넘으면 429(연결부는 기다렸다 다시 묻고, 질문을 다시 보내지 않음).

### Claude 채널 세션

```powershell
pwsh scripts/ieon.ps1 claude
```

새 창에서 `claude --dangerously-load-development-channels server:ieon`이 시작된다.

- 구독 계정(Pro/Max)으로 로그인돼 있어야 한다. 처음이면 그 창에서 `/login`을 신산님이 직접 한다. 비구독 계정은 연결되지 않고, API 키 로그인은 유료 경로이므로 쓰지 않는다.
- 하단이 `manual mode`인지 확인한다. `auto mode`면 `shift+tab`으로 끈다.
- 이 창에는 질문을 직접 입력하지 않는다(입력해도 이어온으로 답이 가지 않는다).
- 끝낼 때 `/exit`. 세션이 꺼지면 채널도 꺼진다.

### Codex 동시 사용(TUI, 고급)

공유 App Server와 Codex TUI를 함께 띄우는 개발용 기능이라 아직 웹 화면이 없다. 보통은 "번갈아 쓰기"를 쓴다. 쓰려면 먼저 `pwsh scripts/install.ps1 -Uninstall`로 자동 시작을 내린 뒤(연결부가 둘이 되지 않게) 아래를 실행하고, 끝나면 `stop` 후 `pwsh scripts/install.ps1`로 되돌린다.

```powershell
pwsh scripts/ieon.ps1 start -Shared
pwsh scripts/ieon.ps1 tui
```

- 이 모드의 대화는 **Codex Desktop 앱에서 열지 않는다**(잠금 충돌).
- hook 확인 화면이 나오면 "Continue without trusting"을 고른다.

## 4. 웹 화면 쓰기

1. 바탕화면 **이어온**(또는 `http://127.0.0.1:28760`)을 연다. 이 PC에서 연 화면은 자동 로그인된다. 허브는 관리자 비밀번호로 로그인한다(처음에는 "관리자 만들기").
2. 왼쪽 목록에서 세션을 고른다. 배지로 엔진을 구분한다(`Codex · thread`, `Claude · 채널`).
3. 질문을 입력하고 **보내기**. "접수됨 — 답을 기다리는 중" 뒤에 답이 표시된다.

### 목록의 상태 문구

| 문구 | 뜻 | 할 일 |
| --- | --- | --- |
| 보낼 수 있음 | 엔진 준비됨 | 질문 가능 |
| 처리 중 | 이 세션의 질문이 실행 중 | 끝날 때까지 기다림 |
| PC 연결 끊김 | 연결부가 꺼져 있음 | 그 PC가 켜져 있는지, 허브형이면 PC 화면 "허브에 연결"이 연결됨인지 |
| 세션 꺼짐 | Claude 채널 세션이 꺼져 있음 | Claude 채널 세션 시작(위 "Claude 채널 세션") |
| 공유 서버 꺼짐 | 동시 사용 모드인데 공유 App Server가 꺼짐 | 번갈아 쓰기로 전환(이 PC 설정) |

### Codex 연결 모드 바꾸기

Codex 세션을 고르면 "Codex 연결 모드"가 보인다.

- **번갈아 쓰기**: Desktop과 이어온 중 한쪽만 쓰거나 이어온 전용 대화일 때. 보낼 때 그 대화가 Desktop에서 열려 있으면 "Desktop에서 이 대화를 열고 있어 보내지 않았음"으로 거절된다. 앱은 켜져 있어도 되고 **그 대화만 닫으면** 된다. Desktop에는 대화를 다시 열 때 이어온 질문·답이 보인다.
- **동시 사용**: 사람(TUI)과 이어온이 앱 종료 없이 같은 대화를 쓴다. 이어온 질문·답이 TUI에 바로 보인다.
- 처리 중이거나 확인이 필요한 질문이 있으면 모드를 바꿀 수 없다.

### 휴대폰에서 쓰기(Tailscale)

- **권장: 휴대폰에서는 허브형을 쓴다**(허브 웹 "보안"에서 접속 제한). 아래 PC 직접 공개는 고급 설정이라 아직 웹 화면이 없고 관리자가 설치 때 설정 파일에 넣는다: `extraHosts`(이 PC Tailscale 주소)·`extraAllowedClients`(휴대폰 Tailscale 주소)를 두면 그 주소에서도 열린다. Tailscale 주소(100.64.0.0/10)만 허용되며 0.0.0.0·집 와이파이 주소로는 열리지 않는다. 허용 목록 밖 기기는 403.
- 휴대폰에서 Tailscale을 켜고 `http://<이 PC Tailscale 주소>:28760`을 연다. 통신은 Tailscale이 암호화한다.
- 쓰지 않을 때는 두 항목을 지우거나 `stop`으로 끈다.

### 메신저에서 쓰기(텔레그램·디스코드·슬랙)

자세한 봇 만들기·추가·문제 해결은 [메신저 설정 설명서](MESSENGER_MANUAL.md)를 본다.

봇은 메신저마다 여러 개 둘 수 있다(봇 관리). 대화방(텔레그램 그룹·주제, 디스코드 채널, 슬랙 채널)마다 세션 하나를 연결하거나, 봇과의 1:1 대화에서 `/use`로 대상 세션을 고른다. 모두 이 PC에서 메신저로 먼저 접속하므로 공개 주소·Tailscale이 필요 없다. 카카오톡은 공개 중계(PC 완결형) 또는 허브(허브형)를 거친다.

1. **봇 관리**에서 그 메신저의 봇을 고르고 편집 칸 **토큰**에 봇 토큰을 넣는다(저장한 값은 다시 보이지 않음). 1분 안에 연결된다.
2. 메신저에서 봇에게 아무 말이나 보내고, **메신저·카카오 탭 → 허용 요청**에 뜨면 **허용**. 허용 목록 밖 사용자에게는 `/whoami` 외에 응답하지 않는다.
3. 카카오톡은 **메신저·카카오 탭 → 카카오 스킬 URL**의 복사 버튼 값을 오픈빌더 스킬 URL에 붙인다.
4. 명령어: `/sessions`, `/use <번호>`(이 대화방을 세션에 연결), `/status`, `/review done|not`(확인 필요 정리), `/help`. 그 밖의 글은 연결된 세션에 질문으로 간다. 슬랙에서는 `/` 대신 `!`(예: `!sessions`)를 쓴다.

메신저별 준비:

- 텔레그램: BotFather `/newbot`. 그룹에서 쓰려면 BotFather `/setprivacy` → Disable(또는 1:1 대화만 사용).
- 디스코드: Developer Portal → Bot → **Message Content Intent** 켜기, OAuth2 URL Generator(bot, Send Messages·Read Message History)로 내 서버에 초대.
- 슬랙: 앱 생성 시 AI 연결(Claude/OpenAI) 템플릿이 아니라 **From scratch**. Socket Mode 켜기(App-Level Token `connections:write` → xapp), Bot Token Scopes `chat:write`·`channels:history`·`groups:history`·`im:history`, Event Subscriptions의 bot events `message.channels`·`message.groups`·`message.im`, App Home의 Messages 탭 허용, 워크스페이스에 설치(xoxb) 후 채널에 앱 초대.

### 개발 프로그램에서 쓰기(HTTP API)

자세한 따라 하기·예제(PowerShell·Node·Python·curl)는 [개발 프로그램 연동 설명서](API_GUIDE.md)를 본다.

직접 만든 프로그램은 웹 화면·메신저 봇과 같은 HTTP API를 부른다. 엔진을 직접 부르지 않는다. 서버에 질문을 접수하면 연결부가 가져가 Codex 대화·Claude 채널 세션에 넣고, 프로그램은 결과를 조회한다.

- 주소: `http://127.0.0.1:28760`(Tailscale 허용 기기는 `http://<이 PC Tailscale 주소>:28760`).
- 인증: 모든 `/v1/` 요청에 `Authorization: Bearer <API 키>`. 키가 틀리거나 폐기됐으면 401.
- API 키는 **봇 관리 → 외부 프로그램 탭**에서 프로그램마다 발급한다(한 번만 보임). 그 프로그램이 볼 세션을 체크해 저장하고, 필요 없어지면 폐기. 설정 파일은 고치지 않는다.

| 요청 | 하는 일 | 응답 |
| --- | --- | --- |
| `GET /v1/conversations` | 세션 목록 | `conversationId`·`label`·`engine`·`deviceOnline`·`busy`·`engineReady`·`heldBy` |
| `POST /v1/conversations/<id>/requests` | 질문 접수 | 202 `{"requestId"}` |
| `GET /v1/requests/<requestId>` | 결과 조회 | `status`·`answer`·`errorCode`·`usage` |
| `POST /v1/requests/<requestId>/review` | 확인 필요 정리, 본문 `{"executed": true\|false}` | 정리된 `status` |
| `GET /v1/conversations/<id>/messages` | 그 세션의 이어온 질문·답 기록 | `messages` |
| `DELETE /v1/conversations/<id>/messages` | 기록 삭제 | 204 |
| `PUT /v1/conversations/<id>/settings` | Codex 연결 모드, 본문 `{"connectMode": "alternate"\|"shared_server"}` | `connectMode` |

질문 접수에는 `Idempotency-Key` 헤더가 필요하다(영문·숫자·`_`·`-` 8~64자, 질문마다 새 값). 같은 키를 다시 보내면 새로 실행하지 않는다. 네트워크 오류로 접수 결과를 모를 때는 **같은 키로** 다시 보낸다.

```powershell
$token = $env:IEON_API_KEY   # 웹에서 발급한 키를 내 프로그램 환경 변수에 둔다
$h = @{ Authorization = "Bearer $token" }
$base = 'http://127.0.0.1:28760'
Invoke-RestMethod "$base/v1/conversations" -Headers $h
$r = Invoke-RestMethod "$base/v1/conversations/c_claude_test/requests" -Method Post -ContentType 'application/json' `
  -Headers ($h + @{ 'Idempotency-Key' = "myapp-$([guid]::NewGuid())" }) -Body (@{ question = '안녕' } | ConvertTo-Json)
do { Start-Sleep 2; $s = Invoke-RestMethod "$base/v1/requests/$($r.requestId)" -Headers $h } while ($s.status -in 'queued', 'dispatching', 'running')
$s
```

결과 `status` 처리:

- `completed`: `answer`가 답이다.
- `failed`: `errorCode`를 보고 원인을 고친 뒤 새 키로 다시 보낼 수 있다.
- `unknown`·`approval_required`: **자동으로 다시 보내지 않는다.** 원래 세션에서 확인한 뒤 `review`로 정리한다("확인 필요 정리"와 같다). 정리 전까지 그 세션은 잠긴다.

접수 오류: 400 `bad_request`(키·질문 누락, 질문 길이 초과), 404 `not_found`(없거나 허용되지 않은 세션), 503 `device_unavailable`(연결부 꺼짐), `session_not_running`(Claude 세션 꺼짐), `shared_server_down`(공유 App Server 꺼짐), 409 `conversation_busy`(처리 중·확인 필요 잠금), `idempotency_conflict`(같은 키에 다른 질문).

실제 답을 받으려면 **이 PC 탭 → 실제 실행 켜기**를 켜야 하고, Claude 세션은 채널 세션을 띄워 둔다. 기존 Codex 대화는 **이 PC 탭**의 허용 목록과 **기존 세션 등록**에 먼저 넣는다.

### 새 세션 만들기

이어온이 새 Codex·Claude 세션과 전용 작업 폴더를 만드는 기능(기본 꺼짐). 켜기는 **봇 관리 → 새 세션 탭**, 설계는 [NEW_SESSIONS](design/NEW_SESSIONS.md).

- 웹 **새 세션 만들기**, 메신저 `/new codex|claude <이름>`, API `POST /v1/sessions`.
- 정리: 30분 유휴 잠듦(질문하면 깨어남) → 14일 미사용 보관(꺼내야 질문 가능) → 삭제는 이름 확인. 웹 잠재우기·보관함·삭제 버튼, 메신저 `/sleep`·`/archived`·`/restore`·`/close`·`/limits`.
- 기본 권한은 작업 폴더 안 읽기·쓰기. `full`(명령 실행·네트워크)은 안전을 위해 화면에서 고를 수 없다.

### 봇 관리(여러 봇)

웹 화면 위쪽 **봇 관리**에서 메신저 봇 목록·이름·부르는 이름·역할·볼 수 있는 기존 세션·추가 허용 사용자·켜기를 정한다. 봇 토큰도 같은 화면의 토큰 칸에서 넣는다(다시 보이지 않음). 자세한 순서는 [메신저 설정 설명서](MESSENGER_MANUAL.md) 6.2.

## 5. 결과가 이상할 때

| 화면 안내 | 원인 | 할 일 |
| --- | --- | --- |
| Desktop에서 이 대화를 열고 있어 보내지 않았음 | 번갈아 쓰기인데 Desktop이 대화를 잡고 있음 | Desktop에서 그 대화를 닫고 다시 보냄 |
| 공유 서버에서 이 대화가 사용 중이라 보내지 않았음 | 동시 사용 중 사람이 TUI에서 처리 중 | TUI 답이 끝난 뒤 다시 보냄 |
| 세션이 실행 중이 아님 | Claude 채널 세션 꺼짐 | `claude`로 세션 시작 |
| 연결부에서 실제 실행이 꺼져 있음 | 실제 실행 꺼짐 | 웹 "이 PC 탭 → 실제 실행 켜기" |
| 결과를 확인할 수 없음 | 전송 후 결과를 받지 못함(끊김·시간 초과) | 아래 "확인 필요 정리" |
| 처리 중에 TUI 입력이 합류해 답이 섞였을 수 있음 | 동시 사용 중 이어온 처리 도중 TUI에서 Enter로 입력함 | TUI 화면에서 결과 확인 후 "확인 필요 정리" |
| 원래 세션에서 권한 확인이 필요해 멈춤 | 모델이 도구·파일 작업을 시작하려 함 | 원래 세션에서 처리 후 "확인 필요 정리" |

### 확인 필요 정리

결과를 모르는 질문은 같은 세션을 잠근다(같은 질문이 두 번 실행되는 것을 막기 위해서다). 이어온은 **절대 자동으로 다시 보내지 않는다.**

1. 원래 세션 화면(Desktop·TUI·Claude 터미널)에서 그 질문이 실행됐는지 본다.
2. 웹에서 그 세션을 고르면 노란 안내와 버튼 두 개가 나온다.
   - **원래 세션에서 실행된 것을 확인함**: 실행된 것으로 닫는다. 받지 못했거나 섞였을 수 있는 답은 저장하지 않는다.
   - **실행되지 않은 것을 확인함**: 실행 안 된 것으로 닫는다. 필요하면 질문을 직접 다시 보낸다.
3. 정리하면 잠금이 풀린다.

## 6. 꼭 지킬 것

- 동시 사용 모드에서 이어온이 처리 중일 때 TUI에 입력하려면 **Enter가 아니라 Tab(대기열)**을 쓴다. Enter는 진행 중인 이어온 답에 합류해 답을 바꾼다(실측).
- 동시 사용 모드의 대화는 Desktop에서 열지 않는다.
- Claude 채널 지시에 "도구 금지"라고 쓰면 `reply`까지 막혀 답이 이어온으로 오지 않는다. 채널은 "reply 외 도구 금지"로 동작하게 만들어져 있다.
- 이어온에서 온 Codex 질문은 **읽기 전용·승인 없음·네트워크/웹 차단**으로 실행된다. 파일 변경·명령 실행이 필요하면 원래 세션에서 사람이 직접 한다.
- 실제 실행(`-Live`)·로그인·포트·설정 변경은 승인 범위에서만 한다. 토큰·인증 파일을 복사·출력·공유하지 않는다.
- 업무 대화 `01a0dadd-739f-74d2-93c5-9c405cc1019b`는 대상이 아니다.

## 7. 알려진 제한

- 접속은 이 PC, 허용한 Tailscale 기기, 허용한 메신저 사용자만 된다. 카카오톡·공개 인터넷 접속은 없다.
- 동시 사용 모드의 사람 화면은 Desktop 창이 아니라 TUI다.
- Claude Code 2.1.314에서는 채널 `reply`가 권한 확인 없이 실행될 수 있다(원인 미확인, `reply`는 채널 답장만 가능).
- 새 세션: Claude 새 세션은 질문마다 `claude -p`로 실행한다(채널·터미널 창이 필요 없음). 사람이 같은 세션을 터미널에서 열어 둔 채 질문하면 결과 불명(`session_forked`)으로 멈춘다.
- 새 세션 `workspace` 권한은 파일 쓰기만 하고 명령 실행·인터넷은 막는다. `full`은 작업 폴더 안에서 명령을 실행할 수 있지만 명령으로 폴더 밖을 건드리는 것까지 운영체제 수준에서 막지는 않는다(Oracle 배포 전 재검토).
- 새 세션 보관 예고는 그 세션에 연결된 메신저 대화방으로 간다. 메신저 봇을 다시 켠 뒤 그 방에서 아직 아무 말도 없었으면 보내지 못한다.
- 텔레그램은 안내 문구 속 `/close`를 링크로 바꾼다. 링크를 누르면 확인 없이 같은 안내가 다시 나온다. 삭제는 `/close <이름> 확인`을 직접 입력해야 한다.
- 새 세션이 "잠듦"이어도 프로세스를 끈 것이 아니라 상태 표시다(질문이 없을 때는 원래 프로세스가 없다).
- Codex 실행마다 "unrecognized configuration setting(`computer_use.windows.always_allowed_app_ids`)" 경고가 하나 뜬다. 실행에는 영향이 없다.
- 결과 불명 정리는 사람 확인 방식이다. 원래 세션 기록과 자동 대조하는 기능은 없다.
- 공유 App Server(`codex app-server --listen`)는 Codex의 실험 기능이며 버전 0.165.0 기준으로 확인했다.

## 8. 개발 작업 절차(참고)

작업 branch는 최신 `origin/main`에서 주체별 접두어로 만든다(Codex `codex/<목적>`, Claude Code `claude/<목적>`). commit·push 후 `pr-request/<branch 최신 sha>/<branch>` 태그(현재 main 가리킴)를 push하면 자동 PR로 병합된다. 병합 확인 → main에서 `node --test tests/pilot/*.test.mjs` → branch·작업 폴더 정리 후 다음 작업. 자세한 규칙은 [AGENTS.md](../AGENTS.md).

## 부록. 개발·문제 해결용 명령

보통은 쓰지 않는다. 설치(`install.ps1`)로 띄운 이어온과 함께 쓰지 말고, 쓰기 전에 `pwsh scripts/install.ps1 -Uninstall`로 자동 시작을 내린다.

```powershell
pwsh scripts/ieon.ps1 start [-Shared] [-Live]   # 서버·연결부를 직접 띄움(개발용)
pwsh scripts/ieon.ps1 status                    # 포트·실제 실행·시험 대화 잠금
pwsh scripts/ieon.ps1 check                     # 설치 점검(모델 호출 없음)
pwsh scripts/ieon.ps1 stop
```