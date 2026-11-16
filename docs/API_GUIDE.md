# 개발 프로그램 연동 설명서 (HTTP API)

- 기준: 2026-11-12(새 화면 U1~U7 반영) · 대상: 직접 만든 프로그램에서 이어온을 통해 Codex·Claude 세션에 질문하려는 개발자
- 먼저 [처음 쓰는 사람을 위한 따라 하기 설명서](BEGINNER_GUIDE.md) 1~4장으로 이어온을 설치하고 웹 화면에서 질문이 되는지 확인한다. 이 문서는 그다음 단계다.
- 기존 세션에 질문하는 API는 1~7장, 이어온이 새 세션을 만드는 API는 8장 "새 세션 만들기"에 있다.

---

## 1. 동작 원리

내 프로그램은 AI 엔진을 직접 부르지 않는다. **이어온 서버에 질문을 맡기고, 나중에 결과를 찾아간다.**

```
내 프로그램 ──① 질문 접수(POST)──▶ 이어온 서버 ◀── 연결부가 가져감 ──▶ Codex / Claude 세션
     │                                  │
     └──② 결과 조회(GET, 반복) ─────────┘
```

1. 질문을 보내면 서버가 바로 **접수 번호(`requestId`)** 를 돌려준다. 이때는 아직 답이 없다.
2. 몇 초마다 그 번호로 결과를 조회한다.
3. 상태가 `completed`가 되면 `answer`에 답이 들어 있다.

이렇게 나눈 이유: AI 답은 수십 초 이상 걸릴 수 있고, 같은 질문이 두 번 실행되면 안 되기 때문이다.

---

## 2. 준비

### 2-1. 이어온 켜기

설치(`pwsh scripts/install.ps1`, [따라 하기 1절](BEGINNER_GUIDE.md)) 뒤에는 이어온이 자동으로 켜져 있다. 실제 답을 받으려면 이 PC 화면에서 AI 응답(실제 실행)을 켠다. 웹에서 첫 질문을 보낼 때 **켜고 보내기**를 누르거나, 대화 위쪽 **AI 응답** 스위치(또는 **설정 → 이 PC**의 "실제 실행 켜기")로 켠다. 웹에서 한 번 켜기 전에는 API 질문도 실행되지 않는다(끈 상태에서는 접수·조회는 되지만 결과가 `failed`(`live_disabled`)로 끝난다). Claude 세션에 질문하려면 그 Claude 채널 세션을 켜 둔다.

### 2-2. 내 프로그램 전용 API 키 받기

웹 화면 왼쪽 아래 **설정**(⚙) → **내 프로그램 연결**에서 프로그램 이름을 넣고 **키 발급**을 누른다. 키는 **그때 한 번만** 보이니 복사해 내 프로그램 설정(환경 변수 등)에 넣는다. 같은 칸에서 이 프로그램이 볼 수 있는 세션을 체크하고 **저장**한다. 필요 없어지면 **폐기**(바로 접속 불가, 다른 프로그램은 영향 없음). 설정 파일은 고치지 않는다.

### 2-3. 연결 확인

```powershell
$token = $env:IEON_API_KEY   # 발급한 키를 넣어 둔 환경 변수
Invoke-RestMethod http://127.0.0.1:28760/v1/conversations -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 5
```

세션 목록이 나오면 성공이다. `401`이 나오면 키가 틀렸거나 폐기됐고, 목록이 비어 있으면 2-2에서 세션을 체크하지 않은 것이다.

---

## 3. 기본 규칙

| 항목 | 값 |
| --- | --- |
| 주소 | `http://127.0.0.1:28760` (같은 PC에서만). Tailscale 허용 기기는 `http://<PC Tailscale 주소>:28760` |
| 인증 | 모든 요청에 헤더 `Authorization: Bearer <토큰>` |
| 데이터 형식 | 요청·응답 모두 JSON, `Content-Type: application/json` |
| 질문 길이 | 최대 8,000자 |

**보안 주의**

- 토큰을 소스 코드에 직접 쓰지 않는다. 파일이나 환경 변수에서 읽는다.
- 토큰·질문·답을 내 프로그램 로그에 남기지 않는다.
- 이어온은 인터넷에 공개하지 않는다. 외부 서버에서 부르려면 Tailscale을 쓴다.

---

## 4. API 목록

| 요청 | 하는 일 | 성공 응답 |
| --- | --- | --- |
| `GET /v1/conversations` | 내가 쓸 수 있는 세션 목록 | 200 `{ conversations: [...] }` |
| `POST /v1/conversations/{id}/requests` | 질문 접수 | 202 `{ requestId }` |
| `GET /v1/requests/{requestId}` | 결과 조회 | 200 `{ requestId, status, answer, errorCode, usage }` |
| `POST /v1/requests/{requestId}/review` | 결과 불명 질문 정리 | 200 `{ requestId, status, errorCode }` |
| `GET /v1/tasks?filter=active\|all` | 작업(질문 단위) 목록 — 미리보기만, 새것부터 | 200 `{ tasks: [...] }` |
| `GET /v1/tasks/{requestId}` | 작업 하나 — 질문·승인과 실행 결과·답(완료일 때) | 200 작업 |
| `GET /v1/approvals` | 기다리는 승인 모아 보기 | 200 `{ approvals: [...] }` |
| `POST /v1/requests/{requestId}/stop` | 그 질문만 멈추기 | 200 `{ status: "cancelled" }`(시작 전) · 202 `{ status: "stopping" }`(실행 중) |
| `GET /v1/conversations/{id}/messages` | 이어온에서 주고받은 기록 | 200 `{ messages: [...] }` |
| `DELETE /v1/conversations/{id}/messages` | 기록 삭제 | 204 |
| `PUT /v1/conversations/{id}/settings` | Codex 연결 모드 변경 | 200 `{ connectMode }` |

### 4-1. 세션 목록

```http
GET /v1/conversations
Authorization: Bearer <토큰>
```

```json
{
  "conversations": [
    {
      "conversationId": "c_claude_main",
      "label": "Claude 채널 세션",
      "engine": "claude_channel",
      "deviceOnline": true,
      "busy": false,
      "engineReady": true
    }
  ]
}
```

| 필드 | 뜻 |
| --- | --- |
| `conversationId` | 질문할 때 쓰는 세션 이름 |
| `engine` | `claude_channel`(Claude) 또는 `codex_thread`(Codex) |
| `deviceOnline` | 연결부가 켜져 있는가. `false`면 질문해도 503 |
| `busy` | 다른 질문을 처리 중인가. `true`면 질문해도 409 |
| `engineReady` | 엔진이 준비됐는가(Claude 세션 켜짐, 동시 사용 서버 켜짐). `false`면 503 |
| `connectMode` | Codex만: `alternate`(번갈아 쓰기) 또는 `shared_server`(동시 사용) |
| `heldBy` | 있으면 "확인 필요" 잠금 상태(7장) |

**보내기 전에** `deviceOnline: true`, `busy: false`, `engineReady`가 `false`가 아닌지 확인하면 오류를 줄일 수 있다.

### 4-2. 질문 접수

```http
POST /v1/conversations/c_claude_main/requests
Authorization: Bearer <토큰>
Idempotency-Key: myapp-7f3c2a10-1b2c-4d5e-8f90-123456789abc
Content-Type: application/json

{ "question": "오늘 할 일을 세 줄로 정리해 줘" }
```

```json
{ "requestId": "req_..." }
```

**`Idempotency-Key`(중복 방지 키)는 꼭 넣는다.**

- 영문·숫자·`_`·`-`로 8~64자. 질문마다 **새 값**(예: `myapp-` + UUID)을 만든다.
- 같은 키·같은 질문을 다시 보내면 새로 실행하지 않고 처음 접수 번호를 돌려준다.
- 그래서 **네트워크 오류로 접수됐는지 모를 때는 같은 키로 다시 보내면 안전하다.** 새 키로 보내면 같은 질문이 두 번 실행될 수 있다.
- 같은 키로 **다른 질문**을 보내면 409 `idempotency_conflict`.

### 4-3. 결과 조회

```http
GET /v1/requests/req_...
Authorization: Bearer <토큰>
```

```json
{
  "requestId": "req_...",
  "status": "completed",
  "answer": "1. ...\n2. ...\n3. ...",
  "errorCode": null,
  "usage": { ... }
}
```

| `status` | 뜻 | 내 프로그램이 할 일 |
| --- | --- | --- |
| `queued` | 접수됨, 연결부 대기 | 2초 뒤 다시 조회 |
| `dispatching` | 연결부가 가져감 | 2초 뒤 다시 조회 |
| `running` | 엔진이 답하는 중 | 2초 뒤 다시 조회 |
| `completed` | 끝남 | `answer`를 사용 |
| `failed` | 실행하지 못함 | `errorCode` 확인(6장). 원인을 고친 뒤 **새 키로** 다시 보낼 수 있다 |
| `unknown` | 보냈는데 결과를 확인하지 못함 | **다시 보내지 않는다.** 사람에게 알리고 7장으로 정리 |
| `approval_required` | AI가 권한이 필요한 작업을 하려다 멈춤 | **다시 보내지 않는다.** 사람에게 알리고 7장으로 정리 |

- 조회 간격은 2초 정도가 적당하다. 1초보다 짧게 하지 않는다.
- 답이 길게 걸릴 수 있다. 연결부는 엔진 답을 최대 약 3분 기다린다. 내 프로그램의 대기 한도는 그보다 길게 잡고, 한도를 넘으면 **다시 보내지 말고** 나중에 같은 `requestId`로 조회한다.

---

## 5. 예제 코드

아래 예제는 모두 같은 일을 한다: 세션 목록 보기 → 질문 접수 → 결과가 나올 때까지 조회.
`c_claude_main`은 2-3에서 확인한 내 세션 이름으로 바꾸고, 키는 환경 변수 `IEON_API_KEY`에 둔다.

### 5-1. PowerShell

```powershell
$token = $env:IEON_API_KEY
$h = @{ Authorization = "Bearer $token" }
$base = 'http://127.0.0.1:28760'

Invoke-RestMethod "$base/v1/conversations" -Headers $h | ConvertTo-Json -Depth 5

$key = "myapp-$([guid]::NewGuid())"
$r = Invoke-RestMethod "$base/v1/conversations/c_claude_main/requests" -Method Post -ContentType 'application/json; charset=utf-8' `
  -Headers ($h + @{ 'Idempotency-Key' = $key }) -Body ([Text.Encoding]::UTF8.GetBytes((@{ question = '안녕' } | ConvertTo-Json)))

do {
  Start-Sleep 2
  $s = Invoke-RestMethod "$base/v1/requests/$($r.requestId)" -Headers $h
} while ($s.status -in 'queued', 'dispatching', 'running')

if ($s.status -eq 'completed') { $s.answer } else { "상태: $($s.status), 오류: $($s.errorCode)" }
```

### 5-2. Node.js (18 이상, 추가 설치 없음)

`ask.mjs`로 저장하고 `node ask.mjs`로 실행한다.

```js
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:28760';
const TOKEN = process.env.IEON_API_KEY;
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

async function api(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...headers, ...extra }, body: body && JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data?.error}`);
  return data;
}

export async function ask(conversationId, question, { timeoutMs = 10 * 60_000 } = {}) {
  const key = `myapp-${randomUUID()}`;
  const { requestId } = await api('POST', `/v1/conversations/${conversationId}/requests`, { question }, { 'idempotency-key': key });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const s = await api('GET', `/v1/requests/${requestId}`);
    if (!['queued', 'dispatching', 'running'].includes(s.status)) return s;
  }
  return { requestId, status: 'still_running' }; // 다시 보내지 말고 나중에 requestId로 조회
}

const { conversations } = await api('GET', '/v1/conversations');
console.log(conversations.map((c) => `${c.conversationId} (${c.engine}) online=${c.deviceOnline}`).join('\n'));
const result = await ask('c_claude_main', '안녕');
console.log(result.status === 'completed' ? result.answer : result);
```

### 5-3. Python (3.8 이상, 추가 설치 없음)

`ask.py`로 저장하고 `python ask.py`로 실행한다.

```python
import json, time, uuid, urllib.request, urllib.error

BASE = "http://127.0.0.1:28760"
TOKEN = open(r"D:\Project\ieon-gateway\.local\apps\myapp.token", encoding="ascii").read().strip()

def api(method, path, body=None, extra=None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", **(extra or {})}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code} {json.loads(e.read() or b'{}').get('error')}") from None

def ask(conversation_id, question, timeout_s=600):
    key = f"myapp-{uuid.uuid4()}"
    request_id = api("POST", f"/v1/conversations/{conversation_id}/requests",
                     {"question": question}, {"Idempotency-Key": key})["requestId"]
    started = time.time()
    while time.time() - started < timeout_s:
        time.sleep(2)
        s = api("GET", f"/v1/requests/{request_id}")
        if s["status"] not in ("queued", "dispatching", "running"):
            return s
    return {"requestId": request_id, "status": "still_running"}  # 다시 보내지 말고 나중에 조회

for c in api("GET", "/v1/conversations")["conversations"]:
    print(c["conversationId"], c["engine"], "online" if c["deviceOnline"] else "offline")
result = ask("c_claude_main", "안녕")
print(result["answer"] if result["status"] == "completed" else result)
```

### 5-4. curl (Git Bash)

```bash
TOKEN=$(tr -d '\r\n' < /d/Project/ieon-gateway/.local/apps/myapp.token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:28760/v1/conversations
curl -s -X POST http://127.0.0.1:28760/v1/conversations/c_claude_main/requests -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: myapp-$(date +%s%N)" -H "Content-Type: application/json" -d '{"question":"hello"}'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:28760/v1/requests/<requestId>
```

---

## 6. 오류 표

### 6-1. 요청 자체가 거절될 때(HTTP 상태 코드)

| 코드 | `error` | 원인 | 고치는 법 |
| --- | --- | --- | --- |
| 400 | `bad_request` | `Idempotency-Key` 없음·형식 틀림, 질문 비어 있음, 8,000자 초과 | 요청을 고친다 |
| 401 | `unauthorized` | 키 없음·틀림·폐기됨 | 웹 **설정 → 내 프로그램 연결**에서 새로 발급 |
| 404 | `not_found` | 없는 세션, 또는 `appIds`에 내 프로그램이 없음 | 2-2 ③ 확인 |
| 409 | `conversation_busy` | 이 세션이 다른 질문을 처리 중이거나 "확인 필요" 잠금 | 끝난 뒤 보낸다. 잠금이면 7장 |
| 409 | `idempotency_conflict` | 같은 키로 다른 질문을 보냄 | 질문마다 새 키를 쓴다 |
| 409 | `hub_mode` | 이 PC가 허브에 연결돼 있어 PC 서버가 질문을 받지 않음 | 허브 주소로 보내거나, PC 화면 **설정 → 밖에서도 쓰기**에서 허브 연결을 끊는다 |
| 503 | `device_unavailable` | 연결부가 꺼짐 | 그 PC가 켜져 있는지(허브형이면 PC 화면 **설정 → 밖에서도 쓰기**가 연결됨인지) |
| 503 | `session_not_running` | Claude 세션이 꺼짐 | Claude 채널 세션 시작 |
| 503 | `shared_server_down` | Codex 동시 사용 서버가 꺼짐 | `start -Shared` 또는 번갈아 쓰기로 변경(웹 **연결 설정 → 고급**) |
| 500 | `internal` | 서버 내부 오류 | `.local\run\server.log` 확인 |

### 6-2. 접수됐지만 실행이 실패했을 때(`status: failed`의 `errorCode`)

| `errorCode` | 뜻 | 고치는 법 |
| --- | --- | --- |
| `live_disabled` | 실제 엔진 실행이 꺼져 있음 | 이 PC 화면 위쪽 **AI 응답** 스위치 켜기(또는 **설정 → 이 PC**) |
| `desktop_holds_thread` | 번갈아 쓰기인데 그 Codex 대화가 Desktop 앱에 열려 있음 | 앱에서 그 대화만 닫고 새 키로 다시 보낸다 |
| `thread_busy` | 동시 사용 중 TUI에서 그 대화를 처리 중 | TUI 답이 끝난 뒤 새 키로 다시 보낸다 |
| `session_not_running` | Claude 세션이 꺼짐 | Claude 채널 세션 시작 |
| `shared_server_down` | Codex 동시 사용 서버가 꺼짐 | `start -Shared` 또는 번갈아 쓰기로 변경(웹 **연결 설정 → 고급**) |
| `thread_not_allowed` | 허용 목록에 없는 Codex 대화 | 이 PC 화면 **＋ 대화 연결**로 연결(또는 **설정 → 이 PC** 허용 목록에 추가) |
| `engine_not_configured`, `shared_server_not_configured` | 그 PC에 그 엔진 설정이 없음 | 번갈아 쓰기로 바꾸거나 관리자에게 문의 |
| `channel_unauthorized`, `channel_rejected` | Claude 채널 내부 토큰 불일치·요청 거부 | 이어온 설치를 다시 실행(`pwsh scripts/install.ps1`) |
| `turn_failed` | 엔진이 답을 만들다 실패 | 원래 세션 화면을 확인한 뒤 새 키로 다시 보낸다 |
| `not_executed` | 사람이 "실행되지 않음"으로 정리함 | 필요하면 새 키로 다시 보낸다 |

`unknown` 상태에는 `errorCode`로 이유가 붙을 수 있다. 예: `turn_joined_by_other_input`(동시 사용 중 TUI 입력이 섞였을 수 있음).

그 밖의 코드는 메시지를 사람에게 보여 주고 원래 세션 상태를 확인한다.

---

## 7. "확인 필요"(`unknown`, `approval_required`) 정리

결과를 모르는 질문이 생기면 그 세션은 잠긴다(같은 질문이 두 번 실행되는 것을 막기 위해서다). 내 프로그램은 **자동으로 다시 보내지 않는다.**

1. 사람에게 알린다. 예: "Claude 세션에서 질문이 실행됐는지 확인이 필요합니다."
2. 사람이 원래 세션 화면(Codex 앱, TUI, Claude 터미널)에서 실행 여부를 확인한다.
3. 확인 결과를 보낸다.

```http
POST /v1/requests/req_.../review
Authorization: Bearer <토큰>
Content-Type: application/json

{ "executed": true }
```

- 실행됐으면 `true`, 실행되지 않았으면 `false`.
- 정리하면 잠금이 풀린다. `false`로 정리했으면 필요할 때 새 키로 다시 보낸다.
- 정리할 수 없는 상태의 요청이면 409 `not_reviewable`.

웹 화면의 "확인이 필요한 질문" 카드 버튼(**실행됐어요** / **실행되지 않았어요**)이나 메신저 `/review done|not`으로 정리해도 같다.

---

## 7-1. 이어온 앱 연결과 새 소식(AP-2, 앱 만드는 사람용)

이어온 앱(휴대폰·PC, AP-3에서 만듦)이 쓰는 길이다. 일반 외부 프로그램은 2-2의 API 키를 쓰면 된다.

1. **연결 코드(사람이 웹에서):** 설정 → 내 프로그램 연결 → **이어온 앱 연결 → 연결 코드 만들기** → 8자리 코드(10분, 한 번만), 서버 주소가 보인다.
2. **앱이 열쇠 받기:** `POST /v1/app/pair` `{ "code": "12345678", "name": "내 폰" }` → `201 { "token": "<64자>", "deviceId": "ad_…" }`. 열쇠는 이때 한 번만 받고 서버엔 해시만 남는다. 틀린·쓴·지난 코드는 `403 bad_code`, 1분에 10번 넘게 시도하면 `429`.
3. **열쇠로 쓰기:** `Authorization: Bearer <token>` — 웹 화면과 같은 대화(`/v1/conversations`·질문·결과·카드)·방(`/v1/rooms`)·AI 직원·승인(`/v1/approvals/<id>`)을 쓸 수 있다. **설정(`/v1/admin/…`)은 `403 app_not_allowed`** — 웹 화면에서만.
4. **새 소식 바로 받기:** `GET /v1/events`(같은 열쇠) → `text/event-stream`. 내 대화에서 일이 생기면
   - `event: request` `{ conversationId, requestId, status: queued|completed|failed|unknown|approval_required, roomId? }`
   - `event: approval` `{ conversationId, approvalId, status: pending|allowed|denied }`
   **질문·답·승인 내용은 싣지 않는다** — 받은 번호로 `/v1/requests/<id>`·`/v1/conversations/<id>/cards`를 다시 불러온다. 25초마다 `: keepalive` 줄.
5. **끊기:** 웹의 기기 목록에서 **끊기** → 그 열쇠는 바로 `401`.
7. **이 기기 연결 끊기(AP-5a):** `POST /v1/app/forget`(앱 열쇠로만, 웹 로그인은 `403 app_only`) → `200 { "revoked": true }`, 그 열쇠는 바로 `401`. 대화 보관 기록 지우기는 `DELETE /v1/conversations/<id>/messages` → `204`(앱 열쇠·웹 로그인 모두).
6. **다른 출처(CORS, AP-3):** 서버는 이어온 앱 출처만 다른 출처 호출을 허용한다 — 안드로이드 `https://localhost`, 아이폰 `capacitor://localhost`, PC 설치형 `app://ieon`(`/v1/*`만, 미리 묻기 OPTIONS에 `authorization`·`idempotency-key` 허용). **쿠키는 허용하지 않으므로**(allow-credentials 없음) 웹 로그인으로는 못 쓰고 열쇠로만 쓴다. 개발용 출처는 서버 설정 파일 `appOrigins`로만 더한다.

## 8. 그 밖의 API

**질문 멈추기(RC2)**

```http
POST /v1/requests/req_123/stop
```

- 시작 전(`queued`)이면 바로 취소 → 200 `{"status":"cancelled"}`.
- 실행 중이면 202 `{"status":"stopping"}`. 이어온이 엔진을 멈추고 **멈춘 것을 확인한 뒤** 결과 조회가 `cancelled`(`errorCode: "stopped_by_user"`)가 된다. 확인하지 못하면 `unknown`(`stop_unconfirmed`) — 7절처럼 정리한다. 멈추라고 했어도 엔진이 먼저 답을 끝냈으면 `completed`.
- 결과 조회에 `stopRequested: true`가 붙으면 멈춤 요청을 받은 상태다.
- 409: `not_running`(이미 끝남, 응답에 그때 `status`), `stop_unsupported`(사람이 띄운 Claude 채널 창은 실행 중에 멈출 수 없음 — 원래 창에서).


**기록 보기 / 지우기**

```http
GET /v1/conversations/c_claude_main/messages
DELETE /v1/conversations/c_claude_main/messages
```

이어온을 통해 주고받은 질문·답만 보인다. 원래 세션에서 사람이 직접 한 대화는 포함되지 않는다. 지우면 이어온에 보관된 질문·답 원문만 지워지고, 원래 Codex·Claude 세션의 대화는 그대로 남는다.

**Codex 연결 모드 바꾸기**

```http
PUT /v1/conversations/c_codex_myproject/settings
Content-Type: application/json

{ "connectMode": "shared_server" }
```

- `alternate`(번갈아 쓰기) 또는 `shared_server`(동시 사용). Codex 세션만 된다(Claude는 400 `not_codex`).
- 처리 중이거나 확인 필요 잠금이 있으면 409 `conversation_busy`.

---

**새 세션 만들기(설정에서 켠 경우)**

이어온이 새 Codex·Claude 세션과 전용 작업 폴더를 만든다. 기능 켜기는 웹 **설정 → 대화 → 새 세션**("새 세션 만들기를 켭니다"). 내 프로그램 토큰으로 만들려면 `new-sessions.json`의 `creatorApps`에 그 앱 ID(예: `app_myapp`)를 넣는다(기본은 웹·메신저만).

| 요청 | 하는 일 | 성공 응답 |
| --- | --- | --- |
| `POST /v1/sessions` 본문 `{ "engine": "codex"\|"claude", "name": "my-proj", "profile": "workspace"\|"read_only" }` | 새 세션 등록 | 201 `{ conversationId, name, engine, profile }` |
| `GET /v1/sessions/limits` | 새 세션 수와 한도 | 200 `{ sessions, maxSessions, perEngine, maxPerEngine, maxActive }` |
| `POST /v1/sessions/{id}/sleep` | 잠재우기 | 200 `{ conversationId, state: "sleeping" }` |
| `POST /v1/sessions/{id}/restore` | 보관에서 꺼내기 | 200 `{ conversationId, state: "sleeping" }` |
| `DELETE /v1/sessions/{id}` 본문 `{ "confirm": "<세션 이름>" }` | 삭제 | 200 `{ conversationId, deleted: true, workspaceRemoved }` |
| `GET /v1/sessions/notices?after=<ISO 시각>` | 보관 예고(그 시각 이후 것) | 200 `{ notices: [{ conversationId, name, archiveAt, at }] }` |

- 만든 뒤 질문은 기존과 같이 `POST /v1/conversations/{conversationId}/requests`. 첫 질문 때 실제 엔진 세션이 생긴다.
- 세션 목록의 새 세션 항목에는 `newSession: { name, state, profile, sessionId? }`가 붙는다. `state`는 `pending`(첫 질문 전)·`active`·`sleeping`·`archived`, `sessionId`는 사람이 직접 열 때 쓰는 Codex 대화 ID·Claude 세션 ID다.
- 거절: 403 `new_sessions_disabled`(기능 꺼짐)·`app_not_allowed`·`profile_not_allowed`(full은 설정 파일로만), 400 `bad_name`·`bad_engine`·`unknown_profile`·`confirm_mismatch`, 409 `name_taken`·`session_limit`·`engine_limit`(본문에 `limit`)·`not_active`·`not_archived`·`conversation_busy`.
- 새 세션 질문 거절: 409 `session_archived`(먼저 꺼내기), 409 `active_limit`(동시 처리 한도, 잠시 후 다시). 결과 `unknown`의 `session_forked`는 사람이 같은 Claude 세션을 터미널에서 열고 있었다는 뜻이다.

## 9. 내 프로그램을 만들 때 체크리스트

- [ ] 웹에서 전용 API 키를 발급하고 쓸 세션을 체크했다.
- [ ] 키를 코드에 직접 쓰지 않고 환경 변수에서 읽는다.
- [ ] 질문마다 새 `Idempotency-Key`를 만들고, 접수 결과를 모를 때만 같은 키로 재시도한다.
- [ ] 결과는 2초 간격으로 조회하고, 대기 한도를 넘어도 다시 보내지 않는다.
- [ ] `unknown`·`approval_required`는 자동 재전송하지 않고 사람에게 알린다.
- [ ] 토큰·질문·답을 로그에 남기지 않는다.
- [ ] 다 쓰면 이 PC 화면 위쪽 **AI 응답** 스위치로 실제 실행을 끈다.