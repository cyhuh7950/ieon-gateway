<!-- source: docs/MESSENGER_MANUAL.md @ ee3e10c -->
# Ieon Messenger Setup Manual (Telegram, Discord, Slack, LINE, KakaoTalk)

> **Bot tokens, owner registration, allowed users, and bot registration are all done on the web screen.** The default bot is in the **Messengers** window at the bottom left of the screen; multiple bots and advanced settings are in **Settings → Messenger**. You do not need to edit config files or restart messengers with commands (the Ieon server launches the messengers and rereads the web settings every minute).

- As of: 2026-11-19 (new screens U1–U7, work mode approvals and member shared bots included) · For: you
- See also: [user manual](MANUAL.md) (server, connector, web), [work log](../WORK_STATUS.md)

## 1. Structure at a glance

```
You (messenger chat room) ⇄ messenger bot ⇄ Ieon messenger module (this PC) ⇄ Ieon server → connector → Codex/Claude session
```

- By default there is **one bot per messenger** (the `default` bot), and each chat room (channel, group, 1:1) is connected to one session with `/use`.
- If needed, you can have **several bots in the same messenger** (6.2). Each bot has its own allowed users, visible sessions, and chat room connections. You decide how to divide them.
- For all three messengers, **the bot connects from this PC to the messenger server first** (Telegram long polling, Discord Gateway, Slack Socket Mode). So no router port, public address, or Tailscale is needed. KakaoTalk does not support this method and needs a public HTTPS server (Oracle, etc.), so it is excluded for now.
- Login is an **allowlist of messenger user IDs** instead of tokens. Users outside the list get no reply at all except to `/whoami`.
- Question rules are the same as the web: refused if in use, not resent if the result is unknown, ordinary questions are read-only, and work mode conversations ask for file edits and command execution with approval requests.

## 2. Where to set things

| Task | Screen |
| --- | --- |
| Enter or change the default bot token | **Messengers** at the bottom left → choose a messenger → token field (saved values are not shown again) |
| Register my account as the bot owner | Send the 6-digit number shown in the **Messengers** window to the bot (section 5) |
| Enter, change, or delete tokens for multiple bots | **Settings → Messenger** → choose a bot in the bot list → **Token** in the edit panel |
| Add bots; name, role, call name, extra allowed users, visible sessions, on/off, delete | The bot list and edit panel in **Settings → Messenger** (the "Advanced" link in the messenger window also goes here) |
| Access requests and common allowed users | "Allow" in the "people waiting for messenger access" banner on the conversation screen, or **Settings → Messenger → Access requests** / **Settings → Admin → Messenger advanced → Messenger common allowed users** |
| Kakao skill URL | Copy in **Messengers → KakaoTalk**, or **Settings → Admin → Messenger advanced → Kakao skill URL** |
| Roles | **Settings → Admin → Messenger advanced → Roles** |

Do not leave tokens in chats, documents, or screenshots. The log (`.local\run\server.log`) contains no token, question, or answer text.

## 3. Turning on and off, status

The Ieon server launches the messengers together (automatic after install). You do not need to turn them on or off separately. The default bot's status appears on the messenger selection screen of the **Messengers** window, and every bot's status appears in the status column of the bot list in **Settings → Messenger**. A bot that is turned off appears in the messenger window as "Off · may be in use elsewhere (e.g. a hub)" and cannot be chosen (so you do not enter the token again for a bot moved to a hub and cause an overlap).

| Status | Meaning | What to do |
| --- | --- | --- |
| Connected | Normal | — |
| No token · missing token name | That bot's token has not been entered yet | Enter it in the messenger window or in **Token** in the edit panel (connects within 1 minute) |
| Duplicate token | The same token is in two bots (neither is turned on) | Use a different token for each bot |
| Conflict · the same bot is turned on elsewhere | Two places, such as a PC and a hub, are receiving the same bot (only Telegram and Slack can detect this; Discord does not report it, so it shows "Connected") | Turn off the bot in one place (clears within 1 minute) |
| Telegram group normal messages off | Cannot receive normal group messages | `/setprivacy` → Disable in 4.1 |

- To get real answers, this PC's AI replies (real runs) must be on (the **AI replies** switch at the top of this PC's screen, or **Turn on and send** when sending the first question on the web). Until turned on once on the web, it does not answer messenger questions. If it is off, the bot replies "Real runs are off in the connector".
- Do not put the same bot token in a PC and a hub at the same time (if two places receive the same bot at the same time, messages get split).

## 4. Creating a bot for each messenger

### 4.1 Telegram (easiest)

1. In Telegram, open `@BotFather` and send `/newbot`.
2. Set a display name and username (must end in `bot`, for example `Test_cyhuh_01_bot`), and a token appears.
3. Enter it in the token field in Ieon **Messengers → Telegram** and press **Connect** (for additional bots, **Settings → Messenger → that bot → Token**).
4. Finding the bot: search for `@username` in Telegram search, or open the `open` link in the startup log. Press **Start**. The bot appears in the chat list like a normal chat.
5. To use it in a group: in BotFather, `/setprivacy` → choose the bot → **Disable** (so the bot can read normal group messages). On success, "Success! The new status is: DISABLED." appears. Invite the bot to the group. You can connect a different session to each **Topic** in the group.
   - **A bot that was already in the group must be removed and added again** for the changed setting to apply to that group.
   - Check whether it applied with `"canReadAll":true` in the messenger log (rereads when the messenger restarts).

### 4.2 Discord

1. https://discord.com/developers/applications → **New Application** → enter a name.
2. **Bot** on the left → issue a token with **Reset Token** → the token field in Ieon **Messengers → Discord** (for additional bots, **Settings → Messenger → that bot → Token**).
3. On the same **Bot** screen, turn on **Message Content Intent** (if off, it cannot read message content). On the Korean Discord screen it is shown in Korean.
4. Invite the bot to your server: open the `invite` link in the startup log, or choose in **OAuth2 → URL Generator** (with a localized name on non-English Discord screens).
   - Scope: `bot` only
   - Bot permissions: the three `View Channels`, `Send Messages`, `Read Message History`
   - Integration type: `Guild Install`
   - Copy the **Generated URL** below, open it in a browser, choose the server, and authorize. If `guilds` in the log is 1 or more, it joined.
5. Finding the bot: the bot appears in the **member list** (the person icon at the top right of the channel screen), not the channel list.
   - Using it in a channel: just write in that channel.
   - Using it 1:1: click the bot in the member list and send a message, and a bot chat appears under **Direct Messages** at the top left.
6. If the connection drops now and then (`closed`, code 1006), it reconnects automatically after 2 seconds. 4004 is a token error and 4014 means Message Content Intent is off; these do not reconnect automatically.

### 4.3 Slack

1. https://api.slack.com/apps → **Create New App** → choose **From an app manifest**. Do not use AI agent templates such as Claude/OpenAI or the Slack CLI (`slack create`) examples (see the caution below).
2. Choose the workspace → format **YAML** → paste the following and Create.

```yaml
display_information:
  name: ieon
  description: Ieon — forwards questions to work sessions on this PC
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

3. **Basic Information → App-Level Tokens → Generate Token and Scopes**: name `socket`, scope `connections:write` → `xapp-…` → the app token field in Ieon **Messengers → Slack** (for additional bots, **Settings → Messenger → that bot → Token**).
4. **Install App → Install to <workspace>** → **Bot User OAuth Token** (`xoxb-…`) → the bot token field in the same place. Fill both fields and press **Connect**.
5. Using the bot:
   - 1:1: open the app from **Apps** in the left sidebar and write in the **Messages** tab (if you don't see it, search in **+ Add apps**).
   - Channel: the channel name at the top of the channel screen (`# bot`, etc.) → the **Agents & apps** tab in the channel info panel (Integrations on older Slack screens) → add with **Add agents and apps**. Or type `/invite @appname` in the channel input — the display name must be exact, so pick it from the autocomplete list.
6. In Slack, Slack intercepts messages starting with `/`, so Ieon commands **start with `!`** (`!whoami`, `!sessions`, `!use 1` …).

**What Socket Mode is**: instead of Slack sending events to our public address, the bot connects to Slack first, keeps the connection open, and receives messages. Even if this PC has a public address, no port needs to be opened, so it is safer. The App-Level Token (`xapp`) is for this connection, and the Bot Token (`xoxb`) is for replies.

**Caution — if another program attaches to the same app, messages get split**: when there are several connections to the same app, Socket Mode sends each message to only one of them. On 2026-10-31, a Slack CLI example (`slack run` in `D:\slack\my-app`, app name `my-app (local)`) was attached to the same app, took the 1:1 chats, and replied with nonsense. Do not run other programs such as `slack run` on the Slack app the Ieon bot uses. The surest way is to create an Ieon-only app with the manifest above.

### 4.5 LINE — 2026-11-12 L1

Like Kakao, LINE works by **LINE sending webhooks to our public address**, so a public server (currently the hub) receives them and holds them, and the messenger connects first and picks them up (the relay's per-messenger queue `?channel=line`). The signature (`X-Line-Signature`, an HMAC-SHA256 made with the channel secret) is checked by the messenger side, which holds the channel secret, and invalid ones are discarded. Only 1:1 chats are received.

1. **Create a LINE Official Account:** with a LINE account, create an official account in [LINE Official Account Manager](https://manager.line.biz).
2. **Turn on Messaging API:** in the settings of the official account management screen, turn on **Use Messaging API** (the first time, set a provider name). This creates a **Messaging API channel** for that account in the [LINE Developers](https://developers.line.biz) console.
3. **Get two values:** LINE Developers → that channel → **Channel secret** in **Basic settings**, and **Channel access token (long-lived)** → Issue in the **Messaging API** tab.
4. **Enter them in Ieon:** on the Ieon **hub screen**, **Messengers → LINE** at the bottom left → paste into the two fields (Channel access token, Channel secret), and **Copy** the **Webhook URL** below them.
5. **Enter the address in LINE:** paste it into **Webhook URL** in the LINE Developers **Messaging API** tab, press **Verify**, then turn on **Use webhook**.
6. **Turn off auto-response:** in **Response settings** on the official account management screen, turn off **Auto-response messages** (if on, LINE also sends its preset replies).
7. **Connect:** press **Connect** in the Ieon messenger window; once the bot connects, a **6-digit number** appears. In LINE on your phone, **add the official account as a friend** (QR code in the Messaging API tab) and send the number in a **1:1 chat** to register as the owner.
8. **Ask:** `/sessions` → `/use 1` → question. It answers only when AI replies (section 3) are on.

- Token names: default bot `LINE_CHANNEL_ACCESS_TOKEN`·`LINE_CHANNEL_SECRET`, additional bots `LINE_BOT_<ID>_ACCESS_TOKEN`·`LINE_BOT_<ID>_CHANNEL_SECRET` (entered on the web only).
- Webhook URL: hub `https://<hub>/line/webhook/<secret path>` (the same secret path value as the Kakao skill URL). Copy it from the messenger window, not **Settings → Messenger**.
- Replies (reply) are free; sending (push) counts against the official account plan's monthly free messages. If the answer arrives within 20 seconds, Ieon sends it as a reply; if later, it sends "Got it" as a reply and sends the real answer as a push.

## 5. Connecting for the first time (common steps)

1. Press **Messengers** at the bottom left of the web screen and choose a messenger. Bots that are turned off cannot be chosen.
2. Follow the short instructions, enter the bot token, and press **Connect** (Telegram and Discord: 1 field, Slack: 2 fields; if already saved, only when changing it). For KakaoTalk, copy the skill URL, paste it into Open Builder, and press **I pasted it**.
3. When the bot connects, a **6-digit number** appears in large type on screen. In the messenger, send **only the number** to that bot. When the screen shows "○○ is now registered as the owner", you're done (no restart needed, no copying user IDs).
   - The number can be used once within 10 minutes. After 5 wrong tries it locks, so press **Get a new number**.
   - If an already allowed person sends it, the bot replies "You're already allowed, so nothing extra was registered" and the screen changes to complete (it does not go as a question).
   - Another way: send anything to the bot (or `/whoami`, Slack `!whoami`), then press **Allow** in the "people waiting for messenger access" banner on the conversation screen or in **Settings → Messenger → Access requests**.
4. See the list with `/sessions` and connect this chat room to a session with `/use <number>`. After that, normal messages go to that session as questions.

| Command (Slack uses `!`) | Action |
| --- | --- |
| `/whoami` | My user ID, chat room, and whether allowed (works even before being allowed) |
| `/sessions` | Connectable sessions and their status (ready to send, processing, engine off, needs review, PC disconnected) |
| `/use <number>` | Connect this chat room to that session (saved separately per chat room) |
| `/status` | Connected session status (if a question needing review is blocking, one line on whether the session it was sent to is the same as the current one) |
| `/review done` · `/review not` | Resolve a result-unknown question with what you found in the original session (not resent) |
| (receipt notice) | If you have ever opened the web at a public https address, a "View task: https://…/#task=…" link is attached — pressing it shows that task (question, approvals, result) after login |
| `/allow n` · `/deny n` | Answer a work mode approval request (owner only; on Korean bots also `/허용 n` · `/거부 n`) |
| `/done n` · `/drop n` | Record a task handed to a human (a work mode "human task") as Done by me or Won't do (owner only; on Korean bots also `/처리 n` · `/중단 n`) |
| `/stop` (Korean bots also `/중지`) | Stop only the last question in this chat room (asker or owner only). If not started yet, it stops immediately; if running, it reports "Stopped" after confirming it stopped. For a Claude window (channel), stop it in the original window while running |
| `/new codex|claude|antigravity <name>` | Create a new session and connect this chat room to it (when the new session feature is on, 6.4 — Antigravity when installed on that PC) |
| `/sleep`·`/archived`·`/restore`·`/close`·`/limits` | New session sleep, archive list, restore, delete, limits (6.4) |
| `/help` | Command list |

## 6. Adding more

### 6.1 Making more chat rooms and connecting them to other sessions

Do not add bots. Create a new chat room, add the same bot, and just do `/use <number>`.

- Telegram: invite the bot to a new group (or a new topic in a group) → `/use`.
- Discord: a new channel in the server (for example, `#claude-dev`) → the bot is already in the server, so just `/use`.
- Slack: new channel → **Integrations → Add an App** → `!use`.

### 6.2 Adding bots to the same messenger (multiple bots)

> This section is based on **multiple bots completed through M3**. Bot registration, name, call name, role, and visible sessions are set on the web in **Settings → Messenger** (④). The **engine and permission limits** set in a role apply to that bot's `/new`, and the **AI role instructions** are added before the first question of new sessions created with `/new` on that bot (not added to connected existing sessions). New sessions created from a bot are visible only **to the bot that created them and on the web** (they do not appear in other bots' `/sessions`).

Adding the same bot to another Discord server or Slack workspace is not adding a bot (just invite or install it in that server or workspace). Below is how to **create one more bot**.

**① Choose a bot ID**

The bot ID is the tag Ieon uses to tell bots apart. It is 2–32 lowercase letters, digits, and `-`, and **once set, it is not changed** (token variable names and chat room connections are tied to it). The name people see and the call name are set separately on the web in **Settings → Messenger**. The bot ID of the current bot is `default`. The example below uses bot ID `ieun01`.

| Name | Example | Where it is set |
| --- | --- | --- |
| Name on the messenger side | Telegram `@ieun_cyhuh_bot`, Discord `code-review`, Slack `ieon-review` | Each messenger (you) |
| Bot ID | `ieun01` | Ieon (you choose and register it) |
| Display name, role, call name | `Code review bot`, `review` | Web Settings → Messenger |

**② Create the bot (app) in the messenger**

Each bot (app) has its own token. Do not use the same token in two bots or two programs.

- Telegram: like 4.1, `@BotFather` → `/newbot` (for an existing bot, `/mybots` → bot → API Token). For groups, `/setprivacy` → Disable.
- Discord: like 4.2, create one more **New Application** (one bot per app). Turn on Message Content Intent and invite it to the server with the OAuth2 URL.
- Slack: like 4.3, create one more app with **From an app manifest**. Paste **the entire manifest from start to end** and change only `name` and `display_name` (pasting only part causes errors and turns Socket Mode off).

  ```yaml
  display_information:
    name: ieon-review
    description: Ieon — forwards questions to work sessions on this PC
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

  App-Level Token: name `socket`, scope `connections:write` only (`xapp-…`). After Install App, the Bot User OAuth Token (`xoxb-…`).

**③ Enter the token in that bot's token field after adding the bot in ④** (do not paste it into chats). Ieon sets the token naming rules on its own.

**④ Register the bot in Ieon (web Settings → Messenger)**

1. On the web screen (**Ieon** on the desktop), press **Settings** (⚙) at the bottom left → the **Messenger** tab (the "Advanced" link in the messenger window also comes here).
2. Below the bot list, choose a messenger, enter a **New bot ID**, and press **Add bot**.
3. Click that bot in the list to open the edit panel.
   - **Name**: the name used in Ieon (any language allowed)
   - **Role**: choose from the role list (optional)
   - **Call name**: comma-separated (for example, `review, reviewbot`). If it overlaps with another bot in the same messenger, it is not saved. If left blank, the bot is called by its bot ID.
   - **Extra allowed users**: messenger user IDs to allow for this bot only (comma-separated)
   - **Visible existing sessions**: check the sessions to show in this bot's `/sessions`
   - **On**: if off, the messenger does not launch this bot
   - **Token**: enter the token from the messenger and save (not shown again; to change, enter a new one or delete)
   - **Status**: Connected, No token, Duplicate token, actual bot name, Telegram group normal messages off
4. **Save** → applied to the messenger within 1 minute (tokens also within 1 minute; no restart needed).
5. Allowing users for an additional bot: add them to that bot's **Extra allowed users**, or after they talk to the bot, press **Allow** in **Access requests** (number registration in the messenger window is for the default bot `default`).
6. **Roles** (**Settings → Admin → Messenger advanced → Roles**, admin only): set the role ID, name, description, engines it can create, allowed permissions (read only, read and write inside the work folder), AI role instructions, and default session, then **Save role**. A role used by a bot cannot be deleted.

**⑤ Check**

- Check that each bot's status in the bot list is "Connected".
- Send that bot `/whoami` (Slack `!whoami`) → it is normal if the **bot ID** and **chat room** key (`<messenger>:<bot ID>:<chat room>`) differ per bot.
- `/sessions` differs per bot: an existing session is visible only if that bot (`app_bot_<messenger>_<bot ID>`) is in the `appIds` of the server registration. The default bot is `app_messenger` as before.

**⑥ When there are several bots in the same room (M2)**

| Situation | Who answers |
| --- | --- |
| 1:1 chat | That bot |
| A message that **calls** a bot in a group or channel | Only the called bot. Ways to call: start with the call name (`review, …` · `review: …` · `@review …`; Korean bots also accept a Korean call suffix), a messenger mention (`@ieun_cyhuh_bot` · `@code-review` · Slack `@ieon-review`), replying to that bot's message, Telegram `/command@botusername` |
| A message that **does not call** a bot in a group or channel | If only one of our bots in that room is connected to a session, that bot. If two or more are connected, **no one answers** |
| A room where no bot is connected | Without calling, two bots may answer together → at first, `/use` with the call name or a mention |

- The call name is stripped and only the rest is sent as the question or command (`review, /use 1` → `/use 1`).
- If the role has a default session, when the bot receives the first message in a room with no connection, it automatically connects to that session and says so.
- `/whoami` and `/help` show the bot name, role, and call name.

### 6.3 Allowing another person (or another account of yours)

When that person talks to the bot, they appear in the "people waiting for messenger access" banner on the conversation screen and in web **Settings → Messenger → Access requests**. Pressing **Allow** makes them an extra allowed user of that bot. Allowed people can ask questions in connected sessions, so as a rule, add only your own accounts.

### 6.6 Sharing with members (shared bots, 2026-11-19)

Members approved after turning on **Multi-user** on the hub share the current bots as they are (no new bot or token needed; Kakao uses the same method since 2026-11-19 — Kakao cannot send first, so scheduled answers do not go to Kakao rooms).

1. The member presses **Get linking number** in the hub screen's **Settings → Messenger → Messenger connection** (6 digits, 10 minutes, one use).
2. They send that number to the bot 1:1 → the bot replies "Connected to your Ieon account" (if wrong, "The number doesn't match"), and that messenger account is linked to that member (no need to press "Allow" separately).
3. From that account, `/sessions`, questions, `/allow n` (Korean bots: `/허용 n`), and `/new` all reach **only that member's conversations**. Your conversations are not visible. Scheduled answers and archive notices for that person's conversations also arrive in the room that person chose with `/use`.

- Accounts that are not linked follow the allow rules in 6.3 as before (allowed people = your conversations). **Do not link your own messenger account** (if linked, that account sees only that member's conversations).
- After 5 wrong numbers, that messenger account is blocked for 15 minutes. Numbers are not recorded. Deleting or disconnecting a member also removes the link.
- In group rooms one room is tied to one conversation, so 1:1 chats are recommended for members (the server blocks other people's conversations).
- If you get "You've used up today's question limit", the daily question limit set by the hub admin has been used up. You can use it again at midnight Korea time (not resent automatically).

### 6.4 Creating new sessions from a messenger

A feature where Ieon creates a new Codex or Claude session for you. First, save "Turn on new session creation" in web **Settings → Admin → Register conversations → New session**.

| Command (Slack uses `!`) | What it does |
| --- | --- |
| `/new codex <name>`, `/new claude <name>`, `/new antigravity <name>` (`read_only` can be added at the end) | Create a new session and connect this chat room to it |
| `/sleep <name>` | Put to sleep right away (wakes again when you ask) |
| `/archived`, `/restore <name>` | Archive list, restore from archive |
| `/close <name>` → `/close <name> confirm` (Korean bots: `/close <이름> 확인`) | Delete (Ieon records only; cannot be undone) |
| `/limits` | Number of new sessions and limits |

- `full` (command execution, internet) permission cannot be chosen from a messenger.
- `/sessions` also shows the new session status (before first question, awake, asleep), and archived sessions are left out.
- Starting 3 days before archiving, a notice is sent once a day to the chat room connected to that session. If nothing has been said in that chat room since the messenger bot was turned back on, the notice cannot be sent.

### 6.5 Adding existing sessions (Codex conversations, Claude sessions) to the bot list

The bot list (`/sessions`) is the sessions registered on the Ieon server. Everything is done on the web.

1. Choose Codex conversations with **＋ Connect conversation** on this PC's screen. The allowlist entry and session registration happen in one step, and it is visible on the web and to the default bot. If it is not in the list, **＋ Connect conversation → Advanced: enter conversation ID**.
   - To register a Claude channel session or register from the hub screen, enter the name, engine, PC, and session ID in **Register manually** in **Settings → Admin → Register conversations** and save (a Codex conversation must also be in that PC's **Settings → This PC** allowlist to run).
2. To make it visible to additional bots too, check it in **Settings → Messenger → that bot → Visible existing sessions** and save.

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The bot does not show up in the messenger app | The bot has not been brought into the chat list | Telegram: search `@name` and Start / Discord: server member list / Slack: Apps or channel Integrations |
| The bot does not answer at all | Not in the allowlist, bot not started, Discord Message Content Intent off, Telegram group privacy on | Check whether allowed with `/whoami`, check `messenger.log` |
| Nonsense answers in Slack 1:1 | Another program (`slack run`, etc.) is connected to the same app | Quit that program or create an Ieon-only app |
| `/invite @name` → "A valid member name is required" | Does not match the display name | Pick from autocomplete, or Integrations → Add an App |
| "Real runs are off in the connector" | AI replies (real runs) off | Turn on the **AI replies** switch at the top of this PC's screen (for hub new sessions, the hub new session real runs setting in the hub's **Settings → Admin → Hub security → Codex login (this hub)**) |
| A reply like "This PC is connected to a hub…" | This PC is connected to a hub, so it does not accept questions from the PC's bot | Send from the bot connected to the hub |
| "Not sent because this conversation is open in Desktop" | The Codex app has the alternate-mode conversation open | Close that conversation in the app and ask again |
| "engine off" (Claude) | Claude channel session not running | Start the Claude channel session ([MANUAL](MANUAL.md) "Claude channel session") |
| "Result unknown" | Result unknown | After checking the original session, `/review done` or `/review not` |
| Questions to the same session from several messengers at once → only one processed | One at a time per session | Ask the next question after getting the answer |
| An additional bot does not turn on (status "No token") | That bot's token has not been entered yet | Enter it in **Token** in the bot edit panel of **Settings → Messenger** |
| An additional bot is not in the log at all | The bot is not registered on the Ieon server or is off | Add and turn on in **Settings → Messenger** (6.2 ④) |
| Cannot choose a messenger in the messenger window | That bot is off (such as a bot moved to a hub) | If it is a bot to use on this screen, "Turn on this bot" in **Settings → Messenger** (do not turn on the same bot in two places) |
| Sent the number but got "The number doesn't match" | The number is different or expired | Check the number on screen; if 10 minutes passed or it is locked, **Get a new number** |
| Two bots answer together in the same channel | No bot in that room is connected to a session yet | `/use` each bot with its call name or a mention |
| No bot answers in a group | Both bots are connected but neither was called | Call one with its call name or a mention |
| A Telegram bot does not react to normal messages in a group | Privacy on, or not re-added to the group after changing the setting | `/setprivacy` → Disable, then remove the bot from the group and add it again |
| An additional Discord bot is not in the channel (log `guilds`:0) | Not invited to the server | Invite with the OAuth2 URL in 4.2 |
| `my-app (local)` answers in a Slack channel | An old Slack CLI example (`slack run`) is attached to the same app | Turn off that program and remove that app in the channel's **Agents & apps** |
| `/new` says "New sessions are turned off" | Feature off | Turn it on in web **Settings → Admin → Register conversations → New session** |
| Pressing the `/close` link only shows the same instructions again | Telegram turns only `/close` into a link | Type `/close <name> confirm` yourself (Korean bots: `/close <이름> 확인`) |
| Archive notices do not arrive | Nothing has been said in that chat room since the bot was turned back on | Send any message in that room once |

## 8. Verification status (2026-10-31 · updated 2026-11-05)

| Item | Status |
| --- | --- |
| Telegram 1:1: `/whoami`, `/sessions`, `/use`, real Codex answer | Verified |
| Discord channel: same flow, real Codex answer | Verified |
| Discord 1:1 | Supported, not verified |
| Slack channel (`#bot`): same flow, real Codex answer | Verified (using the example app token) |
| Slack 1:1 | Not working due to conflict with the example app → needs re-verification with a dedicated app |
| Claude sessions from messengers | Not verified |
| Telegram groups and topics | Not verified |
| **Multiple bots (2026-11-05, M1):** Telegram `default` `@Test_cyhuh_01_bot` and `ieun01` `@ieun_cyhuh_bot`, Discord `default` `Test_bot` and `ieun01` `코드리뷰` (Code Review), Slack `default` `ieon` and `ieun01` `ieon-review` connected at the same time | Verified |
| Two bots in the same Discord/Slack channel `/whoami` → bot ID and chat room key differ per bot | Verified |
| Telegram `/setprivacy` Disable, then `canReadAll` true | Verified |
| Only the called bot answers in the same room (M2): Discord `/whoami`, `@코드리뷰 /whoami`, `ieun01, /whoami`, `ieun01, /sessions`; Slack `!whoami`, `@ieon-review !whoami`, `ieun01, !whoami`, `@ieon-review !sessions` | Verified (2026-11-06, after fixes) |
| Web bot edit screen (M2-W, now Settings → Messenger): roles, adding bots, editing, rejecting duplicate call names, visible sessions | Verified on test server |
| Owner registration number in the messenger window (U5, 2026-11-12): an already allowed person sends the number to the hub Telegram bot → "You're already allowed…" and the screen completes | Verified |
| Number registration by a new, not-yet-allowed person; Kakao skill URL flow (messenger window) | Not verified (tests only) |
| Telegram 1:1 new session (2026-11-05): `/new codex`, question, `/sessions`, `/sleep`, `/limits`, `/close` confirmation step | Verified |
| Claude new sessions from messengers, Discord/Slack `/new`, actual delivery of archive notices | Not verified |
