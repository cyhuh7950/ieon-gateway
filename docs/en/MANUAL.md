<!-- source: docs/MANUAL.md @ 10e60c2 -->
# Ieon User Manual

- As of: the 2026-11-23 screens (main `10e60c2` and later). Menu and button names in this manual are **exactly the text on the screen**.
- Basis: written on 2026-11-23 from the results of an AI worker who built a test environment (test hub, test PC, test accounts) and pressed through every screen. The results are at the end in [Test evidence](#test-evidence-and-what-is-not-yet-verified).
- Detailed behavior by feature, the HTTP API, and advanced features (Codex shared use, the Claude channel window) are in the [Reference Manual](MANUAL_REFERENCE.md). Install commands are in the [Beginner's Guide](BEGINNER_GUIDE.md).

## How to read this manual

| I... | Read it like this |
| --- | --- |
| am new | Follow **Part 1 in order, starting from Chapter 1**. That takes you from installation to questions and messengers. Each step links to the Part 2 description of the screen it uses. |
| have used it and want only what I need | Find "what you want to do" in the [Index](#index) at the end, then go to the chapter or screen. |
| have something that doesn't work | See the status text, card, and message tables in [Part 3 Troubleshooting](#part-3-troubleshooting). |

There are three kinds of Ieon users. Each chapter says who it is for.

| Name | Who | Shown at the top left |
| --- | --- | --- |
| **PC mode** | Someone who uses Ieon only on their own PC. The PC screen (`http://127.0.0.1:28760`) opens without logging in. | "This PC" |
| **Hub admin** | Someone who installs and runs a public server (hub). Logs in with a password. | "Hub · address · Administrator" |
| **Member** | Someone who signs up on another person's hub. Logs in with an email and password. | "Hub · address · email" |

Notifications (e.g. "Scheduled task created", "Connection method changed") appear for a few seconds **at the top center of the screen**. Green means done; red means it did not work (with the reason).

How text is shown: **bold text** is a button or menu you press, and "quoted text" is text that appears on the screen. Arrows, as in "Settings → Apps and devices → Devices", show the order in which you press things.

---

## Part 1 Task flow

### Chapter 1 What you need and installation

**Who:** everyone (members only need 1-3)

Ieon lets you send questions from the web, messengers, and apps into **Codex and Claude Code work conversations you already use**, and brings back that conversation's answers. It never secretly creates new conversations or copies conversations. When you need one, Ieon can also create a new session (Chapter 6).

#### 1-1. What you need

| What you need | Why | If you don't have it |
| --- | --- | --- |
| A Windows 10/11 or Linux PC | Ieon and the connector (the part that picks up questions and feeds them to the engine) run on this PC | You can't use Ieon |
| Node.js 20 or later | Runs Ieon | The install script tells you |
| Codex (ChatGPT subscription login) or Claude Code (Pro/Max subscription or API key) | The engine that actually answers | Step 1 of first-time setup shows "Login required". Installation still continues |
| (Hub mode) One public server and a domain (https recommended) | Use it away from home, on your phone, or with several people; KakaoTalk and LINE | Use PC mode only (Telegram, Discord, and Slack also work in PC mode) |
| (Messengers) Telegram, Discord, or Slack bot tokens; a Kakao Open Builder or LINE Developers account | Ask questions from messengers | Use the web and the app without messengers |
| (Voice, optional) An OpenAI API key | Voice input in any browser, live voice conversation | Use the browser's built-in voice (Chrome, Edge, Safari) |

#### 1-2. Installation (PC mode and hub mode)

- **Windows PC:** run `pwsh scripts/install.ps1` once in the Ieon folder. It installs the parts, sets things up, starts Ieon automatically at logon, and creates the desktop shortcut **Ieon**. For the detailed steps, see [Beginner's Guide section 1](BEGINNER_GUIDE.md).
- **Linux PC:** `bash scripts/ieon.sh init`, then `bash scripts/ieon.sh start --live`. The screen is at `http://127.0.0.1:28760`.
- **Hub (public server):** run the install command in [Beginner's Guide 8-1](BEGINNER_GUIDE.md) once. If you already have a hub, use **Settings → Admin → Hub security → Install on a new server → Create install command** and paste the command it makes into the new server.

After installation: PC mode goes to Chapter 2, and a hub goes to Chapter 3.

#### 1-3. What members need

The **hub address** the hub admin gave you, your email, and your PC (with Ieon installed and Codex logged in). Go to Chapter 15, "Members".

---

### Chapter 2 Start using it on this PC only (first-time setup)

**Who:** PC mode · **Screens used:** [First-time setup](#first-time-setup-4-steps), [Left list](#left-list)

1. Open **Ieon** on the desktop (or `http://127.0.0.1:28760`). If no conversation is connected yet, first-time setup opens by itself.
2. In "How will you use it?", press **This PC only**. (If you have a hub, press **Connect to my hub** → Chapter 4.)
3. In "Start Ieon", check that the Codex row says "✓ Ready". Even with "Login required" you can press **Continue** (log in to Codex later).
4. In "Choose a conversation to continue" (takes about 10 seconds), press one Codex conversation to continue. This is the only choice you must make.
5. In "Ready", press **Open conversation**. Messengers and the hub can wait (the **Set up** buttons).

When you finish, the conversation appears in the left list, and first-time setup doesn't open the next time. To see it again, add `/#setup` to the end of the address. If you press **Do it later**, the mode is set to "This PC only" and the setup closes.

Next: Chapter 7 (asking questions). To connect more conversations, see Chapter 5.

---

### Chapter 3 Create a hub and log in as admin

**Who:** hub admin · **Screens used:** [Create admin](#create-admin), [Log in](#log-in), [Hub security tab](#admin--hub-security)

1. Open the hub address in a browser and "Create admin" appears. Enter a password (10 or more characters) twice and press **Create**.
   - If the two boxes differ: "The two passwords don't match". If it's too short: "Password must be at least 10 characters".
2. From then on, on the "Log in" screen, **leave the email box empty**, enter only the password, and press **Log in**. If the top left shows "Hub · address · Administrator", it worked.
   - After 5 wrong passwords: "Too many failed attempts; temporarily locked" (15 minutes).
3. In **Settings → Admin → Hub security → Security (hub access restriction)**, decide who can reach the hub. Look at "Your current address", press **Add my address** → **Save**. If your phone or other people need it, add their addresses too, or use the Cloudflare Access or Tailscale method (places that aren't allowed get "access denied").
4. To use new sessions (Chapter 6) on the hub itself, press **Log in** under **Codex login (this hub)** on the same tab.

Next: Chapter 4 (connecting a PC).

---

### Chapter 4 Connect a PC to the hub

**Who:** hub admin and members (their own PC) · **Screens used:** [Apps and devices tab](#my-settings--apps-and-devices), PC screen [Hub connection](#hub-connection-pc-screen)

**Easiest way — PC connection link (tested)**

1. On the hub screen, open **Settings → Apps and devices → Devices → PC connection link** and press **Create link**. The link works once within 10 minutes. Press **Copy**.
2. Open that link **on the PC you want to connect**. The PC screen shows "Connect this PC to the hub?" and "Hub to connect: address". Press **Connect** **only if it's a link you made** (if you leave this PC's name empty, the computer name is used).
3. "Connected to the hub…" appears, and the status changes to "hub address · PC name · Connected". The usage mode becomes "Connect to my hub" automatically.
4. On the hub screen, the PC shows as "Connected" in the table under **Settings → Apps and devices → Devices**.

**Manual way — 6-digit code**

1. On the PC screen, go to **Settings → Apps and devices → Hub connection → Connect to hub**, enter the hub address, and press **Connect** → a 6-digit code appears.
2. On the hub screen, in **Settings → Apps and devices → Devices → Connection requests**, check that it's the same code and press **Approve**.

**Things to know after connecting**

- The screen of a PC connected to a hub shows the card "This PC is connected to a hub" and **Open hub screen**. **Ask questions and use the conversation list on the hub screen.**
- To reconnect, disconnect, or forget the hub, use **Settings → Apps and devices → Hub connection** on the PC screen.
- To change that PC's settings (AI replies, allowlist, and so on) from the hub screen, pick the PC in **Settings → PC settings**. If the PC is off, "That PC isn't connected…" appears in the tab and the fields are locked.

---

### Chapter 5 Connect a conversation

**Who:** everyone · **Screens used:** [Connect conversation window](#connect-conversation-window), [PC settings tab](#my-settings--this-pc--pc-settings)

1. At the top left, press **＋ Connect conversation**.
2. (Hub) Choose your PC in the "PC" box. Members see only their own PCs.
3. In the "Codex conversations used recently on that PC" list, press one (takes about 10 seconds).
4. The conversation opens right away and appears in the left list (on a hub, under the PC name). It is also added to the allowlist in the same step.

- If it's not in the list, enter the Codex conversation ID and the name to show in the list under **Advanced: enter conversation ID** and press **Connect**.
- You can do the same thing with **Settings → This PC (on a hub, PC settings) → Codex conversations on that PC → Load conversation list → Connect**.
- Claude Code conversations and Antigravity or Grok sessions are registered by the admin in **Settings → Admin → Register conversations → Register sessions manually**, and added to **Settings → This PC → Antigravity · Grok allowlist** on the PC that will run them.

---

### Chapter 6 Create a new session

**Who:** everyone (on a hub or PC where the admin has turned on new sessions) · **Screens used:** [New session window](#new-session-window), [Connection settings](#connection-settings)

Ieon creates a new Codex, Claude, Antigravity, or Grok session with its own work folder.

1. At the top left, press **＋ New session**.
2. Choose the engine, (hub) **Where**, the name (2–32 letters, digits, or -), and the permission, then press **Create**.
   - A hub admin chooses from "Hub (text replies only)" and the PCs and engine cells. A member chooses from their own PCs (a PC that is on is picked first).
   - The permission "Full (run commands, internet)" appears only when the admin allows it in **Settings → Admin → Register conversations → New session settings**.
3. "Created new session "name". It starts when you send the first question." → it appears in the list, and its status is "Ready to send" (the session is actually created when you send the first question).
4. It starts when you send the first question (Chapter 7).

Tidying up: after 30 minutes without use it is "Asleep" (it wakes when you ask), and after 14 days without use it goes to the archive (restore it before asking). To delete, use **Connection settings → New session → Delete** (with a confirmation window). Sleep and delete are blocked for conversations that already existed, with the notice "Only new sessions made in Ieon can be put to sleep or deleted…".

---

### Chapter 7 Ask questions and get answers

**Who:** everyone · **Screens used:** [Conversation header](#conversation-header), [Messages and input bar](#messages-and-input-bar), [To-do cards](#to-do-cards)

1. Choose a conversation in the left list. Check that its status is "Ready to send".
2. Write your question in the input box at the bottom and press **Send** (Enter; for a new line, Shift+Enter).
3. The status changes in the order "✓ Received → Running… → ✓ Completed", and then the answer bubble appears. To stop, press **Stop**.

- **AI replies switch:** "AI replies on/off" at the top of the PC screen. If it's off, the first time you send, the "AI will answer this question" window appears; press **Turn on and send**. On the hub screen it shows as "AI replies (PC settings)", and pressing it tells you where to change it (**Settings → PC settings → Real runs · Codex allowlist → Turn on real runs**).
- **Codex conversations use Fast replies (the default):** Ieon keeps a Codex running for that conversation, so answers come in a few seconds (about 10 seconds of preparation right after Ieon starts). Meanwhile, **don't use that conversation in the Codex app.** If you often open it in the Codex app too, switch to **Alternate** in Connection settings → Advanced. In Alternate mode, if the conversation is open in the Codex app when you send, it is not sent (the app can stay on; just close that conversation), and answers can take over 10 seconds.
- If something blocks it, a **card** in the conversation shows the reason and buttons ([Card table](#card-table)).
- A question whose result is unknown is locked with the "Question needing review" card. Check whether it ran in the original session, then press **It ran** or **It didn't run**. Ieon never resends anything on its own.

---

### Chapter 8 Work mode and approvals

**Who:** everyone (Codex and Antigravity conversations) · **Screens used:** [Connection settings](#connection-settings), [To-do cards](#to-do-cards)

Normal questions are read-only. When you need to edit files or run commands, turn on work mode for that one conversation.

1. **Connection settings → Work mode → Turn on work mode** (with a confirmation window). A "Work mode" chip appears in the header.
   - You can turn it on only for conversations that have a work folder (the work folder in **Settings → This PC (on a hub, PC settings) → Real runs · Codex allowlist**).
2. When you send a question, each time the engine tries to edit a file or run a command, the card "OK to edit files?" or "OK to run a command?" appears.
3. Press **Allow** (this time only) or **Deny**. If you don't answer within the set time (15 minutes by default), it is denied.
4. The result of what you allowed (run completed, failed, or result unknown) is recorded on the same card.

**Human tasks:** In **Connection settings → Human tasks**, set "Run any command", "Edit any file", "Request more permissions", or text patterns (for example, git push). Such actions are not asked of the AI; they are handed over as a "Human task" card. If you did it yourself, press **Done by me**.

---

### Chapter 9 Tasks drawer (see each question)

**Who:** everyone · **Screens used:** [Tasks drawer](#tasks-drawer)

1. At the bottom left, press **Tasks** (with a badge for the number of pending approvals).
2. You see "Awaiting approval · human tasks", "In progress · needs review", and "Recent".
3. **Details** on a row → question, status, engine, received, last change, resume check ("Same session"), and answer. Press **To conversation** to open that conversation.

If you open a task link received in a messenger (`/#task=…`), that task opens right away. If it isn't yours: "Can't view this task".

---

### Chapter 10 AI staff and rooms

**Who:** everyone · **Screens used:** [Connection settings](#connection-settings), [Room window](#room-create-and-edit-window), [Room screen](#room-screen), [Messenger advanced tab](#admin--messenger-advanced)

1. Name each conversation: in **Connection settings → AI staff name and role**, enter a name (1–20 characters, no spaces), and an icon (one emoji), choose a role (from roles made in step 2 — if none, the box says "No roles yet"), then press **Save** → "Saved AI staff info". The list shows the icon and @name.
2. Roles (admin): in **Settings → Admin → Messenger advanced → Roles → Create · edit roles**, enter the role ID, name, engines it can create, allowed permissions, and AI role instructions, then press **Save role**. Members can also pick and use these roles.
3. Create a room: press **＋ Room** next to "Rooms" on the left → room name, members (1–10), lead, shared instructions → **Save** → "Room created".
4. Using a room: call someone with @name and that staff member answers; if you call no one, the lead answers. Each answer has **Hand off to another AI staff member**.
5. Delete a room: on the room screen, **Room settings → Delete room** (deletes only the room's history; the staff conversations stay as they are).

---

### Chapter 11 Work folders and schedules

**Who:** everyone · **Screens used:** [Work tab](#my-settings--work)

- **Work folders:** In **Settings → Work → Work folder** (on a hub, choose the "PC · cell" first), **Register** a folder name and path. Then use **Set folders** in the "AI staff" table to attach a personal folder and shared folders (read only / read and write) to each staff member. When you save, it shows "how strictly this PC actually blocks access" and asks you to confirm.
- **Scheduled tasks:** In **Settings → Work → Scheduled tasks**, enter the conversation, when (daily / interval / once), the daily max, and the question to send, then press **Create schedule** (with a confirmation window). At that time the question goes to that conversation, and the answers collect in the conversation (and its connected messenger chat). If it is busy or the PC is off, that run is skipped. To change one, press **Edit** in the table — its values fill the boxes below; change them and press **Save changes** (confirmation window; it turns back on). "Once" starts with a time 5 minutes from now.

---

### Chapter 12 Use it from messengers

**Who:** PC mode and hub admin (bot owner), members (connect to the shared bot) · **Screens used:** [Messenger connection wizard](#messenger-connection-wizard), [Messenger tab](#my-settings--messenger)

**Bot owner (PC mode, hub admin) — tested**

1. At the bottom left, press **Messengers** → choose a messenger in "Which messenger will you use?". Each row shows "Not set up", "Connected", "Not connected · tap to check the token", or "Unavailable".
2. Create a bot as the instructions say, paste the token, and press **Connect** (spaces at the start and end are removed automatically).
   - If the token is wrong: "Bot not connected — Invalid token. Go back and check the token."
   - KakaoTalk and LINE need a public address, so you connect them **from the hub (or a public relay)**. If you press them in PC mode, the reason is shown.
3. When the bot connects, "Send this number to the bot" and a 6-digit number (valid 10 minutes) appear. Send that number to the bot, and the sender is registered as the bot owner.
4. "Connected". Send the bot `/sessions` and `/use number` to choose a conversation, then ask questions.

Multiple bots, call names, and allowed users are in **Settings → Messenger → Bots**. Requests from people who aren't allowed are in **Settings → Messenger → Access requests**. For details, see the [Messenger Setup Manual](MESSENGER_MANUAL.md).

**Members — link your messenger account to the shared bot**

1. At the bottom left, press **Messengers** (or **Settings → Messenger**) → "Messenger connection".
2. Press **Get linking number** → send the number to the hub's shared bot.
3. That messenger account sees only your conversations. To unlink, press **Disconnect** in the same table.

---

### Chapter 13 Voice

**Who:** everyone · **Screens used:** [Messages and input bar](#messages-and-input-bar), [Account tab OpenAI voice](#my-settings--account)

- **Voice input (default):** 🎤 in the input bar → the first time, the "Before using voice" notice → **OK** → speak and the text goes into the input box. It works in Chrome, Edge, and Safari. In a browser where it doesn't work: "This browser doesn't support voice input…".
- **Read aloud:** **🔈 Read aloud** in the header → new answers are read out loud (code becomes "Code omitted").
- **OpenAI voice (admin setting):** enter a key in **Settings → Account → OpenAI voice** and set the voice mode to "OpenAI speak once, then listen" or "OpenAI live conversation". In live mode, pressing 🎤 shows a bar at the bottom ("Connecting… → Listening", "N min left", **Mute**, **Hang up**). The answer always comes from that conversation's work session.

---

### Chapter 14 Ieon App (phone and PC)

**Who:** everyone · **Screens used:** [Apps and devices tab](#my-settings--apps-and-devices)

1. Get the app: open `hub address/app` in your phone's browser, or use **Settings → Apps and devices → App → Get the app**.
2. **Settings → Apps and devices → Connect Ieon App → Create pairing code** → on the app's first screen, "Connect Ieon", enter the server address and the 8-digit code and press **Connect**.
3. In the app, use the conversation list, questions, cards (allow/deny), rooms, tasks, and voice the same way as on the web. To disconnect, press **Disconnect** in the same table on the web, or **Disconnect this device** in the app.

For a detailed description of each app screen, see the [Ieon App Guide](APP_GUIDE.md).

---

### Chapter 15 Use it with several people

**Who:** hub admin (15-1), members (15-2) · **Screens used:** [Hub security tab](#admin--hub-security), [Log in](#log-in), [Waiting for approval](#waiting-for-approval)

#### 15-1. Admin

1. Turn on **Settings → Admin → Hub security → Multiple users → Multi-user (accept sign-up requests)** (with a confirmation window). The login screen gets **Sign-up request** and a terms agreement box.
2. Open **Security (hub access restriction)** at the top of the same tab so other people can reach the hub (even when open, logging in is still required).
3. When a request arrives, press **Approve** or **Reject** in the table in the same section.
4. People already using it: **Disconnect** (logs them out right away), **Turn back on**, **Temporary password** (shown once in a browser alert window), **Delete**. Set the number of questions per day with **Member daily question limit** and each person's **Limit**.

#### 15-2. Members (tested)

1. Open the hub address, enter your email and a password (10 or more characters), read the **Terms of Use** and **Privacy Policy**, check the agreement box, and press **Sign-up request** → confirmation window → "Waiting for approval".
2. After the admin approves, **Log in** with the same email and password. The top left shows "Hub · address · your email".
3. Connect your PC: **Settings → Apps and devices → Devices → PC connection link → Create link** → open that link on your PC and press **Connect** (same as Chapter 4).
4. Connect conversations (Chapter 5), create new sessions (Chapter 6, on your PC only), and ask questions (Chapter 7). For messengers, see Chapter 12 "Members".
5. Change your password: **Settings → Account → My password**.

Tabs members see in Settings: **PC settings, Work, Account (My password), Messenger (Messenger connection), Apps and devices**. Hub settings, security, bots, and account logins are admin-only. Other people's conversations and PCs are not visible.

---

### Chapter 16 Engine accounts and usage

**Who:** PC mode and hub admin · **Screens used:** [Account tab](#my-settings--account)

- By default, Ieon uses the Codex and Claude already logged in on that PC ("PC default login — that PC's Codex login").
- To use another account, go to **Settings → Account → Codex accounts** (or Claude, Antigravity, or Grok accounts), press **Add account** → choose login (subscription), API key, or compatible endpoint → **Default account**. A different account per conversation is set in the per-conversation table in the same section.
- In **Usage · limits**, see each account's questions today and tokens this month, and set daily question and monthly token limits. If a limit is exceeded, the card "This conversation's API account hit its limit" appears.

---

### Chapter 17 Operations

**Who:** hub admin (some for PC mode)

| What you want to do | Where |
| --- | --- |
| Decide where the hub can be reached from | **Settings → Admin → Hub security → Security (hub access restriction)** |
| Install Ieon on a new server | **Settings → Admin → Hub security → Install on a new server → Create install command** (1 hour) |
| Questions one PC handles at once, approval card time, login duration | **Settings → Admin → Register conversations → Concurrent questions · wait time** |
| Turn on new sessions, limits, sleep, archive, allow full permission | **Settings → Admin → Register conversations → New session settings** |
| Language of text the server sends | **Settings → Admin → Register conversations → Server language** |
| An API key so your own program can call Ieon | **Settings → Admin → External programs** → program name → **Issue key** (shown only once) → save visible sessions; if no longer needed, **Revoke**. For usage, see the [API Guide](API_GUIDE.md) |
| Disconnect a PC (hub side) | **Revoke** in the table under **Settings → Apps and devices → Devices** |
| Backups, limits, running for multiple users | [Hub Operations Manual](OPERATIONS.md) |

---

## Part 2 Screen by screen

For each screen: **how to open it · what it does · steps · main items**.

### Conversation screen (`/`)

#### Log in

- **How to open:** go to the hub address (before logging in). The PC screen logs in automatically, so you don't see it there.
- **What it does:** enter the hub, request sign-up, choose the screen language.
- **Steps:** admin leaves the email empty, enters the password → **Log in**. Members enter email and password → **Log in**. First time: agreement box → **Sign-up request**.

| Item | Description |
| --- | --- |
| "Email (admin: leave blank)" | The member's email. The admin leaves it empty |
| "Password" | 10 or more characters |
| **Log in** | Enter. If wrong: "Wrong password". After 5 wrong tries, locked for 15 minutes |
| Agreement box "Terms of Use and Privacy Policy: I agree (when requesting sign-up)" | Shown only on hubs with multi-user turned on. Both documents open in a new tab |
| **Sign-up request** | Request confirmation window → waiting for approval. If the email has already applied: "This email has already applied — try logging in". If the email format is wrong: "That doesn't look like an email address" |
| Language choice (Korean/English) | Screen language |

#### Create admin

- **How to open:** when you first open a hub that has no admin.
- **What it does:** set the hub admin password.
- **Steps:** password twice → **Create** → straight to the conversation screen.

| Item | Description |
| --- | --- |
| "Password" and "Confirm password" | 10 or more characters, must match |
| **Create** | If it was already created in another tab: "An admin already exists. Please log in" |

#### Waiting for approval

- **How to open:** right after a sign-up request, or when logging in before approval.
- **What it does:** tells you that approval hasn't happened yet.
- **Main items:** "Waiting for approval" (with an ⓘ note), **Log out**. If the admin has disconnected the account, logging in shows "This account can't be used (contact the admin)".

#### First-time setup (4 steps)

- **How to open:** opens by itself on the PC screen when no conversation is connected (not on a PC connected to a hub), or at the address `/#setup`.
- **What it does:** choose the usage mode and connect the first conversation.

| Step | Screen text | What to do |
| --- | --- | --- |
| 0 | "How will you use it?" | **This PC only** / **Connect to my hub** (→ Settings, Apps and devices) / "Ieon public service" (coming soon). Skipped if the usage mode is already set |
| 1 | "Start Ieon" | Codex "✓ Ready" or "Login required", Claude Code "Later" → **Continue** |
| 2 | "Choose a conversation to continue" | Press one recent Codex conversation on this PC |
| 3 | "Ready" | "Use with messengers too — **Set up**", "Use it away from home (hub) — **Set up**", **Open conversation** |
| Bottom | **Do it later**, "1 / 3" | Do it later = set to This PC only and close |

#### Left list

- **How to open:** always shown after logging in (on a phone, it is the first screen).
- **What it does:** choose conversations and rooms, connect or create new ones, bottom menu.
- **Steps:** press a conversation and it opens on the right.

| Item | Description |
| --- | --- |
| "Ieon" + where | "This PC" or "Hub · address · Administrator/email" |
| **＋ Connect conversation** | [Connect conversation window](#connect-conversation-window) |
| **＋ New session** | [New session window](#new-session-window) |
| "Choose a usage mode — recommended: …" | Only when the PC usage mode isn't set yet. Press it to go to Settings |
| "Rooms" · **＋ Room** | Room list and the [room window](#room-create-and-edit-window) |
| "AI staff (conversations)" | Conversation rows: icon and name, "@name · engine · status", a badge with the number of to-do items. On a hub, grouped by PC name |
| "Archive N" | Archived new sessions, **Restore** |
| **Notifications** | Browser notifications "X replied" even when the tab is closed (content not included) |
| **Tasks** | [Tasks drawer](#tasks-drawer) |
| **Messengers** | PC mode and admin: [messenger wizard](#messenger-connection-wizard). Members: Messenger connection in Settings |
| **Settings** | Settings screen |
| **Log out** | Leave |

#### Conversation header

- **How to open:** at the top when you choose a conversation.
- **What it does:** see the current conversation's status and open its settings.

| Item | Description |
| --- | --- |
| Title | Conversation name (on a phone, **←** goes back to the list) |
| Engine, account, and work mode chips | Wide screens only. "Account · PC default login…" |
| Status chip | "Ready to send", "Processing", "Needs review", "PC disconnected", "Asleep · wakes when you ask", and so on |
| "AI replies on/off" switch | PC screen: turns real runs on and off (confirmation window when turning on). Hub screen: "AI replies (PC settings)" — pressing it tells you where to change it (not shown on the hub screen on a phone) |
| **🔈 Read aloud** | Reads new answers out loud |
| **Connection settings** (⋯ on a phone) | [Connection settings](#connection-settings) |

#### To-do cards

- **How to open:** appear by themselves under the header when there is something to do.
- **What it does:** shows in one place why something is blocked and what to do. For the kinds, see the [Card table](#card-table).

#### Messages and input bar

- **What it does:** send questions, see answers, voice input.
- **Steps:** write → **Send** → "✓ Received → Running… → ✓ Completed" → answer. To stop, press **Stop**.

| Item | Description |
| --- | --- |
| Bubbles | Your questions (right) and answers (left). With no history: "No messages exchanged in Ieon yet…" |
| **🎤** (voice input) | Voice input (Chapter 13) |
| "Message" input box | Enter sends, Shift+Enter adds a new line (16px text on phones — no zooming) |
| **Send** / **Stop** | Send, or stop while processing |

#### Connect conversation window

- **How to open:** **＋ Connect conversation**.
- **What it does:** connects a Codex conversation you were using on that PC to Ieon.
- **Steps:** (hub) choose the PC → press one in the list → it opens right away.

| Item | Description |
| --- | --- |
| "PC" | Hub only. Members see only their own PCs |
| Conversation list | First question, folder, last used. Ones already connected show "Connected". Conversations excluded as work-only don't appear |
| **Advanced: enter conversation ID** | Codex conversation ID and the name to show in the list → **Connect**. If the format is wrong: "Not a conversation ID format" |
| **Close** | Close (Esc or clicking outside also works) |

#### New session window

- **How to open:** **＋ New session**.
- **What it does:** Ieon creates a new session and a work folder.
- **Steps:** engine → (hub) where → name → permission → **Create**.

| Item | Description |
| --- | --- |
| Engine | Codex, Claude, Antigravity, Grok |
| Where | Admin: "Hub (text replies only)", PCs, and engine cells (" — including commands and file work"; when off, " (off)"). Members: only their own PCs |
| Name | 2–32 letters, digits, or -. If wrong: "Names are 2–32 letters, digits, or -…". If taken: "A session with the same name already exists" |
| Permission | "Read/write inside work folder (default)", "Read only" ("Full (run commands, internet)" if the admin allows it) |
| Limit line | "Now N/N · Codex …" (for the admin, also where to turn on full permission) |
| **Create**, **Close** | |

#### Room create and edit window

- **How to open:** **＋ Room** / **Room settings** on the room screen.
- **What it does:** gathers several AI staff into one room.

| Item | Description |
| --- | --- |
| "Room name" | 1–30 characters ("Room name must be 1–30 characters") |
| "Members" | Check 1–10 AI staff ("Choose 1–10 members") |
| Lead | The staff member who answers when no one is called |
| "Shared instructions (this room's purpose — added before each question)" | |
| **Delete room**, **Cancel**, **Save** | Delete has a confirmation window and deletes only the room's history |

#### Room screen

- **Main items:** **Room settings**, the note "The AI staff you call with @name replies. If you call no one, the lead @… replies.", the input bar, and on each answer **Hand off to another AI staff member** and **Resend to @…**.

#### Messenger connection wizard

- **How to open:** **Messengers** at the bottom left (PC mode and admin), or **Set up** in step 3 of first-time setup.
- **What it does:** connects one default bot and registers the bot owner.

| Step | Screen text | What to do |
| --- | --- | --- |
| 1 | "Which messenger will you use?" | One of Telegram, Discord, Slack, LINE, KakaoTalk. Status "Not set up / Connected / Not connected · tap to check the token / Unavailable / Off" |
| 2 | "Connect X" | Follow the instruction lines, paste the token → **Connect**. Slack has two boxes. KakaoTalk: **Copy** the skill URL; LINE: the Webhook URL. In PC mode, Kakao and LINE show the note "needs a public address, so connect it from the hub" |
| 3 | "Send this number to the bot" | After "Connecting the bot… (within 2 minutes)", a 6-digit number (valid 10 minutes). **Get a new number** |
| 4 | "Connected" | Bot owner registration done |
| Bottom | **Advanced: bot name, multiple bots, allowed users**, **Close** | Goes to the Messenger tab in Settings |

#### Tasks drawer

- **How to open:** **Tasks** at the bottom left, or a task link `/#task=…`.
- **What it does:** shows the progress, approvals, and results of each question in one place.

| Item | Description |
| --- | --- |
| "Awaiting approval · human tasks N" | When empty: "No pending approvals." You can press **Allow (this once)** here |
| "In progress · needs review N" | When empty: "No questions in progress." |
| "Recent" | Time and question |
| **Details** | Question, status, engine, received, last change, resume check, answer |
| **To conversation** | Opens that conversation |
| ✕ | Close (full screen on a phone) |

#### Connection settings

- **How to open:** **Connection settings** in the header (⋯ on a phone).
- **What it does:** settings for this one conversation.

| Section | Items and description |
| --- | --- |
| Top | Engine, account, connection method (for example, "Reopens the same conversation each time you send"), status |
| "Work mode" | **Turn on work mode** (Chapter 8). Not available for Claude channel conversations |
| "Human tasks" (collapsed) | Run any command, edit any file, request more permissions, text list (20 items, 60 characters each) → **Save** |
| "AI staff name and role" (collapsed) | Name, icon, role → **Save** |
| "Stored history" | **Delete this conversation's history stored on the server** (confirmation window; the original session's history stays as it is; blocked while processing) |
| "New session" | Status ("Before first question · permission read only" and so on), **Sleep** and **Delete**. Blocked for conversations that already existed, with the reason shown |
| "Advanced" (collapsed) | Codex connection method **Fast replies (default) / Alternate / Shared** (Codex conversations only), conversation ID. Choosing one shows "Connection method changed" at the top; Fast replies takes the PC about 10 seconds to prepare |

#### AI will answer this question (window)

- **How to open:** on the PC screen, the first time you send while AI replies are off.
- **Main items:** **Cancel** (don't send) and **Turn on and send**.

#### Voice windows and live bar

- "Before using voice" / "Before using OpenAI voice": a one-time notice about voice processing, **Quit** and **OK**.
- Live bar: "Connecting… / Listening…", "N min left", **Mute** / **Unmute**, **Hang up**.

#### Hub connection (PC screen)

- **How to open:** **Settings → Apps and devices → Hub connection** on the PC screen, or when you open a PC connection link.
- **What it does:** connects this PC to a hub or disconnects it.

| Item | Description |
| --- | --- |
| "Connect this PC to the hub?" | When opened from a link. "Hub to connect: address", this PC's name (empty = computer name), **Connect** and **Cancel** |
| "Connect to hub" | Hub address (for example, https://hub.example.com) and this PC's name → **Connect** → 6-digit code |
| Connection status | "hub address · PC name · Connected", **Disconnect** and **Forget hub** (**Reconnect** when needed) |

### Settings screen (`/settings`)

#### Header and tabs

- Top: **← Conversations** · "Settings" · "Hub · address" (or "This PC") · language · **Log out**. Right below it is the result banner.
- Groups **My settings | Admin** (only when Admin tabs are visible). The tab that opens first: "This PC" on the PC screen, "Messenger" on a hub (it remembers the last tab you opened).

| Group | Tab | PC mode | Hub admin | Member |
| --- | --- | --- | --- | --- |
| My settings | This PC (hub: PC settings) | ○ | ○ (choose a PC) | ○ (own PC) |
| My settings | Work | ○ | ○ | ○ |
| My settings | Account | ○ | ○ | ○ (My password only) |
| My settings | Messenger | ○ | ○ | ○ (Messenger connection only) |
| My settings | Apps and devices | ○ | ○ | ○ |
| Admin | Register conversations | ○ | ○ | — |
| Admin | Messenger advanced | ○ | ○ | — |
| Admin | Hub security | — | ○ | — |
| Admin | External programs | ○ | ○ | — |

#### My settings › This PC / PC settings

- **What it does:** that PC's usage mode, real runs, and allowlists.
- **Steps:** (hub) choose a PC in the "PC" box (at first, a PC that is on) → change the sections below. If the PC doesn't respond, a yellow box shows the reason and the fields are locked.

| Section | Items and description |
| --- | --- |
| "PC" (hub) | The PC to manage. Shows " (disconnected)" |
| "Usage mode" | "This PC only —…" / "Connect to my hub —…" → **Change usage mode** (confirms what turns off and on) |
| "Real runs · Codex allowlist" | **Turn on real runs** (same as AI replies), "Connector running", table (Codex conversation ID, connection method (fast replies by default), work folder, remove), add row → **Add to allowlist** |
| "Codex model for Ieon" | Leave empty to use the model in that PC's Codex settings. If the signed-in account can't use that model, questions are refused with "Not run because that PC's default Codex model can't be used with the current sign-in…", so enter a usable model name (e.g. gpt-6.1-sol) and press **Save model**. The Codex app's settings file is not changed |
| "Codex conversations on that PC" | **Load conversation list** → **Connect** on each row |
| "Server Claude conversations" | When a hub server engine cell is chosen, **Connect** recent Claude conversations |
| "Antigravity · Grok allowlist" (collapsed) | Engine, session ID, work folder → **Add to allowlist** |

#### My settings › Work

| Section | Items and description |
| --- | --- |
| "Work folder" | (Hub) "PC · cell" (the admin also has "The hub itself"). "Folders" table + name and path → **Register**. **Set folders** in the "AI staff" table → personal folder and shared folders (not used / read only / read and write) |
| "Scheduled tasks" | Conversation, "Daily / Interval / Once", time / interval / when to send, daily max, question to send → **Create schedule** (confirmation window). In the table: **Edit** (values fill the boxes below → **Save changes** · **Cancel edit**), turn off, turn back on, delete |

#### My settings › Account

| Section | Who | Items and description |
| --- | --- | --- |
| "Account" (hub: whose account) | PC mode and admin | The target of the five sections below |
| "Codex accounts" and "Claude accounts" (collapsed) | Same | Table (name, status), login (subscription: **Open approval window** → paste the code), API key, compatible endpoint, log out, delete, **Add account**, default account, per-conversation account |
| "Antigravity accounts (for new sessions)" and "Grok accounts (for new sessions)" (collapsed) | Same | API key accounts and the default |
| "Usage · limits" (collapsed) | Same | Questions today, tokens this month, daily and monthly limits |
| "OpenAI voice" | Same | Voice mode, save or delete the key (a wrong key isn't saved), voice, daily max, hang up after silence, max per call, collapsed "Members and models" |
| "My password" | Admin and members | Current / new / confirm new → **Change**. "The two new password fields don't match", "The new password must be at least 10 characters", "The current password is incorrect". On success: "Password changed — logins elsewhere have been ended" |

#### My settings › Messenger

| Section | Who | Items and description |
| --- | --- | --- |
| "Bots" | PC mode and admin | Table (messenger, bot ID, name, role, call name, status), **Add bot**, edit (name, role, call name, extra allowed users, reply language, visible existing sessions, on, token) |
| "Access requests" | PC mode and admin | Recent messages from people outside the allowlist → **Allow** |
| "Messenger connection" | Members | "Shared bot", **Get linking number**, table (messenger, name, linked at, **Disconnect**) |

#### My settings › Apps and devices

| Section | Who | Items and description |
| --- | --- | --- |
| "Hub connection" | PC screen | [Hub connection (PC screen)](#hub-connection-pc-screen). Not on the hub screen |
| "App" | Everyone | "Get the app", "Connect Ieon App" → **Create pairing code** (server address, 8 digits), table (app devices, **Disconnect**), "Phone notifications" (admin: notification key file) |
| "Devices" | Hub (admin and members) | **PC connection link** (collapsed) → **Create link** and **Copy**, **Connection requests** (collapsed) → **Approve** / **Reject**, table (name, source, registered, last connected, status, **Revoke**), **Recent activity** |

#### Admin › Register conversations

| Section | Items and description |
| --- | --- |
| "Register sessions manually" | Collapsed "Register manually (＋ Connect conversation on the conversation screen is easier)": ID (c_…), name, engine (Codex conversation / Claude channel / Antigravity conversation / Grok session), PC, session ID, where visible → **Save**, **Delete**, **Enter new** |
| "New session" | Collapsed "New session settings — On/Off": turn on, session count and per-engine limits, sleep and archive, default permission, "Allow choosing full (commands, internet) when creating", confirm on delete → **Save** / **Use file value** |
| | Collapsed "Concurrent questions · wait time": concurrent questions per device, approval card (minutes), login duration (days) |
| | "Server language" |

#### Admin › Messenger advanced

| Section | Items and description |
| --- | --- |
| "Messenger advanced" | Allowed users common to all messengers (Telegram, Discord, Slack, KakaoTalk IDs), collapsed "KakaoTalk (skill URL · relay)" |
| "Roles" | Table (role ID, name, engines it can create, allowed permissions, default session), collapsed "Create · edit roles": role ID (lowercase letters, digits, -), name, description, engines, permissions, AI role instructions, default session → **Save role**, **Delete role**, **New role**. If the ID format is wrong: "Role ID must be 2–32 lowercase letters, numbers, or -". With no engine or permission: "Choose at least one engine" or "Choose at least one permission" |

#### Admin › Hub security

| Section | Items and description |
| --- | --- |
| "Security (hub access restriction)" | "Your current address", method (IP allowlist, Cloudflare Access, Tailscale), allowed IPs and **Add my address**, Cloudflare team domain and AUD → **Save** / **Use file value** |
| "Install on a new server" | **Create install command** and **Copy** (1 hour) |
| "Multiple users" | **Multi-user (accept sign-up requests)** (confirmation window), member daily question limit, table (email, status, PC, questions today, limit, requested at) — approve / reject / **Disconnect** (confirmation window) / **Turn back on** / **Temporary password** / **Delete** |
| "Codex login (this hub)" | Login status, **Log in** / **Log in again**, "Turn on real runs for hub new sessions" |

#### Admin › External programs

| Item | Description |
| --- | --- |
| Key table | Program name (app ID), **Save visible sessions**, **Revoke** (" · Revoked") |
| "Program name (e.g. My automation)" → **Issue key** | An empty name gives "Enter a program name of 1–40 characters" |
| "New API key (shown only once)" | The key, **Copy**, **Close**. It closes when you revoke |

---

## Part 3 Troubleshooting

### Status text table

| Status text | Meaning | What to do |
| --- | --- | --- |
| Ready to send | Ready | Ask |
| Before first question | A newly created session | It starts when you send the first question |
| Processing | The question is at the PC or running | Wait until it finishes; to stop, press **Stop** |
| Needs review | Locked by a question whose result is unknown | Resolve it with the "Question needing review" card |
| Asleep · wakes when you ask | A resting new session | Just ask |
| PC disconnected | Ieon or the connector on that PC is off | Check that the PC is on and, in hub mode, that the PC screen's **Settings → Apps and devices → Hub connection** says "Connected" |
| Connected to hub · can't send from here | You're on the PC screen but that PC is connected to a hub | Send from the hub screen |
| Claude session off / Shared server off | The engine is off | [Reference Manual](MANUAL_REFERENCE.md) Chapter 3 |

### Card table

| Card | When | Buttons |
| --- | --- | --- |
| "OK to run a command?", "OK to edit files?", "OK to use more permissions?" | Work mode approval request | **Allow** (this time only), **Deny** |
| "Human task: …" | Matched a hand-over rule | **Done by me**, **Won't do** |
| "This PC is connected to a hub" | Screen of a PC connected to a hub | **Open hub screen** |
| "PC disconnected" | The PC is off | **Check again** |
| "Question needing review" | Result unknown | **It ran**, **It didn't run** |
| "This conversation's API account hit its limit" | Account limit | **View or change limits** |
| "AI replies are off" | Real runs are off | **Turn on AI replies** |
| "This session is archived" | An archived new session | **Restore** |
| "The hub needs a Codex login" | A hub new session before the hub's Codex login | **Go to login** |
| "This session replies with text only" | A new session on the hub itself | — |
| "Unsent question" | Blocked while sending (busy, limit, open in the app) | **Resend** (only when you press it) |

### Common messages

| Message | Cause | What to do |
| --- | --- | --- |
| "Not sent because this conversation is open in the Codex app…" | The app is holding an Alternate-mode conversation | Close only that conversation in the app and send again |
| "That PC didn't respond. Try again in a moment" / "That PC isn't connected…" | The PC chosen on the hub is off | Turn the PC on and check that Ieon is running |
| "Bot not connected — Invalid token…" | The messenger rejected the token | Issue a new bot token and enter it |
| "This screen can't create a Kakao skill URL (LINE webhook address)…" | PC mode has no public address | Connect from the hub |
| "On the hub screen, change it in Settings → PC settings → Real runs · Codex allowlist ("Turn on real runs")" | You pressed the AI replies switch on the hub screen | Change it where it says |
| "This browser doesn't support voice input…" | No built-in browser voice | Chrome, Edge, or Safari, or an OpenAI voice key |
| "access denied" | Outside the hub access restriction | The admin allows the address in Hub security |
| "Too many failed attempts; temporarily locked…" | 5 wrong passwords | Try again after 15 minutes |

### Known limitations

- In this test, bot owner registration with real messenger accounts (Telegram, Discord, Slack, Kakao, LINE) was not done (no real test bot accounts). Rejection of fake tokens and the notice text were verified.
- The hub doesn't know whether a PC has a Codex shared server, so even a conversation on a PC without one can be switched to "Shared". The PC refuses when you send (normally use Fast replies).
- The count in a member's new session limit line is counted on the hub (it may differ from the count on the member's PC).
- If you open two Ieon screens (different ports) on the same computer with `localhost`, their logins overwrite each other (browser cookies don't distinguish ports). Open each at a different address (127.0.0.1 and localhost).

---

## Index

| What you want to do | Where |
| --- | --- |
| Install | Chapter 1, [Beginner's Guide](BEGINNER_GUIDE.md) |
| Start on a PC for the first time | Chapter 2, [First-time setup](#first-time-setup-4-steps) |
| Create the hub admin and log in | Chapter 3 |
| Decide where the hub can be reached from | Chapter 3, [Hub security](#admin--hub-security) |
| Connect a PC to the hub | Chapter 4 |
| Continue a Codex conversation you were using | Chapter 5, [Connect conversation window](#connect-conversation-window) |
| Create or delete a new session | Chapter 6, [New session window](#new-session-window), [Connection settings](#connection-settings) |
| Ask a question or stop it | Chapter 7 |
| Turn AI replies on or off | Chapter 7, [Conversation header](#conversation-header), [This PC / PC settings](#my-settings--this-pc--pc-settings) |
| Allow file edits (work mode) | Chapter 8 |
| See question progress and results in one place | Chapter 9 |
| AI staff names, roles, rooms | Chapter 10 |
| Work folders and schedules | Chapter 11 |
| Connect a messenger bot | Chapter 12 |
| Members: connect a messenger | Chapter 12 Members, [Messenger tab](#my-settings--messenger) |
| Voice | Chapter 13 |
| Phone app | Chapter 14, [App Guide](APP_GUIDE.md) |
| Open to multiple users, approve, disconnect | 15-1 |
| Sign up | 15-2 |
| Change your password | 15-2, [Account tab](#my-settings--account) |
| Other engine accounts and limits | Chapter 16 |
| Issue an API key | Chapter 17, [External programs](#admin--external-programs) |
| When something doesn't work | [Part 3](#part-3-troubleshooting) |

---

## Test evidence and what is not yet verified

On 2026-11-23, an AI worker built a test environment and checked these directly.

- Environment: a test hub (admin and member test accounts), a new test hub with no admin (for the first screen), a Linux test PC (installed → connected with a PC connection link — the real user order), and the Windows PC screen.
- Verified: login, sign-up, waiting for approval, lockout, language; create admin; connecting with a PC connection link (usage mode set automatically); member conversation connection, new sessions (create, name error, duplicate name, delete), connection settings (staff name, icon, role, connection method), rooms (create, errors, delete), Tasks drawer; messenger wizard (list, Telegram token box, fake token rejection, Kakao and LINE notices); every Settings tab (member and admin); My password; multiple users (disconnect, turn back on); roles; external program keys (issue, API call, revoke); phone width (list, conversation, windows, drawer, every Settings tab). One real member question (Received → Running → Completed, answer "OK") was verified in an earlier test.
- AI-call tests (2026-11-23, 7 calls approved by the user — the test PC's Codex): first question of a new session (received → completed; the role instruction is sent once, with the first question), **Stop** ("Running…" → "Stopping…" → "Stopped"), work mode on → "May I edit files?" card → **Allow** ("✓ Allowed (this once)", "Approval request 1 · file edit: completed", the file was really created) / **Deny** ("✓ Denied", "Denied — not run", no file), and in a room: the lead answers, @calling, and **Hand off to another AI staff member** ("→ handed off to the reviewer").
- Fixed during testing: PRs #371–#374 and later fixes (the state chip showed "Ready to send" while a question was running; room text) (screen text, button reasons, member PC settings, Telegram token rejection, the screen of a PC connected to a hub, and so on).

Not yet verified (reason):

| Item | Reason |
| --- | --- |
| Registering an owner by sending the number to a real messenger bot | Needs a real messenger bot account |
| OpenAI voice (speak once and live) | Needs a key and a microphone (wrong key rejection was verified) |
| Phone app | Needs a real device (app 0.1.10 voice was confirmed by the user on 2026-11-23) |
| Real Grok answers | No subscription (excluded by the user's decision) |
