<!-- source: docs/API_GUIDE.md @ ee3e10c -->
# Developer integration guide (HTTP API)

- As of: 2026-11-19 (reflects the new screens, Antigravity, and multi-user) · For: developers who want to ask questions to Codex, Claude, or Antigravity sessions through Ieon from their own programs
- First install Ieon with chapters 1–4 of the [walkthrough for first-time users](BEGINNER_GUIDE.md) and check that questions work from the web screen. This document is the next step after that.
- APIs for asking existing sessions are in chapters 1–7; the API for having Ieon create new sessions is in chapter 8, "Create a new session".

---

## 1. How it works

Your program does not call the AI engine directly. **It hands the question to the Ieon server and comes back for the result later.**

```
Your program ──① submit question (POST)──▶ Ieon server ◀── connector picks it up ──▶ Codex / Claude session
     │                                         │
     └──② check result (GET, repeat) ──────────┘
```

1. When you send a question, the server immediately returns a **request number (`requestId`)**. There is no answer yet at this point.
2. Every few seconds, check the result with that number.
3. When the status becomes `completed`, the answer is in `answer`.

Why it's split like this: AI answers can take tens of seconds or more, and the same question must not run twice.

---

## 2. Preparation

### 2-1. Turn on Ieon

After installation (`pwsh scripts/install.ps1`, [walkthrough section 1](BEGINNER_GUIDE.md)), Ieon is on automatically. To get real answers, turn on AI replies (real runs) on this PC's screen. Press **Turn on and send** when you send your first question on the web, or turn it on with the **AI replies** switch at the top of the conversation (or "Turn on real runs" in **Settings → This PC**). Until it's turned on once from the web, API questions don't run either (while it's off, submitting and checking work, but the result ends as `failed` (`live_disabled`)). To ask a Claude session, keep that Claude channel session running.

### 2-2. Get an API key for your program

On the web screen, bottom left **Settings** (⚙) → top **Admin** → **External programs** (admin only), enter the program name and press **Issue key**. The key is shown **only once, at that time**, so copy it into your program's settings (an environment variable, etc.). In the same section, check the sessions this program can see and press **Save**. When you no longer need it, press **Revoke** (access stops immediately; other programs are not affected). You don't edit any settings file.

### 2-3. Check the connection

```powershell
$token = $env:IEON_API_KEY   # environment variable holding the issued key
Invoke-RestMethod http://127.0.0.1:28760/v1/conversations -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 5
```

If a session list appears, it worked. If you get `401`, the key is wrong or revoked; if the list is empty, you didn't check any sessions in 2-2.

---

## 3. Basic rules

| Item | Value |
| --- | --- |
| Address | `http://127.0.0.1:28760` (same PC only). For Tailscale-allowed devices, `http://<PC Tailscale address>:28760` |
| Authentication | Header `Authorization: Bearer <token>` on every request |
| Data format | JSON for both requests and responses, `Content-Type: application/json` |
| Question length | Up to 8,000 characters |

**Security notes**

- Don't write the token directly in source code. Read it from a file or an environment variable.
- Don't leave tokens, questions, or answers in your program's logs.
- Don't expose Ieon to the internet. To call it from an external server, use Tailscale.

---

## 4. API list

| Request | What it does | Success response |
| --- | --- | --- |
| `GET /v1/conversations` | List of sessions you can use | 200 `{ conversations: [...] }` |
| `POST /v1/conversations/{id}/requests` | Submit a question | 202 `{ requestId }` |
| `GET /v1/requests/{requestId}` | Check the result | 200 `{ requestId, status, answer, errorCode, usage }` |
| `POST /v1/requests/{requestId}/review` | Clear a result-unknown question | 200 `{ requestId, status, errorCode }` |
| `GET /v1/tasks?filter=active\|all` | Task (per-question) list — previews only, newest first | 200 `{ tasks: [...] }` |
| `GET /v1/tasks/{requestId}` | One task — question, approvals and run results, answer (when completed) | 200 task |
| `GET /v1/approvals` | View all pending approvals | 200 `{ approvals: [...] }` |
| `POST /v1/requests/{requestId}/stop` | Stop just that question | 200 `{ status: "cancelled" }` (before start) · 202 `{ status: "stopping" }` (while running) |
| `GET /v1/conversations/{id}/messages` | History exchanged through Ieon | 200 `{ messages: [...] }` |
| `DELETE /v1/conversations/{id}/messages` | Delete history | 204 |
| `PUT /v1/conversations/{id}/settings` | Change Codex connection mode | 200 `{ connectMode }` |

### 4-1. Session list

```http
GET /v1/conversations
Authorization: Bearer <token>
```

```json
{
  "conversations": [
    {
      "conversationId": "c_claude_main",
      "label": "Claude channel session",
      "engine": "claude_channel",
      "deviceOnline": true,
      "busy": false,
      "engineReady": true
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `conversationId` | Session name used when asking |
| `engine` | `codex_thread` (Codex) · `claude_channel` (Claude channel) · `claude_cli` (Claude new session · server conversation) · `agy_cli` (Antigravity) · `grok_cli` (Grok) |
| `deviceOnline` | Whether the connector is on. If `false`, asking returns 503 |
| `busy` | Whether another question is being processed. If `true`, asking returns 409 |
| `engineReady` | Whether the engine is ready (Claude session running, shared server running). If `false`, 503 |
| `connectMode` | Codex only: `alternate` (alternate) or `shared_server` (shared) |
| `heldBy` | If present, it's in a "needs review" lock (chapter 7) |

**Before sending**, checking that `deviceOnline: true`, `busy: false`, and `engineReady` is not `false` reduces errors.

### 4-2. Submit a question

```http
POST /v1/conversations/c_claude_main/requests
Authorization: Bearer <token>
Idempotency-Key: myapp-7f3c2a10-1b2c-4d5e-8f90-123456789abc
Content-Type: application/json

{ "question": "Summarize today's to-dos in three lines" }
```

```json
{ "requestId": "req_..." }
```

**Always include `Idempotency-Key` (duplicate-prevention key).**

- 8–64 characters of letters, digits, `_`, and `-`. Create a **new value** for each question (e.g., `myapp-` + UUID).
- If you send the same key with the same question again, it doesn't run again and returns the original request number.
- So **when a network error leaves you unsure whether it was submitted, resending with the same key is safe.** Sending with a new key may run the same question twice.
- Sending a **different question** with the same key returns 409 `idempotency_conflict`.

### 4-3. Check the result

```http
GET /v1/requests/req_...
Authorization: Bearer <token>
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

| `status` | Meaning | What your program should do |
| --- | --- | --- |
| `queued` | Submitted, waiting for the connector | Check again in 2 seconds |
| `dispatching` | The connector picked it up | Check again in 2 seconds |
| `running` | The engine is answering | Check again in 2 seconds |
| `completed` | Done | Use `answer` |
| `failed` | Couldn't run | Check `errorCode` (chapter 6). After fixing the cause, you can resend **with a new key** |
| `unknown` | Sent, but the result couldn't be confirmed (`errorCode` examples: `server_restarted` server restarted, `connector_restarted` PC connector restarted, `stop_unconfirmed` stop not confirmed) | **Don't resend.** Notify a person and clear it per chapter 7 |
| `approval_required` | The AI stopped while trying to do something that needs permission | **Don't resend.** Notify a person and clear it per chapter 7 |

- A check interval of about 2 seconds is appropriate. Don't go shorter than 1 second.
- Answers can take a long time. The connector waits up to about 3 minutes for the engine's answer. Set your program's wait limit longer than that, and if it's exceeded, **don't resend** — check later with the same `requestId`.

---

## 5. Example code

All the examples below do the same thing: list sessions → submit a question → check until the result is ready.
Replace `c_claude_main` with your session name confirmed in 2-3, and keep the key in the environment variable `IEON_API_KEY`.

### 5-1. PowerShell

```powershell
$token = $env:IEON_API_KEY
$h = @{ Authorization = "Bearer $token" }
$base = 'http://127.0.0.1:28760'

Invoke-RestMethod "$base/v1/conversations" -Headers $h | ConvertTo-Json -Depth 5

$key = "myapp-$([guid]::NewGuid())"
$r = Invoke-RestMethod "$base/v1/conversations/c_claude_main/requests" -Method Post -ContentType 'application/json; charset=utf-8' `
  -Headers ($h + @{ 'Idempotency-Key' = $key }) -Body ([Text.Encoding]::UTF8.GetBytes((@{ question = 'Hello' } | ConvertTo-Json)))

do {
  Start-Sleep 2
  $s = Invoke-RestMethod "$base/v1/requests/$($r.requestId)" -Headers $h
} while ($s.status -in 'queued', 'dispatching', 'running')

if ($s.status -eq 'completed') { $s.answer } else { "Status: $($s.status), error: $($s.errorCode)" }
```

### 5-2. Node.js (18 or later, no extra installs)

Save it as `ask.mjs` and run it with `node ask.mjs`.

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
  return { requestId, status: 'still_running' }; // don't resend; check later with requestId
}

const { conversations } = await api('GET', '/v1/conversations');
console.log(conversations.map((c) => `${c.conversationId} (${c.engine}) online=${c.deviceOnline}`).join('\n'));
const result = await ask('c_claude_main', 'Hello');
console.log(result.status === 'completed' ? result.answer : result);
```

### 5-3. Python (3.8 or later, no extra installs)

Save it as `ask.py` and run it with `python ask.py`.

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
    return {"requestId": request_id, "status": "still_running"}  # don't resend; check later

for c in api("GET", "/v1/conversations")["conversations"]:
    print(c["conversationId"], c["engine"], "online" if c["deviceOnline"] else "offline")
result = ask("c_claude_main", "Hello")
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

## 6. Error tables

### 6-1. When the request itself is rejected (HTTP status codes)

| Code | `error` | Cause | How to fix |
| --- | --- | --- | --- |
| 400 | `bad_request` | `Idempotency-Key` missing or malformed, empty question, over 8,000 characters | Fix the request |
| 401 | `unauthorized` | Key missing, wrong, or revoked | Issue a new one in web **Settings → Admin → External programs** |
| 404 | `not_found` | Session doesn't exist, or your program isn't in `appIds` | Check 2-2 ③ |
| 409 | `conversation_busy` | This session is processing another question or is in a "needs review" lock | Send after it finishes. If locked, see chapter 7 |
| 409 | `idempotency_conflict` | A different question was sent with the same key | Use a new key for each question |
| 409 | `hub_mode` | This PC is connected to a hub, so the PC server doesn't accept questions | Send to the hub address, or disconnect from the hub in **Settings → Apps and devices → Hub connection** on the PC screen |
| 429 | `member_limit` | The member used up their daily question limit (`limit` and `used` in the body) | Send again at midnight Korea time. Don't resend automatically |
| 429 | `rate_limited` | Too many requests in a short time | Wait the number of seconds in the `retry-after` header, then send |
| 503 | `device_unavailable` | The connector is off | Check that the PC is on (in hub mode, that **Settings → Apps and devices → Hub connection** on the PC screen shows Connected) |
| 503 | `session_not_running` | The Claude session is off | Start the Claude channel session |
| 503 | `shared_server_down` | The Codex shared server is off | `start -Shared`, or switch to alternate (web **Connection settings → Advanced**) |
| 500 | `internal` | Internal server error | Check `.local\run\server.log` |

### 6-2. When it was submitted but the run failed (`errorCode` of `status: failed`)

| `errorCode` | Meaning | How to fix |
| --- | --- | --- |
| `live_disabled` | Real engine runs are off | Turn on the **AI replies** switch at the top of this PC's screen (or **Settings → This PC**) |
| `desktop_holds_thread` | In alternate mode, that Codex conversation is open in the Desktop app | Close just that conversation in the app and resend with a new key |
| `thread_busy` | In shared mode, the TUI is processing that conversation | Resend with a new key after the TUI answer finishes |
| `session_not_running` | The Claude session is off | Start the Claude channel session |
| `shared_server_down` | The Codex shared server is off | `start -Shared`, or switch to alternate (web **Connection settings → Advanced**) |
| `thread_not_allowed` | A Codex conversation not on the allowlist | Connect it with **＋ Connect conversation** on this PC's screen (or add it to the allowlist in **Settings → This PC**) |
| `engine_not_configured`, `shared_server_not_configured` | That PC has no settings for that engine | Switch to alternate or contact the admin |
| `channel_unauthorized`, `channel_rejected` | Claude channel internal token mismatch or request refused | Run the Ieon installer again (`pwsh scripts/install.ps1`) |
| `turn_failed` | The engine failed while producing an answer | Check the original session screen, then resend with a new key |
| `not_executed` | A person cleared it as "It didn't run" | Resend with a new key if needed |

The `unknown` status may carry a reason in `errorCode`. Example: `turn_joined_by_other_input` (TUI input may have been mixed in during shared mode).

For other codes, show the message to a person and check the original session's state.

---

## 7. Clearing "needs review" (`unknown`, `approval_required`)

When a question's result is unknown, that session is locked (to prevent the same question from running twice). Your program **does not resend automatically.**

1. Notify a person. Example: "Please check whether the question ran in the Claude session."
2. The person checks on the original session screen (Codex app, TUI, Claude terminal) whether it ran.
3. Send the result of the check.

```http
POST /v1/requests/req_.../review
Authorization: Bearer <token>
Content-Type: application/json

{ "executed": true }
```

- `true` if it ran, `false` if it didn't.
- Clearing it releases the lock. If you cleared it as `false`, resend with a new key when needed.
- If the request is in a state that can't be cleared, 409 `not_reviewable`.

Clearing it with the buttons (**It ran** / **It didn't run**) on the "Question needing review" card on the web screen, or with messenger `/review done|not`, works the same way.

---

## 7-1. Ieon App connection and live updates (AP-2, for app builders)

This is the path the Ieon App (phone and PC, built in AP-3) uses. Regular external programs can just use the API key from 2-2.

1. **Pairing code (a person, on the web):** Settings → Apps and devices → **Connect Ieon App → Create pairing code** → an 8-digit code (10 minutes, one use) and the server address are shown.
2. **The app gets a key:** `POST /v1/app/pair` `{ "code": "12345678", "name": "My phone" }` → `201 { "token": "<64 chars>", "deviceId": "ad_…" }`. The key is received only this once, and only its hash stays on the server. A wrong, used, or expired code gives `403 bad_code`; more than 10 attempts in 1 minute gives `429`.
3. **Using the key:** `Authorization: Bearer <token>` — you can use the same conversations as the web screen (`/v1/conversations`, questions, results, cards), rooms (`/v1/rooms`), AI staff, and approvals (`/v1/approvals/<id>`). **Settings (`/v1/admin/…`) return `403 app_not_allowed`** — web screen only.
4. **Getting live updates:** `GET /v1/events` (same key) → `text/event-stream`. When something happens in your conversations:
   - `event: request` `{ conversationId, requestId, status: queued|completed|failed|unknown|approval_required, roomId? }`
   - `event: approval` `{ conversationId, approvalId, status: pending|allowed|denied }`
   **Question, answer, and approval content is not included** — reload `/v1/requests/<id>` and `/v1/conversations/<id>/cards` with the numbers you received. A `: keepalive` line every 25 seconds.
5. **Disconnect:** **Disconnect** in the device list on the web → that key gets `401` immediately.
7. **Disconnect this device (AP-5a):** `POST /v1/app/forget` (app key only; web login gets `403 app_only`) → `200 { "revoked": true }`, and that key gets `401` immediately. To delete a conversation's stored history, `DELETE /v1/conversations/<id>/messages` → `204` (both app key and web login).
6. **Cross-origin (CORS, AP-3):** The server allows cross-origin calls only from Ieon App origins — Android `https://localhost`, iPhone `capacitor://localhost`, PC installed app `app://ieon` (`/v1/*` only; the OPTIONS preflight allows `authorization` and `idempotency-key`). **Cookies are not allowed** (no allow-credentials), so it can't be used with web login, only with the key. Development origins can be added only through `appOrigins` in the server settings file.

## 8. Other APIs

**OpenAI voice (V2, for the web and the Ieon App — the key is set in Settings)**

| Request | What it does |
| --- | --- |
| `GET /v1/voice/config?lang=en` | The current method `{ mode, live, turn, reason, remainingSec, … }` (no raw key). Read it on every tap so settings changes apply right away |
| `POST /v1/voice/live` `{ conversationId, lang }` | Live conversation key `{ liveId, clientSecret (connect within 60 s), callUrl, tickSec, idleSec, maxSec }` — only for conversations you can see |
| `POST /v1/voice/live/<liveId>/tick` / `/end` | Count time every 30 s (`stop: true` means hang up) / end |
| `POST /v1/voice/transcribe?sec=3&lang=en` | Body = the recording (15 MB or less) → `{ text }` |
| `POST /v1/voice/speak` `{ text, lang }` | → mp3 |

Errors: `voice_no_key`, `voice_members_off`, `voice_limit` (429), `voice_mode_off`, `voice_key_rejected`, `voice_openai_*`, `hub_mode`. Work questions from a live conversation go through the question API in 4-2 above (the session answers).

**Stop a question (RC2)**

```http
POST /v1/requests/req_123/stop
```

- If it hasn't started (`queued`), it's canceled immediately → 200 `{"status":"cancelled"}`.
- If it's running, 202 `{"status":"stopping"}`. Ieon stops the engine and, **after confirming it stopped**, the result check becomes `cancelled` (`errorCode: "stopped_by_user"`). If it can't confirm, `unknown` (`stop_unconfirmed`) — clear it as in section 7. Even if a stop was requested, if the engine finished its answer first, it's `completed`.
- If `stopRequested: true` appears in the result check, the stop request has been received.
- 409: `not_running` (already finished; the response includes the `status` at that time), `stop_unsupported` (a Claude channel window launched by a person can't be stopped while running — stop it in the original window).

**Hand off to a person (RC5)** — Read the rules with `GET /v1/conversations/{id}/handoff` (changing them is web screen only). Requests that match the rules appear in `GET /v1/approvals` with `handoff: true`, and you record them once with `POST /v1/approvals/{approvalId}` and body `{"decision":"done"}` (Done by me) or `{"decision":"drop"}` (Won't do). They can't be recorded with an external program key (same as approvals).

**Resume check (RC4)** — `resume` in `GET /v1/tasks/{requestId}`: `known` (false for questions submitted before this feature), `verdict` (`same` same session · `needs_review` same session but blocked by a needs-review question · `mismatch` the session, engine, or PC changed), `sameSession`, `sameEngine`, `sameHost`, `sameConnectMode`, `historyKept` (whether Ieon's stored history is intact), `isLatest`, `deviceOnline`, `then`/`now` (engine, PC, connection method, and for then, also whether work mode was on), `heldBy`. **Session IDs are not included** — only whether they're the same or different. It doesn't check whether that turn actually remains in the original session, so check in the original app and clear it as in section 7.


**View / delete history**

```http
GET /v1/conversations/c_claude_main/messages
DELETE /v1/conversations/c_claude_main/messages
```

Only questions and answers exchanged through Ieon are shown. Conversations a person had directly in the original session are not included. Deleting removes only the question and answer text stored in Ieon; the conversation in the original Codex or Claude session stays as is.

**Change Codex connection mode**

```http
PUT /v1/conversations/c_codex_myproject/settings
Content-Type: application/json

{ "connectMode": "shared_server" }
```

- `alternate` (alternate) or `shared_server` (shared). Works only for Codex sessions (Claude returns 400 `not_codex`).
- If a question is being processed or there's a needs-review lock, 409 `conversation_busy`.

---

**Create a new session (when turned on in settings)**

Ieon creates a new Codex, Claude, or Antigravity session along with its own work folder. Turn on the feature in web **Settings → Admin → Register conversations → New session** ("Turn on new session creation"). To create sessions with your program's token, add that app's ID (e.g., `app_myapp`) to `creatorApps` in `new-sessions.json` (by default, only web and messengers).

| Request | What it does | Success response |
| --- | --- | --- |
| `POST /v1/sessions` body `{ "engine": "codex"\|"claude"\|"antigravity", "name": "my-proj", "profile": "workspace"\|"read_only" }` | Register a new session (Antigravity only when it's installed on that PC) | 201 `{ conversationId, name, engine, profile }` |
| `GET /v1/sessions/limits` | Number of new sessions and limits | 200 `{ sessions, maxSessions, perEngine, maxPerEngine, maxActive }` |
| `POST /v1/sessions/{id}/sleep` | Sleep | 200 `{ conversationId, state: "sleeping" }` |
| `POST /v1/sessions/{id}/restore` | Restore from archive | 200 `{ conversationId, state: "sleeping" }` |
| `DELETE /v1/sessions/{id}` body `{ "confirm": "<session name>" }` | Delete | 200 `{ conversationId, deleted: true, workspaceRemoved }` |
| `GET /v1/sessions/notices?after=<ISO time>` | Archive notices (those after that time) | 200 `{ notices: [{ conversationId, name, archiveAt, at }] }` |

- After creating one, ask questions the same way as before with `POST /v1/conversations/{conversationId}/requests`. The real engine session is created on the first question.
- New-session items in the session list carry `newSession: { name, state, profile, sessionId? }`. `state` is `pending` (before the first question), `active`, `sleeping`, or `archived`; `sessionId` is the Codex conversation ID or Claude session ID a person uses to open it directly.
- Rejections: 403 `new_sessions_disabled` (feature off), `app_not_allowed`, `profile_not_allowed` (full permission is accepted in requests only when the admin has turned on the full switch in **Settings → Admin → Register conversations → New session**), 400 `bad_name`, `bad_engine`, `unknown_profile`, `confirm_mismatch`, 409 `name_taken`, `session_limit`, `engine_limit` (`limit` in the body), `not_active`, `not_archived`, `conversation_busy`.
- New-session question rejections: 409 `session_archived` (restore it first), 409 `active_limit` (concurrent processing limit; try again shortly). `session_forked` in an `unknown` result means a person had the same Claude session open in a terminal.

## 9. Checklist for building your program

- [ ] I issued a dedicated API key on the web and checked the sessions to use.
- [ ] The key is read from an environment variable, not written directly in code.
- [ ] I create a new `Idempotency-Key` for each question and retry with the same key only when the submission result is unknown.
- [ ] Results are checked at 2-second intervals, and nothing is resent even when the wait limit is exceeded.
- [ ] `unknown` and `approval_required` are not resent automatically; a person is notified.
- [ ] Tokens, questions, and answers are not left in logs.
- [ ] When finished, I turn off real runs with the **AI replies** switch at the top of this PC's screen.
