<!-- source: docs/MANUAL.md @ ee3e10c -->
# Ieon User Manual (Short Version)

- As of: 2026-11-19 (new screens U1–U7, Antigravity, work mode, and multiple users included) · For: you
- Principle: **All settings are done on the web screen, and Ieon handles tokens internally.** You never edit config files or move tokens around ([WEB_FIRST](../design/WEB_FIRST.md)).
- Forms: PC mode (on your PC at `http://127.0.0.1:28760`) and hub mode (`https://ieun-gateway.sinsan.kr` + PC connection).
- Two features: **Connect an existing session** (ask questions in a Codex conversation, Claude Code session, or Antigravity conversation that already exists on this PC) and **Create a new session** (Ieon creates a new Codex, Claude, or Antigravity session and a work folder; off by default).
- If this is your first time, see the [step-by-step guide](BEGINNER_GUIDE.md) (includes installation and setup). To connect your own program, see the [developer integration guide](API_GUIDE.md).
- Basis for verdicts: [first validation result](../validation/FIRST_CONTINUITY_RESULT.md); design: [DESIGN](../design/DESIGN.md)

## 1. What Ieon does

Ieon takes a question sent from the web screen, puts it into **a work session you are already using**, and returns that session's answer. It does not create a new conversation or copy a conversation.

| Engine | How it connects | Screen a person sees |
| --- | --- | --- |
| Codex · alternate (`alternate`, default) | For each question, reopens the same conversation through the SDK, continues it, and releases it right away | Codex Desktop (when needed) |
| Codex · shared (`shared_server`) | A person (TUI) and Ieon attach to one shared App Server together | Official Codex TUI |
| Claude Code · channel | Puts the question into a running Claude Code session through the Ieon channel and receives the answer via `reply` | Claude Code terminal |
| Antigravity · connected conversation | For each question, continues the same conversation with `agy` (work mode uses ACP `agy acp`) | Antigravity CLI |

It has three parts.

- **Ieon server** (`127.0.0.1:28760`): web screen and API; keeps conversations and request states.
- **Connector**: connects from this PC to the server first, picks up questions, and puts them into the engine. It opens no ports to the outside.
- **Engines**: Codex conversations, the shared App Server (`28761`), the Claude channel (`28762`).

## 2. One-time setup

- **Install on a Linux server (server install / hub mode):** Paste the command created in your existing hub's **Settings → Admin → Hub security → Install on a new server** (a 1-hour key, `curl … | sh`) into the new server (no repository access needed), or, if you have repository access, run `git clone` and then `sh deploy/server/install.sh` once — just press Enter for most questions; the rest (admin password, Codex/Claude login, messengers) is done on the web screen. For prerequisites, recommended specs, and what to do after installing, see [step-by-step guide 8-1](BEGINNER_GUIDE.md). A server install hides the PC connection screen; turning on PC connection in **Settings → Apps and devices → Devices** turns it into hub mode (data stays as is). Running the same install command again updates everything, including engine cells, to the new version.
- **Work folders (folders per AI staff):** In **Settings → Work → Work folder**, register folders on that PC (on a hub, choose the PC or cell) with a name, and for each staff member use [Set folders] to attach one personal folder and shared folders (read only / read and write). When you save, it shows "how strictly it is actually blocked" and asks for your approval — in work mode, Codex asks with an approval card every time it edits a file (the card shows the file path, and "outside work folder" if it is outside the work folder), and it writes only if a person allows it — if you allow it, it can write outside the work folder too, so look carefully before pressing an "outside work folder" card. Reading cannot be blocked (guidance only), and other engines only get told about the folders. Folders under a temporary folder cannot be registered. Staff with no folders attached work exactly as before. Messenger `/status` shows only folder names. Claude (server conversations and new sessions) can neither read nor edit files outside the attached folders (blocked), and shared (read-only) folders are read only (a new session with full permission has command tools, so guidance only). Only shared folders are attached to new sessions (the personal folder is the auto-created work folder). For hub new sessions, choose "The hub itself" in **Settings → Work → Work folder**.
- **Work blocked for Claude:** In Claude new sessions and server conversations, actions blocked by permission settings (for example, editing a read-only folder) are not run, and the end of the answer shows what was blocked as "[Ieon] actions not run because permission settings blocked them". The conversation does not stop.
- **Scheduled tasks:** In **Settings → Work → Scheduled tasks**, enter a conversation, when (daily time / interval / once), the question, and a daily maximum, then create it; at that time the question goes to that conversation and the answer accumulates in the conversation. It asks for confirmation when you create it and when you turn it back on (AI is called while no one is around). It only sends questions (work mode conversations are skipped), and if the conversation is busy or the PC is off, that run is skipped (not resent automatically). If the result of the previous scheduled question cannot be confirmed, that schedule stops; resolve it and press **Turn back on** to have it send again. The answer is also posted to the messenger room connected to that conversation (Telegram, Discord, Slack, LINE) as "[name] Scheduled question (daily 09:00) answer:".
- **Concurrent questions:** The questions one PC or engine cell handles at once (waiting + processing) default to 3. Beyond that, questions are not queued; it tells you "that PC/cell is handling several other questions" and does not resend automatically (the card's **Resend** sends only when you press it). To change: **Settings → Admin → Register conversations → Concurrent questions · wait time** (0 = no limit).

[Step-by-step guide section 1](BEGINNER_GUIDE.md): run `pwsh scripts/install.ps1` once in the Ieon folder. It installs and sets up the components, creates internal tokens, sets up auto-start at logon, and makes a desktop shortcut. If Edge is installed, the **Ieon** shortcut opens as an Edge app window (its own window without address bar or tabs); otherwise it opens as a browser tab. Settings and tokens are in `.local\` (excluded from git) and are not shown on screen.

When you first open this PC's screen (when there are no connected conversations), the **3-step first-time setup** appears: ① readiness check (whether Codex is logged in on this PC) ② choose a conversation (one of the Codex conversations used recently on this PC — the only required choice) ③ Ready (messengers and hub are optional; **Open conversation**). To open it again, add `/#setup` to the end of the address. Other settings are in **Settings** (⚙) at the bottom left of the screen. **The work conversation `01a0dadd-…` does not appear in the list and cannot be connected** (the server removes and rejects it).

## 3. Turning on and off

- Ieon **starts automatically without a window when you log on** (Task Scheduler `ieon-gateway`). The server launches the connector and messengers together and restarts any that exits.
- AI calls (AI replies) are on at install (since 2026-11-18; to install with them off, `pwsh scripts/install.ps1 -AiOff`). To turn them off, use the **AI replies** switch above the conversation (the same setting is "Turn on real runs" in **Settings → This PC** (on the hub screen, **Settings → PC settings**)). You can change it from any logged-in web screen (including phones and Tailscale). While it is off, messenger and API questions are not run.
- Usually, picking a Codex conversation in **＋ Connect conversation** adds it to the allowlist and registers the session in one step. To add or remove allowlist entries directly (including connection mode and work folder), use **Settings → This PC** (on the hub screen, **Settings → PC settings**). When you change it, the connector restarts with the new settings.
- To turn off completely (also removes auto-start): `pwsh scripts/install.ps1 -Uninstall` (settings and records remain).
- To turn back on or apply a new version: `pwsh scripts/install.ps1` (settings and tokens stay; restarts with the new code).
- It turns off when the PC turns off, and starts automatically at the next logon. For the order from install to removal, see section 10 of the [step-by-step guide](BEGINNER_GUIDE.md).
- Log: `.local\run\server.log` (questions, answers, and token values are not recorded).

### Connecting to a hub (hub mode)

The easiest way (PC connection link):

1. On the hub screen, **Settings → Apps and devices → Devices → PC connection link → Create link**. The link can be used once within 10 minutes.
2. Open that link on the PC you want to connect. When "Connect this PC to the hub?" and the hub address appear, press **Connect** **only if it is a link you created** (if you leave this PC's name blank, the computer name is used). It finishes without a code check.

Manual way (6-digit code):

1. On this PC's screen, **Settings → Apps and devices → Hub connection → Connect to hub**: hub address (this PC's name is optional) → **Connect** → 6-digit code.
2. On the hub screen, **Settings → Apps and devices → Devices → Connection requests**: if the code matches, **Approve** (if you reconnect the same PC, "Replace existing device").

Once connected, the token is passed internally from the hub to this PC, and this PC's server launches a connector for the hub. It reconnects automatically after a reboot. **Reconnect**, **Disconnect**, and **Forget hub** are on this PC's screen under **Settings → Apps and devices → Hub connection**. The conversation list on the hub screen is grouped by PC name.

- While connected to a hub, this PC's server does not hand out its own work (so the same PC does not run questions from two servers). So the PC screen does not accept questions and shows the "This PC is connected to a hub" card (**Open hub screen**). Send from the hub screen or a messenger bot connected to the hub.
- To get real answers, this PC's AI replies (real runs) must be on.
- This PC's safety settings (allowlist, real runs, work folders) cannot be changed from the hub.
- `https` is recommended for the hub address. A server install without a domain also accepts `http` (with a warning). The hub accepts up to 240 requests per minute per device and returns 429 beyond that (the connector waits and asks again; it does not resend questions).

### Claude channel session

```powershell
pwsh scripts/ieon.ps1 claude
```

`claude --dangerously-load-development-channels server:ieon` starts in a new window.

- For the account, it uses the PC default login (a Pro/Max subscription login done with `/login` in that window; the first time, you do it yourself) or an Ieon account (subscription, API key, compatible endpoint) in **Settings → Account → Claude accounts**. An Ieon account is used from the channel windows you **newly open** after choosing it as the default.
- Check that the bottom shows `manual mode`. If it shows `auto mode`, turn it off with `shift+tab`.
- Do not type questions directly into this window (even if you do, the answer does not go to Ieon).
- To end, `/exit`. When the session ends, the channel ends too.

### Codex shared mode (TUI, advanced)

This is a development feature that runs the shared App Server and the Codex TUI together, so it has no web screen yet. Usually you use "alternate". To use it, first remove auto-start with `pwsh scripts/install.ps1 -Uninstall` (so there are not two connectors), then run the commands below; when done, `stop` and restore with `pwsh scripts/install.ps1`.

```powershell
pwsh scripts/ieon.ps1 start -Shared
pwsh scripts/ieon.ps1 tui
```

- **Do not open this mode's conversation in the Codex Desktop app** (lock conflict).
- If a hook confirmation screen appears, choose "Continue without trusting".

## 4. Using the web screen

1. Open **Ieon** on the desktop (or `http://127.0.0.1:28760`). A screen opened on this PC logs in automatically. The hub logs in with the admin password (the first time, "Create admin").
2. Choose a conversation from the list on the left. Each row has a line with the engine and status, and a count badge appears when there is something to handle. At the top of the list is **＋ Connect conversation**, and at the bottom left are **Messengers** and **Settings** (⚙).
3. Type a question in the input box at the bottom and press **Send** (Enter; Shift+Enter for a new line). It shows Received → Running → Completed, then the answer appears.

Above the conversation are the conversation name, engine, and status, the **AI replies** switch (this PC's screen only), and **Connection settings**. Pressing **Connection settings** shows the engine, connection method, and status on the right; for a new session it has Sleep and Delete, and **Advanced** has the Codex connection mode and conversation ID.

### Connecting a conversation (＋ Connect conversation)

On this PC's screen, pressing **＋ Connect conversation** shows the list of Codex conversations used recently on this PC (takes about 10 seconds; the server removes the work conversation before showing it). Pressing one adds it to the allowlist (alternate) and registers the session in one step, and that conversation opens. The work folder is set automatically. If it is not in the list, use **Advanced: enter conversation ID**. The hub screen works the same way — when you press **＋ Connect conversation**, the hub asks your PC (choose one if there are two or more) for the list and shows it, and choosing one adds it to that PC's allowlist and registers the session in one step (the PC must be on). You can also connect from the hub's **Settings → PC settings** by choosing a PC and using **Codex conversations on that PC → Load conversation list**. To register a Claude channel session, use **Settings → Admin → Register conversations → Register manually**.

### Status labels and cards

| Status label | Meaning | What to do |
| --- | --- | --- |
| Ready to send | Engine is ready | You can ask |
| Processing | This conversation's question is at the PC or running (the task screen splits this into Sending → Running) | Wait until it finishes |
| Needs review | Locked because there is a question with an unknown result | See "Resolving needs review" below |
| Asleep · wakes when you ask | A new session that is resting | Just ask |
| PC disconnected | The connector is off | Check that the PC is on, and in hub mode, that the PC screen's **Settings → Apps and devices → Hub connection** shows connected |
| Claude session off | The Claude channel session is off | Start the Claude channel session (see "Claude channel session" above) |
| Shared server off | Shared mode, but the shared App Server is off | Switch to alternate in **Connection settings → Advanced** |
| Connected to hub · can't send from here | This PC is connected to a hub | Send from the hub screen |

When there is a problem, a **card** in the conversation shows the reason together with buttons: This PC is connected to a hub (**Open hub screen**), PC disconnected, Claude session is off / Shared server is off, Question needing review (**It ran** / **It didn't run**), This session is archived (**Restore**), AI replies are off (**Turn on AI replies**), The hub needs a Codex login (hub screen; goes to settings), Unsent question.

The **Resend** button on an **Unsent question** appears only when it is certain the question was not sent (open in the Codex app, shared server in use, processing, concurrency limit). It sends only when you press it and never resends automatically. Questions with an unknown result are not eligible for resending.

### Changing the Codex connection mode

In a Codex conversation, choose **Connection settings → Advanced → Codex connection mode**.

- **Alternate**: when you use only one of Desktop and Ieon at a time, or for an Ieon-only conversation. If that conversation is open in Desktop when sending, it is refused with "Not sent because this conversation is open in Desktop". The app can stay running; **just close that conversation**. When you reopen the conversation in Desktop, Ieon's questions and answers are visible.
- **Shared**: a person (TUI) and Ieon use the same conversation without quitting the app. Ieon's questions and answers appear in the TUI right away.
- You cannot change the mode while a question is processing or needs review.

### Using it on a phone (Tailscale)

- **Recommended: use hub mode on phones.** Open the hub address in the phone browser and do **Add to Home Screen** (Android Chrome may show it as "Install app"; on iPhone Safari it is in the Share button) to get an app-like icon. On a narrow screen it switches between list ↔ conversation, and buttons are shown large (44px or more). Nothing is stored offline. The hub opens only from places you allow (access restriction in the hub screen's **Settings → Admin → Hub security**).
- Exposing the PC directly, below, is an advanced setting with no web screen yet; the admin puts it in the config file at install time: setting `extraHosts` (this PC's Tailscale address) and `extraAllowedClients` (the phone's Tailscale address) lets it open from those addresses too. Only Tailscale addresses (100.64.0.0/10) are allowed; it does not open on 0.0.0.0 or home Wi-Fi addresses. Devices outside the allowlist get 403.
- Turn on Tailscale on the phone and open `http://<this PC's Tailscale address>:28760`. Tailscale encrypts the traffic.
- When not in use, delete the two entries or turn it off with `stop`.

### Using it from messengers (Telegram, Discord, Slack, LINE, KakaoTalk)

For detailed bot creation, adding, and troubleshooting, see the [messenger setup manual](MESSENGER_MANUAL.md).

You can have several bots per messenger (**Settings → Messenger**). Connect one session per chat room (Telegram group or topic, Discord channel, Slack channel), or choose the target session with `/use` in a 1:1 chat with the bot. Telegram, Discord, and Slack connect from this PC to the messenger first, so no public address or Tailscale is needed. KakaoTalk goes through a public relay (PC mode) or the hub (hub mode), and LINE also needs a public address (currently hub mode only, 1:1 chats only).

1. **Messengers** at the bottom left of the screen → choose a messenger (Telegram, Discord, Slack, LINE, KakaoTalk). Bots that are turned off (such as bots moved to a hub) cannot be chosen.
2. Follow the short instructions and enter the bot token in the field (Telegram and Discord: 1 field, Slack: 2 fields; if already saved, only when changing it). Saved values are not shown again. For KakaoTalk, copy the skill URL and paste it into the Open Builder skill URL.
3. When the bot connects, a 6-digit number appears in large type. Send that number to the bot, and the sender is registered as that bot's owner (allowed user) ("○○ is now registered as the owner"). The number is valid for 10 minutes and one use, and after 5 wrong tries it locks and you need a new one. If an already allowed person sends it, the bot replies "You're already allowed, so nothing extra was registered" and the screen changes to complete.
   - Another way: send anything to the bot, then press **Allow** in the "people waiting for messenger access" banner on the conversation screen or in **Settings → Messenger → Access requests**. Users outside the allowlist get no reply except to `/whoami`.
4. Commands: `/sessions`, `/use <number>` (connect this chat room to a session), `/status`, `/review done|not` (resolve needs review), `/stop` (stop only the last question in this chat room), `/help`. Any other message goes to the connected session as a question. In Slack, use `!` instead of `/` (for example, `!sessions`).

Messenger-specific preparation:

- Telegram: BotFather `/newbot`. To use it in groups, BotFather `/setprivacy` → Disable (or use 1:1 chats only).
- Discord: Developer Portal → Bot → turn on **Message Content Intent**, and invite it to your server with the OAuth2 URL Generator (bot, Send Messages, Read Message History).
- Slack: when creating the app, choose **From scratch**, not an AI connection (Claude/OpenAI) template. Turn on Socket Mode (App-Level Token `connections:write` → xapp), Bot Token Scopes `chat:write`, `channels:history`, `groups:history`, `im:history`, bot events `message.channels`, `message.groups`, `message.im` under Event Subscriptions, allow the Messages tab in App Home, install it to the workspace (xoxb), then invite the app to channels.

### Using it from your programs (HTTP API)

For a detailed walkthrough and examples (PowerShell, Node, Python, curl), see the [developer integration guide](API_GUIDE.md).

Programs you build call the same HTTP API as the web screen and messenger bots. They do not call the engines directly. When a question is submitted to the server, the connector picks it up and puts it into the Codex conversation or Claude channel session, and the program checks the result.

- Address: `http://127.0.0.1:28760` (for Tailscale-allowed devices, `http://<this PC's Tailscale address>:28760`).
- Authentication: `Authorization: Bearer <API key>` on every `/v1/` request. If the key is wrong or revoked, 401.
- Issue an API key per program in **Settings → Admin → External programs** (shown only once). Check the sessions that program may see and save; revoke it when no longer needed. You do not edit config files.

| Request | What it does | Response |
| --- | --- | --- |
| `GET /v1/conversations` | Session list | `conversationId`·`label`·`engine`·`deviceOnline`·`busy`·`engineReady`·`heldBy` |
| `POST /v1/conversations/<id>/requests` | Submit a question | 202 `{"requestId"}` |
| `GET /v1/requests/<requestId>` | Check the result | `status`·`answer`·`errorCode`·`usage` |
| `POST /v1/requests/<requestId>/review` | Resolve needs review, body `{"executed": true\|false}` | Resolved `status` |
| `GET /v1/tasks?filter=active\|all` · `GET /v1/tasks/<requestId>` | Task (per question) list / one task (question, approval results, answer) | `tasks` · task |
| `GET /v1/approvals` | Pending approvals and tasks handed to a human (`handoff: true`) across all conversations | `approvals` |
| `GET·PUT /v1/conversations/<id>/handoff` | "Human task" rules (PUT from the web screen only), body `{"kinds":["command"\|"file"\|"permissions"], "patterns":["git push"]}` | Rules |
| `POST /v1/requests/<requestId>/stop` | Stop only that question | 200 `cancelled` (before start) · 202 `stopping` (running → `cancelled` after confirmation) · 409 `not_running`·`stop_unsupported` |
| `GET /v1/conversations/<id>/messages` | Ieon question/answer history for that session | `messages` |
| `DELETE /v1/conversations/<id>/messages` | Delete history | 204 |
| `PUT /v1/conversations/<id>/settings` | Codex connection mode, body `{"connectMode": "alternate"\|"shared_server"}` | `connectMode` |

Submitting a question requires an `Idempotency-Key` header (8–64 letters, digits, `_`, `-`; a new value for each question). Sending the same key again does not run it again. When a network error leaves you unsure whether it was submitted, send again **with the same key**.

```powershell
$token = $env:IEON_API_KEY   # Put the key issued on the web into your program's environment variable
$h = @{ Authorization = "Bearer $token" }
$base = 'http://127.0.0.1:28760'
Invoke-RestMethod "$base/v1/conversations" -Headers $h
$r = Invoke-RestMethod "$base/v1/conversations/c_claude_test/requests" -Method Post -ContentType 'application/json' `
  -Headers ($h + @{ 'Idempotency-Key' = "myapp-$([guid]::NewGuid())" }) -Body (@{ question = 'Hello' } | ConvertTo-Json)
do { Start-Sleep 2; $s = Invoke-RestMethod "$base/v1/requests/$($r.requestId)" -Headers $h } while ($s.status -in 'queued', 'dispatching', 'running')
$s
```

Handling the result `status`:

- `completed`: `answer` is the answer.
- `failed`: check `errorCode`, fix the cause, and you can send again with a new key.
- `unknown`·`approval_required`: **do not resend automatically.** Check in the original session, then resolve with `review` (same as "Resolving needs review"). Until resolved, that session is locked.

Submission errors: 400 `bad_request` (missing key or question, question too long), 404 `not_found` (session does not exist or is not allowed), 503 `device_unavailable` (connector off), `session_not_running` (Claude session off), `shared_server_down` (shared App Server off), 409 `conversation_busy` (processing or locked by needs review), `idempotency_conflict` (a different question with the same key).

To get real answers, AI replies (real runs) must be on, and for Claude sessions keep the channel session running. Connect existing Codex conversations first with **＋ Connect conversation** on the web (allowlist entry and session registration in one step).

### Work mode (Codex, Antigravity, approval cards)

Only in "work mode", turned on per conversation, can Codex and Antigravity edit files and run commands, and each time they ask with an [Allow]/[Deny] card (web) or `/allow n` · `/deny n` (messenger, owner only; on Korean bots also `/허용 n` · `/거부 n`). This time only; no reply within the set time (default 15 minutes; 15 minutes to 24 hours in **Settings → Admin → Register conversations → Concurrent questions · wait time**) or end of turn means deny; no internet; a person makes the approval decision. Writes ask with an approval card per file, and if outside the work folder the card shows "outside work folder" — if a person allows it, writing outside the folder happens too (section 2, work folders). The real result after allowing (running → completed, failed, or result unknown) is shown on the same card and in the messenger chat room, and the number n is the same on web and messenger. For the detailed order, see [BEGINNER_GUIDE 5-2](BEGINNER_GUIDE.md).

**Antigravity (E3, 2026-11-19):** You can also turn on work mode for a connected Antigravity conversation in Connection settings. When on, the question is continued in the same conversation through Antigravity's ACP (`agy acp`), and every time Antigravity asks permission to edit files or run commands, the same [Allow]/[Deny] card appears (Allow = this time only; "always allow" is never chosen). When work mode is off, it runs once in plan (read-only) mode as before. If a person has that conversation open in Antigravity, it is not sent and shows "in use" as before. The approval round trip (allow and deny) was verified with real Antigravity (2026-11-19).

### Creating a new session

A feature where Ieon creates a new Codex, Claude, or Antigravity session and a dedicated work folder (off by default). Turning it on, limits, sleep, archive, and default permissions are in **Settings → Admin → Register conversations → New session**; design is in [NEW_SESSIONS](../design/NEW_SESSIONS.md).

- Create: **＋ New session** at the top left of the screen (visible only when the feature is on — choose engine, name, and permission, then create), messenger `/new codex|claude|antigravity <name>`, API `POST /v1/sessions`.
- **Grok new sessions and accounts (G1, 2026-11-20):** If you choose **Grok** as the engine, the Grok CLI (`grok`) on that PC creates a new session at the first question (`-p … --output-format json`), and it continues only with the session ID it received (`-r <ID>`). If you choose an account with an xAI API key in **Settings → Account → Grok accounts (for new sessions)**, it goes out with that key (`XAI_API_KEY`); otherwise it uses that PC's Grok login (PC default). Real Grok answers have not been verified yet because there is no subscription (only testing after install and subscription remains). The new session limit is the Grok limit in **Settings → Admin → Register conversations → New session settings**.
- **Antigravity new sessions (E4, 2026-11-19):** If you choose **Antigravity** as the engine, Antigravity (`agy`) on that PC creates a new conversation at the first question, and it continues only with the conversation ID it received. Permissions: read only = `plan` + sandbox, work folder = `accept-edits` (edit files) + sandbox, full = `auto` (including commands, no sandbox). It works where Antigravity is installed (installed in the hub image since 2026-11-20 — not yet verified on real hub/server cells). New session questions were verified with real Antigravity (2026-11-19).
- Cleanup: sleeps after 30 minutes idle (wakes when you ask) → archived after 14 days unused (must be restored before asking) → deletion requires name confirmation. On the web, Sleep and Delete in **Connection settings**, and **Restore** in the archive below the list and on the "This session is archived" card; in messengers, `/sleep`, `/archived`, `/restore`, `/close`, `/limits`.
- The default permission is read and write inside the work folder. `full` (command execution, network) can be chosen only after turning on the "full permission" switch in **Settings → Admin → Register conversations → New session** (a confirmation dialog when turning it on, since 2026-11-18).
- **Where (hub mode, SV2):** If the hub has engine cells or PCs, "Where" appears in the create dialog. **The default is the first engine cell that is on** (since 2026-11-18 — web, app, and messenger `/new` all; if you don't choose, that cell). Engine cells (for example, Server · test1 — shown in the list as "including commands and file work") handle commands and file work (for Codex new sessions the cell container is the boundary; it cannot touch anything outside the cell or the hub data), and the hub itself answers with text only. If there are no engine cells or all are off, it is created on the hub itself.
- **Server Claude login (hub mode, once):** On the hub screen, in **Settings → Account → Claude accounts**, press **Log in (subscription)** → in **Open approval window**, approve with your Claude account → copy the code shown and paste it into the Ieon field → "Logged in · subscription". Or enter an **API key** (sk-ant-…) once. The hub and all engine cells share this one login (no login per cell), and tokens and keys are not shown on screen again. If you write `ANTHROPIC_API_KEY=...` in the environment file of the server's Ieon folder at install time, it is filled in automatically. Claude on a PC uses that PC's Claude Code login by default, and you can keep several Ieon-only accounts in **Settings → Account → Claude accounts** (label → login: approve in the approval window and paste the code, or API key → **Default Claude account**). The chosen account is used for Claude new sessions and newly opened Claude channel windows (`ieon.ps1 claude`), and nothing is sent before it is logged in. A different account per conversation is set in the **Claude conversation / Account to use** table on the same screen (same as per-conversation accounts for Codex). Which account a conversation uses is shown above the conversation, in conversation info, and in messenger `/sessions` as "Ieon account <label>". **Compatible endpoint** (Claude Code stays the same; only the model changes to Upstage Solar, a router, a local model, and so on): **Compatible endpoint** on the Claude account row → address, key, model name, how the key is sent → save. Existing human-created Claude conversations (including channel windows) continue only with verified combinations (Upstage), and other endpoints work only in Ieon new sessions (unverified combinations are not sent, with `combo_unverified`). **Antigravity accounts (A3, 2026-11-19):** On the same screen, **Antigravity accounts (for new sessions)** — label → **API key** (Gemini, pay per use) → **Antigravity account for new sessions**. Logging in with a subscription per account does not work (measured 2026-11-19 — to use a subscription, use "PC default login"). **Compatible endpoint** also works: **Compatible endpoint** on the account row → address (https; for your own PC, http://localhost), key, model names (optional, comma-separated), request format (Gemini/OpenAI Responses) — it sends to that model through Antigravity's enterprise model gateway feature (not verified with a real gateway). New sessions created with an Ieon account show "Ieon account <label>" above the conversation. Antigravity new sessions created with this account store their conversations in that account's folder and keep continuing with that account (even if you change the default), while Antigravity conversations originally used on that PC stay on the PC default login. Deleting an account also deletes the conversations of the new sessions created with it. **Codex compatible endpoint:** **Compatible endpoint** on the Codex account row (address, key, model; OpenAI Responses API compatible only — Codex 0.165 does not accept `wire_api = "chat"`). It is used only in Ieon Codex new sessions; existing human-created Codex conversations have no verified combination, so they are not sent (`combo_unverified`). Conversation history continues from that PC's records regardless of the account. On the hub, choose a PC and change it on the same screen.
- **Choosing server-cell Claude conversations (hub mode):** Claude conversations opened directly on the server with `ieun.sh engine claude <cell> [name]` can also be continued in Ieon. On the hub screen, in **Settings → PC settings**, choose that cell (Server · name), and the **Server Claude conversations** table shows recent conversations with title, folder, and time → pressing **Connect** adds it to the conversation list right away, and questions continue in the same conversation. While that folder's Claude screen is open on the server, it does not send and tells you "in use" (close it and send again). Command execution is not opened; only reading and editing files.

### Multiple bots and roles

One default bot is enough with the **Messengers** window. To add more bots or change name, call name, role, visible existing sessions, extra allowed users, on/off, or token, go to **Settings → Messenger** (the "Advanced" link in the messenger window also leads here). Creating and editing roles is in **Settings → Admin → Messenger advanced → Roles** (admin only). Tokens are not shown again. For the detailed order, see [messenger setup manual](MESSENGER_MANUAL.md) 6.2.

### Using it with multiple people (hub mode, 2026-11-19)

A feature for sharing a hub with family or colleagues (off by default). People who sign up use **only their own sessions on their own PCs**, and their conversations are not visible on screen to other members or to the admin (hub owner). For the member walkthrough, see the [member guide](MEMBER_GUIDE.md); design is in [MULTI_USER](../design/MULTI_USER.md).

- **Turning it on:** "Multi-user" in the hub screen's **Settings → Admin → Hub security → Multiple users** (confirmation dialog). When on, **Sign-up request** appears on the login screen. Turning it off only blocks new requests; approved people keep using it.
- **Hub access restriction:** If the hub is restricted by an IP list, other people cannot reach the hub. To share it, open it in **Security (hub access restriction)** at the top of the same screen (login is still required even when opened).
- **Approval:** In the list on the same screen, **Approve / Reject** each applicant. For approved people: **Disconnect** (logs out immediately; cannot log in again), **Turn back on**, **Temporary password** (password recovery without email — shown only once, and that person's login is ended), **Delete** (deletes all of that person's Ieon conversation history, rooms, schedules, connected PCs, app connections, and messenger connections; the original session records on that person's PC remain).
- **Terms and limits (M4, 2026-11-19):** When signing up, the person must check the agreement boxes for the **Terms of Use** (`/terms`) and **Privacy Policy** (`/privacy`) for the request to go through (the time of agreement is recorded; both pages open regardless of access restriction; they are drafts provided by Ieon, so the hub owner should review them). Set the daily question count with the **Member daily question limit** (default) in the same "Multiple users" section and the **Limit** in the list (per person; 0 = no limit for that person only; blank = default), and see usage in **Questions today** in the list. When exceeded, the question is not sent and the person is told (resets at midnight Korea time; admins have no limit). For the operating steps, see the [hub operations manual](OPERATIONS.md).
- **Admin login:** As before, leave the email field blank and enter only the password. Change the admin password in **Settings → Account → My password** (members change their own password in the same field).
- **What members can use:** connecting their own PC (PC connection link), new sessions on their own PC, work folders, schedules, app connections, messenger connection (shared bots), connecting Codex conversations used on their own PC (**＋ Connect conversation**). **What they cannot use:** hub settings, security, messenger bot settings, accounts, the session registration table (manual entry), hub engine cells, other people's PCs and conversations.
- **Shared messenger bots:** Members share the hub's Telegram, Discord, Slack, LINE, and Kakao bots (Kakao since 2026-11-19 — Kakao cannot send first, so scheduled answers and notifications do not go to Kakao rooms). When a member sends the 6-digit number received in **Settings → Messenger → Messenger connection** to the bot, that messenger account sees only that person's conversations. Messenger accounts that are not connected work as before (people the admin allowed = admin's conversations). For details, see [messenger setup manual](MESSENGER_MANUAL.md) 6.6.
- **Getting the app:** In the phone browser, `<hub address>/app` (direct Android app download), or **Settings → Apps and devices → Get the app** (Android, PC). When a new version is uploaded, the app's first screen shows "New version available — get it".
- **Good to know:** Opening the DB file directly on the server lets you see the contents (not via the screen or API). The flow of actually connecting another person's PC and the shared bot connection have not yet been verified with real accounts (verified with test accounts and stand-in tests).

## 5. When results look wrong

| Message on screen | Cause | What to do |
| --- | --- | --- |
| Not sent because this conversation is open in Desktop | Alternate mode, but Desktop is holding the conversation | Close that conversation in Desktop and send again |
| Not sent because this conversation is in use on the shared server | In shared mode, a person is processing in the TUI | Send again after the TUI answer finishes |
| Session not running | Claude channel session off | Start the session with `claude` |
| Real runs are off in the connector | AI replies (real runs) off | Turn on the **AI replies** switch at the top of this PC's screen (or **Settings → This PC**) |
| Result unknown | No result received after sending (disconnected, timed out) | See "Resolving needs review" below |
| TUI input may have joined during processing and mixed into the answer | In shared mode, someone pressed Enter in the TUI while Ieon was processing | Check the result in the TUI, then "Resolving needs review" |
| Stopped because a permission check is needed in the original session | (Older versions) the model tried to start a tool or file action | Handle it in the original session, then "Resolving needs review". Since 2026-11-18, neither Codex nor Claude locks; the end of the answer notes "[Ieon] actions not run" |

### Resolving needs review

A question with an unknown result locks that session (to prevent the same question from running twice). Ieon **never resends automatically.**

1. In the original session screen (Desktop, TUI, Claude terminal), check whether that question ran.
2. When you choose that conversation on the web, a "Question needing review" card with two buttons appears.
   - **It ran**: closes it as run. An answer that may not have been received or may be mixed is not saved.
   - **It didn't run**: closes it as not run. If needed, send the question again yourself.
3. Once resolved, the lock is released.

## 6. Must follow

- In shared mode, to type in the TUI while Ieon is processing, use **Tab (queue), not Enter**. Enter joins the in-progress Ieon answer and changes it (measured).
- Do not open shared mode conversations in Desktop.
- If the Claude channel instructions say "no tools", even `reply` is blocked and answers do not reach Ieon. The channel is built to work as "no tools except reply".
- Ordinary questions from Ieon run **read-only with network/web blocked**. If file changes or command execution are needed, turn on that conversation's **work mode** and allow with approval cards (Codex, Antigravity).
- Real runs (`-Live`), logins, ports, and setting changes are done only within the approved scope. Do not copy, print, or share tokens or credential files.
- The work conversation `01a0dadd-739f-74d2-93c5-9c405cc1019b` is not a target.

## 7. Known limitations

- Access is possible only from this PC, allowed Tailscale devices, allowed messenger users (KakaoTalk goes through the relay or hub), and places that pass the hub access restriction. There is no other public internet access.
- In shared mode, the person's screen is the TUI, not a Desktop window.
- In Claude Code 2.1.314, the channel `reply` may run without a permission check (cause unconfirmed; `reply` can only reply on the channel).
- New sessions: Claude new sessions run with `claude -p` for each question (no channel or terminal window needed). If a person asks while the same session is open in a terminal, it stops as result unknown (`session_forked`).
- The new session `workspace` permission only writes files and blocks command execution and internet. `full` can run commands inside the work folder, but it does not block commands from touching things outside the folder at the operating system level. We decided not to do OS-level isolation (2026-11-19). Instead, approval cards, Claude path restrictions, and server engine cell containers block it.
- New session archive notices go to the messenger chat room connected to that session. If nothing has been said in that room since the messenger bot was turned back on, it cannot send.
- Telegram turns `/close` in the instructions into a link. Pressing the link shows the same instructions again without confirming. To delete, you must type `/close <name> confirm` yourself (on Korean bots, `/close <이름> 확인`).
- Even if a new session is "Asleep", the process was not turned off; it is a status display (when there are no questions, there is no process to begin with).
- Each Codex run shows one "unrecognized configuration setting (`computer_use.windows.always_allowed_app_ids`)" warning. It does not affect running.
- Rules review round 2 (2026-11-18): PC settings (AI replies, accounts, allowlist, mode, hub connection) can be changed from any logged-in web screen. The new session full permission switch, name confirmation on delete, and also deleting the work folder are changed in **Settings → Admin → Register conversations → New session** (a confirmation dialog when making it less safe), and the web login duration defaults to 30 days (1–90 days, in the same tab's **Concurrent questions · wait time** → "Wait time" field). Deleting sessions and devices uses one confirmation dialog instead of typing the name. The hub address also accepts http (server install without a domain — the screen shows a "not encrypted" warning).
- **Notifications (2026-11-18):** 🔕 Notifications at the bottom left of the web screen → if the browser allows it, "○○ replied" arrives as a Chrome/Edge notification **even after you close the tab** (not shown while you are looking at the Ieon screen; pressing it opens that conversation). The phone app uses Firebase notifications (APP_GUIDE 8-7). Question and answer text is never put in any notification.
- Resolving result unknown is done by human check. There is no feature that automatically compares with the original session records. However, questions that were processing while the server restarted are resolved automatically when the PC (connector) sends the engine's real result (the connector resends for about 5 minutes; in PC mode, if the connector also went down, it stays result unknown). If only the connector goes down and comes back, questions that PC was processing immediately change to result unknown (review card) (2026-11-20, `connector_restarted` — not resent automatically).
- Codex question mode (not work mode): existing conversations read files and run commands as usual in a read-only sandbox (writes and internet blocked), and new sessions run commands inside the work folder. Tools outside the sandbox (MCP and so on) stop on the spot, and what stopped or was blocked is noted at the end of the answer (the conversation is not locked). In shared server mode, if it tries to use a tool, that turn is cut off with a note that "it may have started before the cut".
- The shared App Server (`codex app-server --listen`) is an experimental Codex feature and was verified with version 0.165.0.

## 8. Development workflow (reference)

Work branches are created from the latest `origin/main` with a prefix per author (Codex `codex/<purpose>`, Claude Code `claude/<purpose>`). After commit and push, pushing a `pr-request/<branch latest sha>/<branch>` tag (pointing to current main) merges it through an automatic PR. Confirm the merge → run `node --test tests/pilot/*.test.mjs` on main → clean up the branch and work folder, then the next task. For detailed rules, see [AGENTS.md](../../AGENTS.md).

## Appendix. Commands for development and troubleshooting

Usually not used. Do not use them together with Ieon launched by the installer (`install.ps1`); before using them, remove auto-start with `pwsh scripts/install.ps1 -Uninstall`.

```powershell
pwsh scripts/ieon.ps1 start [-Shared] [-Live]   # Start the server and connector directly (for development)
pwsh scripts/ieon.ps1 status                    # Ports, real runs, test conversation lock
pwsh scripts/ieon.ps1 check                     # Install check (no model calls)
pwsh scripts/ieon.ps1 stop
```
