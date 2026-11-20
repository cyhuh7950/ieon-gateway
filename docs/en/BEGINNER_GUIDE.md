<!-- source: docs/BEGINNER_GUIDE.md @ ee3e10c -->
# Ieon Step-by-Step Guide for First-Time Users

As of: 2026-11-19 (includes new screens U1–U8, a first-time-user review, Antigravity, work mode, and app distribution). **You install only once, and after picking just one conversation the first time, you can start using it right away. Everything else is set in Settings (gear icon) on the screen.** You never need to create internal tokens or copy them into files.

The main part of this manual (sections 1–7) is **the path to your first answer with just your own PC**. Hubs, multiple bots, and connecting your own programs are in **Advanced use** (sections 8–10) at the end.

| Step | Section |
| --- | --- |
| Check what you need (accounts, programs) and install | [Section 1](#1-what-you-need-and-installation-one-time-only) |
| Open the screen | [Section 2](#2-open-the-screen) |
| Connect a conversation to continue (Codex / Claude Code) | [Section 3](#3-connect-a-conversation-to-continue) |
| Turn on AI replies and send your first question | [Sections 4–5](#4-turn-ai-replies-on-and-off) |
| Get your first answer in a messenger | [Section 6](#6-get-your-first-answer-in-a-messenger-telegram-discord-slack) |
| KakaoTalk and LINE | [Section 7](#7-kakaotalk-and-line) |
| Advanced: hub, moving bots, your own programs | [Sections 8–10](#8-advanced-using-hub-mode) |
| Turn off, update, back up, delete | [Section 11](#11-turn-off-turn-on-again-update-back-up-delete) |
| When something goes wrong | [Section 12](#12-troubleshooting) |

## 0. Before you start

### What Ieon is

Ieon is a tool that lets you send questions and get answers from the web screen, messengers (Telegram, Discord, Slack, LINE, KakaoTalk), and your own programs to the **Codex conversations**, **Claude Code sessions**, and **Antigravity conversations** you already use. It does not switch you to a new conversation; you **continue the same conversation**.

### Two ways to use it

| | **PC mode (ieon)** — main part of this manual | **Hub mode (ieun)** — Section 8 |
| --- | --- | --- |
| What stays on | Just your PC | Public server (hub) + your PC |
| Web screen | `http://127.0.0.1:28760` on your PC | Hub address (e.g. `https://ieun-gateway.sinsan.kr`) |
| When the PC is off | The bot does not answer | New sessions on the hub still answer; only PC sessions show "PC disconnected" |

### Rules to follow

- **AI replies** (AI calls) are **on** after installation (Section 4). To stop the AI from being called, turn them off with the switch at the top of the conversation. To install with them off from the start, use `pwsh scripts/install.ps1 -AiOff`.
- Do not connect important work conversations. **Try it with a test conversation first.**
- Do not paste passwords, bot tokens, or API keys into chats or documents.
- Ieon **does not automatically resend** a question whose result can't be confirmed (Section 5). This prevents the same work from running twice.
- **Do not turn on the same messenger bot in two places (PC and hub) at the same time** (Section 9).

## 1. What you need and installation (one time only)

### 1-1. Decide what you will use first

What you need to prepare depends on what you want to use. Prepare only the sections in the row that applies to you.

| What you want to use | Sections to prepare | Public server |
| --- | --- | --- |
| Only the web screen on this PC | 1-2, 1-3 | Not needed |
| + Telegram, Discord, Slack | 1-2, 1-3, that messenger in 1-4 | Not needed |
| + KakaoTalk, LINE | The above + KakaoTalk and LINE in 1-4 + 1-5 | **Needed** (relay or hub) |
| From outside and on your phone (hub mode) | The above + 1-5 | **Needed** (hub) |
| From your own programs (API) | 1-2, 1-3 | Not needed |
| On a server without a PC (Linux server install) | 8-1 | Linux server (https if you use KakaoTalk or the app) |

LINE currently works **only in hub mode** and **only in 1:1 chats** (7-2).

### 1-2. What everyone needs (before installing)

| What you need | Why | How to check | If you don't have it |
| --- | --- | --- | --- |
| **Windows 11** | The Ieon PC edition is built for Windows | — | — |
| **PowerShell 7** (`pwsh`) | Runs the install command | Open "PowerShell" from the Start menu and run `pwsh --version` → if you see `PowerShell 7.…`, you're set | Follow Microsoft's official guide [Installing PowerShell on Windows](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows) (e.g. `winget install --id Microsoft.PowerShell --source winget`). It is a different program from "Windows PowerShell 5.1", which comes with Windows |
| **Node.js 24** | The Ieon server runs on it | `node --version` → if you see `v24.…`, you're set | Download version 24 from [nodejs.org](https://nodejs.org) and install it (keep the installer defaults). After installing, open a new PowerShell window so `node` is found. The Ieon installer checks the version and stops with a message if it's different |
| **Internet** | Components are downloaded on first install and updates, and the AI and messengers communicate over the internet | — | — |
| Microsoft Edge (optional) | Opens the desktop shortcut in its own window (app window) | Included with Windows 11 | Without it, it opens in a tab of your default browser |

### 1-3. Prepare an AI (at least one of two, before installing)

Ieon has no AI of its own. It is a tool that puts questions into **the Codex and Claude Code conversations you already use**, so you first need the **account, subscription, and program** to use that AI. AI usage counts against **your own account's usage**.

**Codex**

| What you need | Description |
| --- | --- |
| Account | **An account on a ChatGPT plan that includes Codex**. Check OpenAI's official information for which plans include it |
| Program | **Codex app** (install it from the Codex page on OpenAI's official site). The Codex runtime that Ieon uses is installed together with Ieon, and it uses the same login information as the Codex app (`%USERPROFILE%\.codex`) |
| Login | **Log in yourself** in the Codex app. Ieon does not log in for you |
| Conversation to continue | **Create at least one conversation in advance** in the Codex app (for testing, a single "hello" is enough). Ieon is a tool for continuing existing conversations |

**Claude Code**

| What you need | Description |
| --- | --- |
| Account | A **Claude Pro or Max subscription account** is the default. Instead of a subscription, you can also put an **API key** (pay per use) or a **compatible endpoint** in **Settings → Account → Claude accounts** (Section 4-1) |
| Program | **Claude Code** (follow the install instructions in Anthropic's official Claude Code docs). After installing, `claude --version` in PowerShell should print a version. The Ieon channel uses Claude Code's research preview feature (development channels), so you need a recent version that has it (confirmed on 2.1.314) |
| Login | When you first open the channel window in 3-B, **log in yourself** in that window with `/login` |

### 1-4. Prepare messengers (only those you use, before or after installing)

Each messenger needs **an account on that messenger** and **a bot** (an account that speaks for Ieon). Detailed steps for creating bots are in Section 4 of [MESSENGER_MANUAL](MESSENGER_MANUAL.md). Paste the bot token into the Ieon screen once in Section 6, and don't write it down anywhere else.

| Messenger | Account and permissions needed | Do in advance | Values you get |
| --- | --- | --- | --- |
| **Telegram** | A Telegram account (phone app) | In Telegram, `@BotFather` → `/newbot` → enter the bot name twice. To use it in groups, `/setprivacy` → Disable | 1 bot token |
| **Discord** | A Discord account + **your own server to add the bot to** (you need permission to invite bots) | In the [Developer Portal](https://discord.com/developers/applications), New Application → Bot → **turn on Message Content Intent** → invite it to your server with the OAuth2 URL | 1 bot token |
| **Slack** | A Slack account + **a workspace where you can install apps** (company workspaces may need admin approval) | At [api.slack.com/apps](https://api.slack.com/apps), create an app (settings in MESSENGER_MANUAL 4.3), turn on Socket Mode, install it to the workspace, and invite the app to the channels you'll use | 2 tokens (`xapp-…`, `xoxb-…`) |
| **LINE** | A LINE account + **a LINE Official Account** (LINE Official Account Manager) + turn on **Use Messaging API** (this creates a channel in LINE Developers) | Steps 1–3 in 7-2 | 2 values: channel access token (long-lived) and channel secret — but **a public server is needed** (1-5, currently hub mode only). Answers are also sent via LINE "push" and count toward **the monthly free message quota of the official account plan** (beyond it, depending on the plan, sending is blocked or charged — check the official information) |
| **KakaoTalk** | A Kakao account + **a KakaoTalk Channel** ([Channel Admin Center](https://center-pf.kakao.com)) + use of **Kakao i Open Builder** ([chatbot.kakao.com](https://chatbot.kakao.com)) | Create a channel → create a bot in Open Builder and link the channel → **apply for and get approval for AI chatbot callback** (Kakao reviews it, so it may take time; answers won't arrive before approval). A real public service may require business channel verification | No token (paste the skill URL from the Ieon screen into Open Builder, Section 7) — but **a public server is needed** (1-5) |

### 1-5. Prepare a public server (only for KakaoTalk or hub mode)

KakaoTalk and hub mode need a **public server and HTTPS address** reachable from the internet. Running a server yourself is real work, so first-time users are advised to get **an address prepared by an operator (admin)**.

| What you need | Description |
| --- | --- |
| Public server | An always-on Linux server (using Docker). Server fees apply |
| Domain and HTTPS | E.g. `https://ieun-gateway.sinsan.kr`. Set up the domain and certificate (HTTPS) in front of the server (e.g. Nginx Proxy Manager) |
| Deployment | If you only use Kakao, put the **relay** (`deploy/relay`) on the server; to use it from outside and on your phone, put the **hub** (`deploy/hub`). Hub installation is in Section 8-1 (one install command) |
| To use new Codex sessions on the hub | Permission to briefly turn on "Enable device code login for Codex …" in ChatGPT web **Settings → Security** (Section 8) |
| Phone | A phone browser to open the hub address (Android Chrome, iPhone Safari) |

### 1-6. Get Ieon

1. Download the Ieon files. If an admin gave you a **zip file**, use that; if you have access to the repository, download **Code → Download ZIP** from the repository (`cyhuh7950/ieon-gateway`).
2. Extract it to **a folder you won't delete**. E.g. `C:\ieon-gateway`. Ieon's settings and records (the `.local` folder) are created inside this folder, so deleting this folder later also deletes your Ieon records (Section 11).

### 1-7. Install

Open PowerShell 7 in that folder (type `pwsh` in the folder's address bar and press Enter). Then run **the one line below**.

```powershell
pwsh scripts/install.ps1
```

The installer does the following.

1. Installs components (internet needed)
2. Creates settings and internal tokens (values are not shown)
3. Registers Ieon to start automatically without a window when you sign in
4. Starts it now
5. Opens the web screen
6. Creates an **Ieon** shortcut on the desktop (opens in an Edge app window if Edge is installed, otherwise in a browser tab)

When it finishes, you'll see a message saying that after picking just one conversation the first time you can start right away, and that everything else is done in "Settings" (gear icon) on the screen.

> After installation, Ieon starts **with AI replies on**. To start with them off, install with `pwsh scripts/install.ps1 -AiOff` (when off, the AI is not called).

### 1-8. After installing

**The first time**

| What to do | Where |
| --- | --- |
| Pick one conversation to continue | Initial setup, 3 steps (Section 3) |
| Turn on AI replies with your first question | "Turn on and send" (Section 4) |
| (Claude) Open the channel window, log in, register the session | 3-B |
| (Messenger) Enter the bot token and register as owner with a 6-digit number | Section 6 |
| (Kakao) Paste the skill URL → turn on callback in the fallback block → bot test → deploy | 7-1 |
| (LINE) Official account and Messaging API → two token fields → Webhook URL and Use webhook → turn off auto-reply → add as friend and send the number | 7-2 |
| (Optional) Back up the `.local` folder | Section 11 |

**Every time you turn the PC back on**

- The Ieon server and messenger bots start **automatically when you sign in**. Nothing to do.
- **The Claude channel window does not start automatically.** To receive questions with Claude Code, reopen the channel window with `pwsh scripts/ieon.ps1 claude` (3-B). Nothing to do for Codex.
- The AI replies switch stays in the state it was in before (Section 4).

**Occasionally**

- When a new version comes out, update (Section 11); after changing important settings, back up `.local` (Section 11).
- If your Codex or Claude login expires, log in again in that app (Codex in the Codex app, Claude with `/login` in the channel window).

## 2. Open the screen

When you sign in to Windows, Ieon starts automatically without a window. Open **Ieon** on the desktop. Screens opened on this PC are **logged in automatically**.

- **Left:** List of connected conversations (engine, a one-line status, number of items to handle). At the top is **＋ Connect conversation**; at the bottom left are **Messengers** and **Settings** (⚙).
- **Center:** The selected conversation. At the top are the conversation name and status, the **AI replies** switch, and **Connection settings**. If there's a problem, a card with the reason and buttons appears in the conversation.
- In **Settings** (⚙), choose **My settings | Admin** at the top. **Admin** is visible only to the hub owner (admin), not to members. Click **← Conversations** at the top to go back.
  - **My settings:** This PC (on the hub screen, PC settings — usage mode, real runs, allowlist) · Work (work folder, scheduled tasks) · Account (Codex, Claude, Antigravity accounts, usage and limits, my password) · Messengers (bots, access requests; for members, messenger connection) · Apps and devices (hub connection, devices, app)
  - **Admin:** Register conversations (register sessions manually, new session, concurrent questions, wait time) · Messenger advanced (common allowed users, Kakao, roles) · Hub security (hub only — access restriction, install on a new server, multiple users, Codex login) · External programs (API keys)
  - Hover over the **ⓘ** next to a title (tap it on a phone) to see a detailed explanation of each field in a tooltip. Rarely used fields are collapsed; click to expand them.
  - Every developed feature is shown. Fields you can't use right now (e.g. Hub security on the PC mode screen, or an engine not installed on that computer) are not hidden; click them to see why they're unavailable.

### 2-1. Choose a usage mode (first time only)

The first screen asks "How will you use it?". Choose only one of the two and don't mix them (Ieon doesn't turn on features that don't match).

| Choice | When | What turns on for this PC | What turns off |
| --- | --- | --- | --- |
| **This PC only** (default) | Using one PC without a public server | Questions on this PC's screen, Telegram, Discord, Slack bots, and (if you entered a public relay address) KakaoTalk and LINE | Hub connection (refused) |
| **Connect to my hub** | When you have a hub (public server) | Hub connection — questions, messengers, and this PC's settings are on the **hub screen** | This PC's messenger bots and Kakao relay (off within 1 minute), sending questions from this PC's screen |

- If you click **Do it later** without choosing, it becomes "This PC only".
- "This PC only" works without errors even without a public relay. Only KakaoTalk and LINE appear as "Not used" (grayed out).
- To change it: **Settings → This PC → Usage mode** (on the hub screen, choose the PC in **Settings → PC settings**, then the same field — if you switch to "This PC only" from the hub, the hub connection is cut, so to switch back you do it on that PC's screen). Before changing, it shows what turns off and on and asks you to confirm. It won't change while a question is processing or needs review. Conversation history, the allowlist, bot settings, and hub pairing information are not deleted.
- PCs that were already in use show "Choose a usage mode" at the top left. If the PC is connected to a hub, "Connect to my hub" is recommended.
- The "Ieon public service" (sign up and use it without a public server) is coming soon.

## 3. Connect a conversation to continue

Follow one of the options below depending on the AI you use.

### 3-A. If you use Codex

**When you first open it**, there are no connected conversations yet, so **the 3-step initial setup** appears automatically.

1. **Check readiness:** Shows whether Codex is logged in on this PC. If not, log in in the Codex app and continue.
2. **Pick a conversation:** Click one in the list of Codex conversations recently used on this PC (takes about 10 seconds). Choose a **test conversation**.
3. **Ready:** Messengers and the hub can wait. Click **Open conversation**.

To see it again after closing, add `/#setup` to the end of the address.

- **To connect more conversations:** **＋ Connect conversation** at the top left → choose from the list. Adding to the allowlist and registering the session happen in one step, and the conversation opens right away. Work conversations don't appear in the list.
- **If it's not in the list:** **＋ Connect conversation → Advanced: enter conversation ID**. To find the conversation ID, enter `%USERPROFILE%\.codex\sessions` in the File Explorer address bar, then look at the end of the `rollout-….jsonl` file name inside a date folder. E.g. `rollout-2026-10-29T21-09-09-01a18790-63c7-73e3-a60b-6ddb60fd5be8.jsonl` → `01a18790-63c7-73e3-a60b-6ddb60fd5be8`
- **Don't keep that conversation open in the Codex app when sending.** If it's open, the question is refused as "in use". Usually closing just that conversation is enough. If it still says "in use" after you opened it once, quit the Codex app completely.

### 3-B. If you use Claude Code

Claude Code receives questions **only while a Claude Code window with the Ieon channel turned on is open**.

The channel preparation (connection settings and the internal key in `.local\c1` of the Ieon folder) is **done by the installer (`install.ps1`)**. There's nothing else to do. On a PC installed earlier, running the install command in 1-7 once more adds only what's missing (existing settings are not changed).

1. In PowerShell 7 in the Ieon folder, run `pwsh scripts/ieon.ps1 claude`. Claude Code starts in a new window together with the Ieon channel.
   - The first time, log in yourself in that window with `/login` using your **subscription account (Pro or Max)**. Instead of a subscription, you can also put an API key (pay per use) or a compatible endpoint in **Settings → Account → Claude accounts** (Section 4-1).
   - When you first open it, if Claude Code asks whether to use the MCP server `ieon` in this folder, or shows a notice that it's loading a development channel, choose **Allow (continue)**. That is the Ieon channel.
   - Check that the bottom of the window says `manual mode` (if it says `auto mode`, turn it off with `shift+tab`).
   - Don't type questions directly into this window (even if you do, the answer won't go to Ieon). To finish, use `/exit`.
2. On the Ieon screen, in **Settings → Admin → Register conversations**, expand **Register manually**, enter the following, and click **Save** (first time only).
   - ID: a name starting with `c_` (e.g. `c_claude`)
   - Name: the name shown in the list (e.g. "Claude test")
   - Engine: **Claude channel**, PC: this PC
   - Session ID: `ieon`
   - Visible in: Web (to use it in messengers too, also "Messenger default bot")
3. Select that conversation in the list on the left. If the status is "Claude session off", the window from step 1 is closed.

### 3-C. If you use Antigravity (Gemini) or Grok

**Think of two things separately.** ① **Session**: Ieon continues that PC's Antigravity conversation or Grok session using the same ID. ② **Usage (tokens)**: which account the question goes out on — connected existing conversations go out on **each app's login account on that PC** (PC default login). **New sessions** for Antigravity can use **Settings → Account → Antigravity accounts** (for new sessions: a Gemini API key or compatible endpoint). Logging in with a subscription per account is not supported.

**What you need**
- **Antigravity**: If you install the Antigravity app and log in, the CLI (`agy`) is included at `%USERPROFILE%\.gemini\bin\agy.exe`. Free accounts have a weekly usage limit and get blocked with heavy use (paid Google AI Pro has a higher limit). When running it, Ieon removes API key variables such as `GEMINI_API_KEY` so usage doesn't leak into pay-per-use billing.
- **Grok**: You need the **Grok Build CLI (`grok`)** — a different program from the desktop app "Grok Bot". After the official install (PowerShell `irm https://x.ai/cli/install.ps1 | iex`), run `grok login`. **It can't be used with a free account; a SuperGrok ($30/month) or X Premium+ subscription is required.** Ieon's Grok connection was built according to the official docs, and it will be verified for real once a subscribed account is available.
- **Session ID to continue**:
  - Antigravity: the ID of a conversation you used in the CLI (e.g. `9e943423-83d6-…`). When you close the CLI, the "to continue …" command shows the ID, and you can also see it as the file name `%USERPROFILE%\.gemini\antigravity-cli\conversations\<ID>.db`. **Conversations used in the Antigravity app are stored elsewhere, and it has not yet been confirmed whether they can be continued with the CLI.**
  - Grok: the session ID from `grok sessions list`.

**Connecting** (in PC mode on this PC's screen; in hub mode on the hub screen after choosing the PC)
1. In **Settings → This PC (or PC settings) → Antigravity · Grok allowlist** (click to expand if collapsed), enter the engine and session ID (and work folder), then click **Add to allowlist**.
2. In **Settings → Admin → Register conversations → Register manually**, register it with the engine set to "Antigravity conversation" or "Grok session" and the same session ID; it then appears in the conversation list.

**When using it**
- Normal questions are sent **read-only** (Antigravity uses plan mode + sandbox — confirmed not to create files). If you turn on **work mode** in an Antigravity conversation, file edits and command runs are asked via approval cards (Section 5-2).
- Because it's read-only, if Antigravity tries to run a command and gets blocked, instead of an answer you get **"[Ieon] No answer because an action needing approval was blocked (read-only)."** This happens especially in an empty new-session folder. Add "don't use tools" to your question, or turn on work mode if you need files or commands.
- **If that session is in use elsewhere, the question isn't sent.** Antigravity itself doesn't prevent running twice at once, so Ieon checks the conversation lock and blocks it ("Not sent because it's in use elsewhere" — send again after it finishes). For Grok, a way to detect "in use" has not been confirmed yet, so **don't keep that session open elsewhere when sending.**
- If the session can't be loaded, the question **isn't replaced with a new session** and isn't sent. If an answer comes from a different session, it stops as "needs review" (no automatic resend).

**Human tasks (handing off to a person)**
- Choose under **"Human tasks"** below the work mode field: **Run any command**, **Edit any file**, **Request more permissions**, or **Commands containing these words** (separate several with commas, e.g. `git push, deploy, rm -rf`). Click **Save**. Saving with everything cleared removes the rules.
- When the AI tries to do something that matches, Ieon answers **"Don't do it"** without asking (it doesn't run). Instead, a **"Human task n: Run command — … (work folder)"** card appears at the top of the conversation.
- If needed, a person handles it and then clicks **Done by me**; if it won't be done, click **Won't do**. It's recorded only once and stays with the original question (in Details on the Tasks screen). The card stays until you click (even after the question finishes).
- Messenger: "Human task n: …" arrives in that chat, and you record it with **`/done n`** (Done by me) · **`/drop n`** (Won't do) (owner only). It also appears in the approval queue on the Tasks screen.
- The rules can only be changed on the web screen (not from messengers or external programs). It works only in Codex conversations with work mode turned on.

**How to check it works (for your own verification)**
1. Create a short conversation with the Antigravity CLI (`agy`) and note the ID shown when you close it.
2. Do steps 1 and 2 of "Connecting" above → an "Antigravity" conversation appears in the conversation list (account used in Connection settings: "PC default login — that PC's Antigravity login").
3. Send a question → an answer arrives, and if you reopen that conversation in the Antigravity CLI (`agy --conversation <ID>`), you can see the question and answer sent from Ieon.

## 4. Turn AI replies on and off

When you send your first question, an "AI will answer this question" confirmation appears. Click **Turn on and send** to turn on AI replies and send the question (if you cancel, nothing is sent). To stop the AI from being called, turn off the **AI replies** switch at the top of the conversation.

| Question | Answer |
| --- | --- |
| Does it apply only to the selected conversation? | **No. It applies to all conversations on this PC (both Codex and Claude).** It's a single value saved in this PC's settings file |
| Does it stay after restarting Ieon or the PC? | **Yes.** If you leave it on, it stays on after a restart |
| Does turning it off stop questions already in progress? | Changing the switch **restarts** this PC's connector with the new setting. Questions being processed at that moment may end up with a result that can't be confirmed (a "Question needing review" card, Section 5). So **turn it off when nothing is processing.** Questions that hadn't started yet are not run, with "Real runs are off" |
| Where do I change it? | **On any logged-in Ieon screen** (this PC, phone, Tailscale). Questions from messengers and your own programs are also answered only while this switch is on. It's on after installation |

The same switch is also available as "Turn on real runs" in **Settings → This PC** (on the hub screen, choose the PC in **Settings → PC settings**).

## 4-1. Choose which account to send with (optional, Codex, Claude, Antigravity)

At first, questions go out on **the account logged in to Codex Desktop on that PC** (shown as "Account · PC default login" at the top of the conversation). If the Desktop account has hit its usage limit, or you want to use a different account (e.g. a work account) for Ieon, register an **Ieon-only account**. The conversation (session) continues as is regardless of the account.

**What you need**
- A **ChatGPT account** to use with Ieon (a subscription that includes Codex). It can be the same account as Desktop or a different one. **Use only your own account** (sharing an account with other people violates the terms).
- A browser where you can log in to that account (a phone works too).

**Steps** (in PC mode on a screen opened on this PC; in hub mode on the hub screen — on the hub, first choose the hub itself or a PC in "Account location" at the top. If you choose a PC on the hub, that PC must be on and running Ieon)
1. In **Settings → Account**, enter a label (e.g. "Work") and click **Add account**. Up to 5 accounts.
2. Click **Log in** on that account's row to see the official login address and a one-time code. Open the address, log in **with the account you want to use for Ieon**, enter the code, and approve (within 15 minutes). When the status changes to "Logged in", you're done. Ieon does not read the login information.
3. Choose the **Default account**. It's used for new sessions and for conversations without their own choice. To use a different account per conversation, choose that conversation's account in the table below.
4. Check that the top of the conversation changed to something like "Account · Ieon account Work". The hub screen shows the same name.

**Good to know**
- If the selected account isn't logged in, the question is **not sent** and you're told "Not sent because the selected Ieon account isn't logged in" (it isn't secretly sent with another account).
- Even if a limit is hit, Ieon **doesn't switch to another account on its own.** To switch, choose it here yourself.
- Conversations connected as "Shared (shared server)" use that server's login (you can't choose an account).
- **Note for alternate conversations:** Usually closing just that conversation in the Codex app is enough. If it still says "in use" (Desktop is using it) after you opened it once, **quit the Codex app completely** (quit it from the hidden icons in the taskbar). This is Desktop behavior and unrelated to accounts.
- Deleting: **Delete** on an account's row logs out and deletes the account folder. Conversations that used that account go back to the PC default login, and conversation history is not deleted.
- **Claude accounts (this PC):** Under **Claude accounts** on the same tab, enter a label and click **Add Claude account** → **Log in** → approve with your Claude account in **Open approval window** → when a code appears, paste it into the Ieon field (in a browser on the same PC it may finish on its own) → "Logged in · subscription". Or use an **API key** (sk-ant-…, pay per use). If you choose a **Default Claude account**, Claude new sessions and **newly opened** Claude channel windows (`pwsh scripts/ieon.ps1 claude`) go out on that account. If you don't choose one, the PC's Claude Code login is used as before. To use a different account per conversation, choose that conversation's account in the table right below (**Claude conversation / account to use**) (it appears starting from new sessions that have sent their first question). "Account · Ieon account …" at the top of the conversation and `/sessions` in messengers show which account is used.
- **Compatible endpoint (Claude):** To keep Claude Code as is but send the AI model requests elsewhere (e.g. Upstage Solar, a router, a company gateway, a local model on your PC), add a Claude account, click **Compatible endpoint**, and enter the **address, key, and model name** that service gave you (how the key is sent is usually "Authorization Bearer"). Choose that account as the default or per conversation and requests go to that model, with usage billed by that service.
  - Continuing an **existing Claude conversation** a person was using (channel window) with a different model only works with verified providers (currently Upstage). Other addresses are used only in Ieon **new sessions** (unverified combinations are reported as "not sent").
- **Compatible endpoint (Codex):** Enter the address, key, and model name under **Compatible endpoint** on a Codex account's row. Only OpenAI **Responses API** compatible endpoints work (endpoints that support only Chat Completions aren't accepted by Codex). If you choose that account as the **Default account**, Ieon **Codex new sessions** go to that model. Continuing an existing Codex conversation with a different model hasn't been verified yet and is blocked ("not sent").
- **Antigravity accounts:** If you enter a Gemini API key or compatible endpoint in **Antigravity accounts (for new sessions)** on the same tab (click to expand if collapsed), Ieon **Antigravity new sessions** go out on that account. Logging in with a subscription per account is not supported, and connected existing Antigravity conversations use that PC's Antigravity login (PC default login).
- **Grok accounts:** If you enter an xAI API key in **Grok accounts (for new sessions)** on the same tab, Ieon **Grok new sessions** go out with that key (the Grok CLI must be installed on that PC). If you don't choose one, that PC's Grok login is used.

## 5. Ask a question

Select a conversation in the list on the left, type a question in the input box at the bottom, and click **Send** (Enter) to get an answer. For a new line, press Shift+Enter. Progress shows in the order Received → Running → Completed.

- **"Question needing review" card:** A question whose result couldn't be confirmed. This card also appears when Ieon on the PC (the connector) shut down during processing and started again (since 2026-11-20 — previously it stayed as "Processing"). Check in the original app (Codex, Claude Code) whether it ran, and click **It ran** or **It didn't run**. That conversation is locked until you resolve it. **It is not resent automatically.**
  - The card also shows **whether the session it was sent to is the same as this conversation's current session** (Resume check). If it says "same", open that conversation in the original app to check; if it says "⚠ different", the conversation link has changed since then, so open the conversation used at that time to check. It also tells you if Ieon's stored history was deleted after that. The same "Resume check" is in **Details** on the Tasks screen, and in messengers it appears as one line in `/status`.
- **"Unsent question" card:** **Resend** appears only when it's certain the question wasn't sent, and it sends only when you click it.
- **Stopping a question (Stop):** While waiting for an answer, there's a **Stop** next to the progress indicator. Clicking it stops **only that question** (questions in other conversations continue).
  - If the PC hasn't picked it up yet, it becomes **"Stopped"** right away. If you stop it after the PC picked it up but before the AI started, it's unknown whether the question got into the original conversation, so it remains as a **"Question needing review"** (check and resolve it in the original app).
  - If it's already running, it shows **"Stopping…"** → once it's confirmed the AI actually stopped, **"Stopped"**. Even after you asked to stop, if the AI finished answering in the meantime, **the answer is shown as is** (whichever finishes first).
  - If stopping can't be confirmed, it remains as "needs review" (no automatic resend).
  - **Questions sent to a Claude Code window (channel)** can't be stopped here while running — stop them in that Claude window (they can be stopped if they haven't started yet).
  - In messengers, use **`/stop`** (on Slack, `!stop`): it stops the last question sent in that chat. Only the person who sent that question or the owner can stop it.
  - In the Ieon App, use **Stop** next to "Waiting for the answer…".

- **Tasks screen (☰ Tasks at the bottom left):** Collects the questions from all conversations, one by one. The number is the total of awaiting approval and in progress / needs review.
  - **Awaiting approval:** **Allow (this time only)** or **Deny** approvals waiting in several conversations, all in one place.
  - **In progress · needs review / Recent:** AI staff name, status (Waiting → Sending (PC picked it up) → Running (AI started) → Completed, plus Stopping, Failed, Stopped, Needs review), received time, and the start of the question. Click **Details** to see the full question, approval requests and run results, and the answer; **Stop** to stop only that question; and **To conversation** to open that conversation.
  - When you ask from a messenger, the received notice includes a **"View task: https://…/#task=…"** link (once you've opened the web screen at a public https address, as with a hub). Clicking it opens that task after you log in — the link alone shows nothing, and only the logged-in owner can see it.
  - In the Ieon App, it's **☰ Tasks** at the top of the list.

Once this works, **getting your first answer on the web is done**.

## 5-1. AI staff and rooms (assigning work to several AIs together)

Each connected conversation is an **AI staff member**. You can gather several AI staff in one **room** and assign work to them together (web screen, both PC mode and hub mode).

**Naming AI staff:** Select a conversation, and in **Connection settings → AI staff**, set a name (no spaces, e.g. Design), an icon (one emoji), and a role, then click **Save**. Without a name, it's called by the conversation name (with spaces removed). If you set a role (one created in Settings → Admin → Messenger advanced → Roles), role instructions are sent along **with the next question only**.

**Creating a room:** On the left, **Rooms ＋ Room** → room name, members (1–10 AI staff), **Lead**, shared guide (the purpose of this room — added before each question) → **Save**.

**Talking in a room**
- Only AI staff called with **@name** answer (e.g. `@Design @Code split the screen`). If you call several, each one answers.
- If nobody is called, the **Lead** answers.
- If a called AI staff member is working elsewhere (in a 1:1 or another room), the message is **not sent** and "Not sent because it's busy with something else" is left. It isn't sent automatically after waiting.
- Click **Hand off to other AI staff** below a finished answer to quote that answer and send it to the AI staff you choose. **AI staff never call each other on their own** (to avoid endless loops or large usage).
- Each AI staff member's original Codex or Claude conversation keeps only the questions sent to that member (with the room guide added at the front) and the answers. Room history is saved in Ieon per room.
- Below messages that couldn't be sent (busy elsewhere, open in the Codex app, PC disconnected, etc.) there's a **Resend to @name** button. It resends only when you click, and only once. Resolve questions with an unknown result (needs review) in that AI staff member's conversation.
- In **Room settings**, change members, the lead, and the guide, or delete the room. Deleting a room leaves the AI staff (conversations) and 1:1 history as they are.
- On the screen of a PC set to "Connect to my hub", rooms don't send either (do it on the hub screen).

## 5-2. Work mode — letting the AI edit files and run commands (Codex, Antigravity)

Normally, questions sent by Ieon are **read-only**, so the AI can't edit files or run commands. Only in conversations with **work mode** on, the AI **asks you for permission** every time it tries to do such things, and does only what you allow.

**What you need**
- It works in existing Codex and Antigravity conversations (ones you've connected). Not yet in Claude (on hold because read-only commands were confirmed to run without approval).
- That conversation's **work folder**: in Settings → This PC (on the hub screen, PC settings) → allowlist, set a work folder for that conversation. Codex asks with an approval card every time it writes a file, and if it's outside the work folder, the card shows **"outside work folder"**. If a person allows it, writing outside the folder also runs. Claude can't read or write outside the attached folder. Internet access is blocked.

**Turning it on**
1. Select the conversation and check **Connection settings → Work mode → Turn on work mode** → confirm in the confirmation dialog.
2. When a **Work mode** label appears at the top of the conversation, it's on. If a question is processing, you can turn it on or off after it finishes.

**Using it**
- Ask as usual (e.g. "Create hello.txt").
- When the AI tries to edit a file or run a command, a card appears at the top of the conversation: **"OK to edit files?"** or **"OK to run a command?"** — with the command line (or reason), the work folder, and the time left.
- **[Allow]** = run this time only, **[Deny]** = don't run (the AI finds another way or stops). There's no "always allow".
- **If you don't click within the set time (default 15 minutes), it's denied.** You can change the time to anywhere from 15 minutes to 24 hours in **Settings → Admin → Register conversations → Concurrent questions · wait time** (while waiting, that conversation is held). When one question finishes, its remaining requests are also denied.
- The result of your click stays in the card's place, like "✓ Allowed (this time only)", and who clicked and when is kept for 180 days.
- **What actually happened after you allowed it is also shown on the same card:** "Approved — running" → **"Run completed"** or **"Run failed (exit code n)"**. If the result couldn't be confirmed after you allowed it, it stays as **"Result unknown"**, and Ieon won't run it again for you (check in the original session). The card stays at the top of the conversation for 30 minutes after the decision.
- The card title is prefixed with **who (AI staff name)** made the request and the **approval request number**. This number is the same as in `/allow n` in messengers.

**In messengers**
- When you ask a work-mode conversation from a messenger and approval is needed, **"Approval request 1: Run command — …"** arrives in that chat.
- Answer with **`/allow 1`** or **`/deny 1`** (on Slack, `!allow 1`). Only the **owner (common allowed users)** can answer — people added separately to the bot can only ask questions.
- If you allow it, the actual result also arrives in that chat: one of **"Approval request 1: Run completed"**, **"Run failed (exit code n)"**, or **"Couldn't confirm the run result"**.
- Approval numbers continue from 1 per conversation and match the numbers on the web cards. Even after restarting the messenger bot or Ieon, you can answer with the same number.

**Good to know**
- **Alternate conversations:** Usually closing just that conversation in the Codex app is enough. If it still says "in use" after you opened it once, quit the Codex app completely (same as usual). Work mode launches Codex briefly only when asking a question, then closes it.
- **Shared conversations:** If a person is using it in the TUI, the question isn't sent.
- Codex sometimes bundles several tasks into one command when asking (e.g. "create a file + list files"). If you deny that command, none of the bundled tasks run.
- Conversations without a work folder aren't sent, with "Work mode only works for conversations with a work folder…".
- Turning it off: uncheck the same box. It goes back to read-only.

**How to check it works (for your own verification)**
1. Turn on work mode in a Codex conversation that has a work folder → "Work mode" at the top.
2. Send "Create hello.txt in the work folder and write 'hi' in it" → an "OK to edit files?" (or "OK to run a command?") card.
3. [Allow] → an answer arrives, and hello.txt appears in that folder. Send the same thing again and click [Deny], and no file is created.

## 6. Get your first answer in a messenger (Telegram, Discord, Slack)

For these three messengers, Ieon connects to the messenger server first, so **no public address is needed**.

1. Create a bot in the messenger and get a **bot token** (Telegram: BotFather `/newbot`; Discord and Slack: the developer pages — Section 4 of [MESSENGER_MANUAL](MESSENGER_MANUAL.md)).
2. Click **Messengers** at the bottom left of the screen → choose the messenger.
3. Paste the token into the field and click **Connect** (1 field for Telegram and Discord, 2 for Slack). A saved token isn't shown again.
4. When the bot connects, a **6-digit number** appears in large type. In the messenger, send **just the number** to that bot. When you see "You're registered as the owner", you're done.
   - The number can be used once within 10 minutes and locks after 5 wrong tries (**Get a new number**).
   - Instead of the number, you can send anything to the bot and then click **Allow** in the "Messenger access requests" band on the conversation screen or in **Settings → Messenger → Access requests**.
5. In the messenger, view the session list with `/sessions`, choose one like `/use 1`, and ask. AI replies from Section 4 must be on for answers to arrive.

## 7. KakaoTalk and LINE

### 7-1. KakaoTalk

KakaoTalk works by **Kakao sending messages to our public HTTPS address**, so unlike other messengers, **a public server is required**.

| How you use it | Where Kakao sends | What you need |
| --- | --- | --- |
| PC mode | The **Kakao relay** on a public server → your PC picks it up | Only if an operator deployed the relay on a public server and put its connection information on this PC. Otherwise, the skill URL doesn't appear on the screen |
| Hub mode (Section 8) | The hub receives it directly | A hub |

If you don't have a public server, skip KakaoTalk and use the messengers in Section 6.

**Kakao-side preparation (first time only, done by the Kakao account owner)**

1. Create a **KakaoTalk Channel** (KakaoTalk Channel Admin Center). To use it as a real public service, business channel verification may be required.
2. Create a bot in **Kakao i Open Builder** and link that channel.
3. In Open Builder, apply for the **AI chatbot callback** feature and get it approved. AI answers take a while, so Ieon replies only "received" within Kakao's 5-second response limit and sends the real answer through the callback. Answers won't arrive before approval.
4. At the bottom left of the Ieon screen, in **Messengers → KakaoTalk**, **Copy** the **Skill URL** (the same value is also in **Settings → Admin → Messenger advanced → Kakao skill URL**). This address contains a secret value, so don't post it anywhere else.
5. In Open Builder **Skills**, create a new skill, paste it into the URL field, and save.
6. In Open Builder **Scenarios → Fallback block** (the block that receives every message), change the response to **Skill data**, link the skill from step 5, turn on **Use callback**, and save. If you don't turn it on, the bot replies that "AI chatbot callback is not turned on".
7. In Open Builder **Bot test**, send the 6-digit number from the Ieon screen to register as the owner, then check with `/whoami`, `/sessions`, and a question, in that order.
8. Once confirmed, **Deploy** in Open Builder. It answers in real KakaoTalk Channel chats only after you deploy.

- A URL copied from the PC screen is the PC mode route, and a URL copied from the hub screen is the hub route. **Whichever was pasted into Open Builder last is the one that answers.**
- If the Kakao bot isn't in the list, add it with messenger "KakaoTalk" and bot ID `default` via Add bot in **Settings → Messenger**.
- You can tell which side (PC or hub) answered from the "Bot name" in `/whoami`.
- Menu names may differ slightly as Kakao redesigns its screens.

### 7-2. LINE

Like KakaoTalk, LINE works by **LINE sending messages to our public address**, so a public server is needed. It currently works **only in hub mode (Section 8)** (the PC mode public relay hasn't been redeployed to receive LINE yet). It accepts **only 1:1 chats**; in groups it only replies "Can only be used in 1:1 chats".

1. **Create a LINE Official Account:** With your LINE account, create an official account in [LINE Official Account Manager](https://manager.line.biz).
2. **Turn on Messaging API:** In the official account's management settings, turn on **Use Messaging API** (the first time, set a provider name). This creates a **Messaging API channel** for that account in the [LINE Developers](https://developers.line.biz) console.
3. **Get two values:** LINE Developers → that channel → **Channel secret** in **Basic settings**, and **Channel access token (long-lived)** on the **Messaging API** tab → Issue.
4. **Enter them in Ieon:** On the Ieon **hub screen**, at the bottom left, **Messengers → LINE** → paste into the two fields (Channel access token, Channel secret), then **Copy** the **Webhook URL** below them.
5. **Enter the address in LINE:** Paste it into **Webhook URL** on the LINE Developers **Messaging API** tab, click **Verify** → turn on **Use webhook**.
6. **Turn off auto-reply:** In the official account management screen's **Response settings**, turn off **Auto-reply messages** (if left on, LINE also sends its preset replies).
7. **Connect:** Click **Connect** in the Ieon messenger window; after the bot connects, a **6-digit number** appears. In LINE on your phone, **add** that official account **as a friend** (QR code on the Messaging API tab) and send the number in a **1:1 chat** to register as the owner.
8. **Ask:** `/sessions` → `/use 1` → question. AI replies from Section 4 must be on for it to answer.

- **How answers arrive:** If the answer comes quickly, it's sent as a LINE "reply" (free); if it takes long, "Received. Working on the answer." is sent first as a reply and **the real answer is sent as a "push"**. Push messages count toward the **monthly free message quota** of the official account plan (varies by plan and country; check the official information).
- Don't use the same LINE Official Account for another program's webhook (there's only one Webhook URL — whichever was entered last receives).
- Menu names may differ slightly as LINE redesigns its screens.

---

# Advanced use

## 8. Advanced: using hub mode

1. **Opening the hub for the first time:** When you open the hub address, **Create admin** appears. Enter a password (10 or more characters) twice. From then on, you log in with this password (separately in each browser).
2. **Connecting a PC to the hub (easiest way):** On the hub screen, **Settings → Apps and devices → Devices → PC connection link → Create link** → open the resulting link in a browser on the PC you want to connect. When "Connect this PC to the hub?" and the hub address appear, click **Connect** **only if it's a link you created**. The link can be used once within 10 minutes.
   - **Other way (6-digit code):** On the PC screen, enter the hub address in **Settings → Apps and devices → Hub connection → Connect to hub** and click **Connect** → a 6-digit code → on the hub screen, in **Settings → Apps and devices → Devices → Connection requests**, click **Approve** if the code matches. When reconnecting the same PC, choose "Replace existing device".
3. **Access restriction:** On the hub screen, in **Settings → Admin → Hub security → Security (hub access restriction)**, set where the hub can be opened from (my IP, Cloudflare Access, Tailscale). Changes that would block where you're currently connecting from aren't saved.
4. **Using it on a phone (optional):** Open the hub address in a phone browser, log in, then **Add to Home screen** (on Android Chrome, "Install app"; on iPhone Safari, the Share button). The hub opens only from the places allowed in step 3, and can't be used without internet. On Android, the **Ieon App** (`<hub address>/app` on your phone) is recommended (Section 9-1).

- The conversation list on the hub screen is grouped by PC name. If you choose a PC in **＋ Connect conversation** on the hub screen, that PC's recent Codex conversations appear (that PC must be on).
- **Once a PC is connected to the hub**, the PC screen no longer takes questions and shows a "This PC is connected to a hub" card (**Open hub screen**). To get real answers, **the PC's AI replies** must be on (Section 4).

**Using new sessions on the hub (optional)**

1. In ChatGPT web **Settings → Security**, turn on "Enable device code login for Codex, Excel, PowerPoint, and Word".
2. On the hub screen, **Settings → Admin → Hub security → Codex login (this hub) → Log in** → open the address shown, enter the code, and approve. Once it says "Logged in", you can turn the setting from step 1 off again.
3. In the same field, turn on **Turn on real runs for hub new sessions**, and in the new session part of **Settings → Admin → Register conversations**, save "Turn on new session creation".
4. Create one with **＋ New session** at the top left of the hub screen by choosing an engine (from a hub messenger bot, `/new codex <name>`). On the hub and engine cells, you can use Codex and Claude (server Claude login), and Antigravity is also installed on the hub (used with a Gemini API key in the hub's Antigravity account — not yet verified for real). Grok works on PCs with the Grok CLI installed. The default place to create a new session is the first engine cell that's on.

## 8-1. Advanced: installing on a Linux server (server install mode, hub mode)

To have Codex and Claude answer from a server without keeping a PC on, install Ieon on a Linux server. There's only **one install command**; everything else (admin password, login, messengers) is done on the web screen.

**Before installing**

| What you need | Details |
| --- | --- |
| Linux server | Ubuntu 22.04 or later recommended (both x64 and arm64). Cloud (Oracle, AWS, Vultr, etc.) or a home server. You must be able to run commands with **sudo** (admin rights) |
| Server size | See the **Recommended specs** table below |
| SSH access | You must be able to get into the server from your PC with `ssh user@server-address` (where you'll enter the install command) |
| git | If missing, `sudo apt-get install -y git` |
| Docker | If missing, the install script asks and installs it the official way (get.docker.com) |
| One port | Open the web screen port (default 28770) to your PC's address in the server firewall and cloud security rules |
| AI account | A ChatGPT (Codex) or Claude subscription, or each company's API key (pay per use — services used by other people need an API key) |
| https address (optional) | To use KakaoTalk, the Ieon App, or a phone, you need a domain and https (e.g. put Caddy, Nginx, or Cloudflare in front, pointing to this port). Not needed if you only use the web screen |

**Recommended specs** (estimates before measurement during development — to be corrected after real measurement)

| Use | Concurrent questions | CPU | Memory | Disk |
| --- | --- | --- | --- | --- |
| Personal (server install mode, 1–2 engines) | 1–2 | 2 cores | 4GB | 20GB |
| Small service (a few staff) | 3–5 | 4 cores | 8GB | 40GB |
| Larger | 5+ | About 1 core and 1–1.5GB more per concurrent question | | As much as the stored conversations |

Installation works even below the recommended specs (you're told during installation). Change container sizes with `IEON_MEM` (Ieon) and `ENGINE_MEM` (one engine cell) in the environment file (`.env`) of the install folder.

**Installing (when you already have an Ieon hub — recommended)**

1. On your existing hub screen, **Settings → Admin → Hub security → Install on a new server → Create install command → Copy** (admin only, usable for 1 hour).
2. Paste it into the new server's terminal and press Enter. Example:

```bash
curl -fsSL https://<hub-address>/install/<key>/install.sh | sh
```

   It downloads the install files from that hub, extracts them to `~/ieon-gateway`, and goes straight to the questions below (no repository access needed). To put it in another folder, prefix it with `IEON_DIR=/your/folder`.

**Installing (downloading from the repository — when you have repository access)**

```bash
git clone https://github.com/cyhuh7950/ieon-gateway.git && cd ieon-gateway
```

```bash
sh deploy/server/install.sh
```

The repository is private, so `git clone` fails without access (measured in SV4 on 2026-11-19) — in that case, use "download from the hub" above.

For most questions, just press **Enter** (default). If run without a terminal (remote execution), it installs to the end with defaults and no questions.
- **Use:** 1) Server install mode — run the AI only on this server (no PC connection) / 2) Hub mode — this server + connected PCs. You can change from 1 to 2 later on the screen (data kept).
- **Addresses to allow:** Where the web screen can be opened from. The default is the address of the PC you're currently connected from over SSH. `all` means from anywhere (a password is still required). Change it later in **Settings → Admin → Hub security**.
- **This server's address:** If you have an https domain, enter it; otherwise press Enter (the server's internal address is used — engine cells connect via this address). The address to open from outside (public IP) is shown separately at the end of the installation.
- **API key (optional):** If you enter an OpenAI or Anthropic API key here, you're logged in right away (the input isn't shown on screen). To use a subscription, press Enter — you log in on the screen.
- **Engine cell for work:** Enter (create). Reading and editing files happen in this cell (commands and file edits are asked via approval cards).

**After installing**

1. Open the **address to open from outside** shown at the end of the installation in a browser on your PC → **Create admin** (password of 10 or more characters).
   - **If it doesn't open (cloud server):** The cloud firewall is blocking the new port. On Oracle, open it in **Instance → Subnet → Security list → Add ingress rule** (TCP 28770); on AWS, in **Security groups**. If you already run other services on 80 and 443, you can also forward a domain to this server's port 28770 from the front end (Nginx Proxy Manager, etc.).
2. **Settings → Account**: log in under **Codex accounts** (for a subscription, approve in the approval window, or use an API key) · log in under **Claude accounts** (for a subscription, approval window → paste the code shown, or use an API key). Doing it once lets this server and all engine cells share it.
3. In **Settings → Messenger**, enter the bot tokens for the messengers you'll use (Section 1-4).
4. **＋ New session** at the top left → choose **Where** as "Server · main" (the work cell), create it, and ask. Conversations a person opened directly on the server appear when you choose that cell in **Settings → PC settings** (**Connect**).
5. KakaoTalk: this server receives Kakao **directly, without a relay**. You need an https address, and enter the Kakao chatbot skill address with that address as in Section 7-1.

**Updating and backing up**
- Update: on the hub screen, in **Settings → Admin → Hub security → Install on a new server**, create a new install command and paste it into the server terminal again. Values you entered, data, and logins stay as they are, and engine cells are also updated to the new version.
- To update just one engine cell: `sh deploy/hub/ieun.sh engine update <name>`.
- If you have repository access, you can also run `git pull` in the install folder followed by `sh deploy/server/install.sh`.
- Data is in `hub/data` (conversation history, logins, settings) and `engines/` (engine cells) in the install folder — back up these two folders.
- To create more engine cells or open one directly: `sh deploy/hub/ieun.sh engine add <name>` · `engine claude <name>` · `engine tui <name>`.

## 9. Advanced: moving a messenger bot from the PC to the hub

**If the same bot is turned on on both the PC and the hub at the same time**, on Telegram and Slack messages get split and the status shows "Conflict", and on Discord answers may arrive twice (the status still shows "Connected", so it's hard to notice). **When you enter a token on the hub, that bot turns on within 1 minute.** So always follow the steps below in order.

1. **Turn it off on the PC:** On the PC screen, **Settings → Messenger** → click that bot, turn off "Turn on this bot" in the edit fields, and click **Save**.
2. **Confirm it's off:** After about 1 minute, open the **Messengers** window on the PC screen. If that messenger appears as "Off" and can't be selected, it's off.
3. **Add it to the hub:** In the **Messengers** window on the hub screen, choose that messenger, enter the same token, and click **Connect**.
4. **Confirm the connection:** When a number appears in the hub messenger window (= connected), send that number to the bot to register as the owner. The allowlist is separate for the PC and the hub, so you must register again on the hub.
5. **Test:** Send `/whoami` to the bot and check that the "Bot name" is the name set on the hub, then check that answers arrive with `/sessions` → `/use` → a short question.

To go back, do the reverse: **turn it off on the hub first** (turn off "Turn on this bot" in hub **Settings → Messenger**), confirm, then turn it on on the PC. Bot names, multiple bots, roles, and allowed users are set in **Settings → Messenger** ([MESSENGER_MANUAL](MESSENGER_MANUAL.md)).

## 9-1. Connecting the Ieon App

> **To follow along and check from the start, see [APP_GUIDE](APP_GUIDE.md)** — getting the app, what to tap on install warnings, the order for checking each feature, and a results form.

There's an **Ieon App** for phones (Android) and PCs. You **get it from the hub**, without an app store: on a phone, `<hub address>/app` in the browser; on a PC, **Settings → Apps and devices → Get the app**. Phone notifications arrive even with the app closed (9-3). The iPhone app is on hold.
- **What you can do in the app:** Connect with the server address + pairing code → **AI staff list** (name, icon, role, status) → tap one for a **1:1 conversation** (questions and answers, including history exchanged on the web) → **approval cards** (**Allow/Deny** command runs and file changes), **needs review cards** (tell whether it ran), and for failures that were certainly not sent, **Resend** once. Answers and cards appear right away without refreshing.
- **Rooms (several AI staff):** On the first screen, **Rooms → + New room** → choose a room name, AI staff (1–10), and a lead (who answers when nobody is called). In a room, tapping an **@name chip** below adds @name to the input box, and "→ Sending to @who" appears above the input box.
  - If a called AI staff member is busy or off, the message isn't sent after waiting; only a **"Not sent"** notice is left — you can tap **Resend** below it once.
  - Tap **Hand off to other AI staff** below a finished answer to send that answer to another AI staff member (AIs never call each other on their own; only when a person taps).
  - When an AI staff member asks for approval in a room, an **approval card** appears right in the room.
  - Use the ⚙ in the room header to change the name, AI staff, lead, and shared guide, or delete the room (only the room history is deleted; each AI staff member's conversation stays).
- **AI staff name and icon:** Change them with the ✎ in the 1:1 conversation header. Names have no spaces (so you can call them with @name). Roles are set on the web screen.
- **Android back button:** In a conversation or room it goes to the list; in the list it closes the app.
- **Voice:** See 9-2 below. Settings will continue to be changed only on the web screen.
- **If it says the connection was lost:** That device was disconnected on the web screen, or the server changed. Create a new pairing code and enter it again.
- **To use PC mode from a phone:** The phone and this PC must be on the same Tailscale network, and you enter this PC's Tailscale address (e.g. `http://100.x.y.z:port`) as the server address. To use it conveniently from outside, use hub mode (the hub address).

How to create a pairing code:
- Click **Settings → Apps and devices → Connect Ieon App → Create pairing code** to get the **server address** and an **8-digit pairing code**. Enter both in the app to connect (the code works once within 10 minutes).
- Connected apps appear in the list in the same field; click **Disconnect** and that app stops working immediately (to reconnect, a new code is needed).
- Use conversations, rooms, cards, and approvals in the app; **settings are changed only on this web screen**.
- In PC mode, create it on this PC's screen; in hub mode, on the hub screen (to use it from outside, use hub mode).

## 9-2. Ask by voice and listen to answers (voice)

Both the web screen and the Ieon App use **only features built into the device** (no keys, no fees, nothing extra to install).
- **🎤 Voice input:** Tap the 🎤 next to the input box and speak; it's converted to text and **put into the input box.** It isn't sent right away, so edit it and then tap **Send**. Questions written by voice in the app get a "🎤 Voice" label (only while you're viewing this screen).
- **🔈/🔊 Read aloud:** Tap the 🔈 at the top of the conversation to change it to 🔊, and **new answers are read aloud when they arrive** (off by default, remembered only on this device). In the app, you can also use **🔈 Read** on each answer to read just that one. Code blocks and link addresses are shortened to "Code omitted" and "Link" when read.
- **One-time notice:** Depending on the device, voice may go through the device maker's servers (Google, Microsoft, Apple). The Ieon server doesn't store your voice or the dictated text separately (sent questions stay in the conversation history as usual).
- **Approvals aren't given by voice.** Only with the Allow/Deny buttons on the card.

| Where | 🎤 Voice input | 🔊 Read aloud |
| --- | --- | --- |
| Android app | The device dictation window (Google) appears and transcribes — the Ieon App doesn't hold microphone permission | Device read aloud (Google TTS) |
| PC app (Ieon installed version) | Tapping 🎤 shows a tip: click the input box and press **Windows key + H** (Windows dictation) | Windows text-to-speech voice |
| Web screen (Chrome, Edge) | Browser dictation — when the browser first asks for microphone permission, allow it | Browser read aloud |

- If 🎤 isn't shown, that browser doesn't have a dictation feature (e.g. Firefox). On a PC, you can dictate anywhere with **Windows key + H**.
- If read aloud makes no sound, check the device volume and whether a text-to-speech voice for your language is installed (Android: Settings → Accessibility or Language → Text-to-speech).

## 9-3. Notifications and installing the PC app

**Notifications** — When an answer arrives or approval is waiting, you're notified only with **"○○ replied" / "○○ is waiting for approval" / "Couldn't send to ○○"**. Question and answer text is not included in notifications. If you're looking at that screen, you aren't notified, and tapping a notification opens that conversation.
- **PC app (Ieon App):** On from the start. Notifications arrive as Windows notifications while the app is open or minimized (not when the app is closed). To turn them off, click **🔔 Notifications on** at the bottom of the first screen.
- **Web screen:** Click **🔕 Notifications** at the bottom left and the browser asks to "Allow notifications" → allow. Once allowed, notifications arrive as Chrome or Edge notifications **even after you close the tab**. If you blocked them, allow notifications from the lock icon at the left of the address bar.
- **Phone (Android):** Notifications arrive even with the app closed. The hub admin needs to upload the Firebase files once ([APP_GUIDE](APP_GUIDE.md) 8-7 Phone notifications).

**Installing the PC app** — Run the install file you get with the **PC app** button in **Settings → Apps and devices → Get the app** on the hub screen.
1. The install file isn't signed yet, so if Windows shows the **"Windows protected your PC"** window, click **More info → Run anyway**.
2. Choose the install folder (default: your user folder, no admin rights needed) and click **Install**.
3. Open it with **"Ieon App"** on the desktop or Start menu (the "Ieon" on the desktop is a separate shortcut to this PC's web screen).
4. The first time you open it, enter the server address and pairing code as in 9-1.
- Uninstalling: Windows Settings → Apps → Installed apps → **Ieon App** → Uninstall. For a new version, install over it with a new install file from the same place (Get the app).

## 9-4. Deleting and privacy

- **Disconnect this device (app):** At the bottom of the app's first screen, **Disconnect this device** → confirm. The server deletes this device's key, and the connection information stored in the app is also deleted (to use it again, a new pairing code is needed). You can also disconnect it from the web screen in Settings → Apps and devices → Connect Ieon App.
- **Deleting a conversation's server history:** In the app, **✎ → Delete this conversation's server history** at the top of the 1:1 conversation; on the web screen, the conversation's **Connection settings → Stored history → Delete this conversation's server history**. It deletes only that conversation's questions and answers left on the Ieon server (this PC or hub); the original Codex or Claude session history stays. This can't be undone.
- **Privacy Policy:** The link at the bottom of the app's connection screen and first screen, or `/privacy` after the server address (e.g. https://ieun-gateway.sinsan.kr/privacy). Anyone can view this page even with access restriction on (it contains no personal information).

## 10. Advanced: using Ieon from your own programs (API keys)

In **Settings → Admin → External programs**, enter a program name and click **Issue key**. The key is shown only once, so put it into that program's settings right away, check the sessions it can see, and save. When it's no longer needed, click **Revoke**. For usage, see [API_GUIDE](API_GUIDE.md).

## 11. Turn off, turn on again, update, back up, delete

### What is stored where

| Data | Location | When you delete Ieon |
| --- | --- | --- |
| Ieon settings (bot tokens, hub connection, AI replies, allowlist, API keys) | `.local` in the Ieon folder | Deleted too |
| Ieon records (list of connected conversations, **history of questions and answers sent from Ieon**, request status, logs) | `.local` in the Ieon folder | Deleted too |
| Logins of Ieon-only accounts (Section 4-1) | `.local\accounts` in the Ieon folder — conversation history isn't here; it links to the Codex app's folder | Deleted too (logging out first with Settings → Account → Delete is recommended) |
| **Original Codex conversations** | `%USERPROFILE%\.codex` (Codex app side) | **Not deleted.** Questions and answers sent from Ieon also stay in those conversations |
| **Original Claude Code sessions** | `%USERPROFILE%\.claude` (Claude Code side) | **Not deleted** |
| Hub settings and records | Hub server | They stay on the hub even if deleted on your PC (the hub admin cleans them up) |

### How to do each task

| What you want to do | How |
| --- | --- |
| Stop only the AI calls | Turn off the **AI replies** switch at the top of the conversation (Section 4). Ieon stays on but doesn't call the AI |
| Disconnect only from the hub | "Disconnect" in **Settings → Apps and devices → Hub connection** on the PC screen. To use it again, "Reconnect" |
| Remove the pairing between this PC and the hub | "Forget hub" in the same place. To use it again, step 2 of Section 8 |
| Turn off the PC | Just turn it off. Ieon starts automatically at the next sign-in |
| Turn Ieon off completely | The **turn off** command below. Auto-start and the shortcut are removed and the server stops. **`.local` (settings and records) remains** |
| Turn it on again | The **turn on** command below |
| Update to a new version | **Overwrite the same Ieon folder** with the new version's files (don't delete or overwrite the `.local` folder). Then run the **turn on** command. Settings and tokens stay as they are, and if components changed, they're reinstalled automatically (internet needed) |
| Back up | **Turn off** command → copy the whole `.local` folder in the Ieon folder to a safe place → **turn on**. This folder contains secret values such as bot tokens, so don't give it to others or keep it in a shared folder |
| Restore from a backup | **Turn off** → put the backed-up `.local` back in the Ieon folder → **turn on** |
| Delete completely | **Turn off** command → (back up if needed) → delete the Ieon folder. Only Ieon's settings and records are deleted; the original Codex and Claude conversations remain |

Turn off:

```powershell
pwsh scripts/install.ps1 -Uninstall
```

Turn on (turn on again, apply an update):

```powershell
pwsh scripts/install.ps1
```

## 12. Troubleshooting

| What you see | What to do |
| --- | --- |
| It says `pwsh` can't be found | PowerShell 7 isn't installed. Install it using the official guide in 1-2 |
| Installation stops with "Node.js 24 is required" | Install 24 from nodejs.org, then run it again |
| Opening the shortcut doesn't show the screen | The **turn on** command in Section 11 (if already installed, it just restarts) |
| The desktop icon looks like a browser | Press F5 on the desktop. On PCs without Edge, opening in a browser tab is normal |
| Codex shows "Login needed" in step 1 of initial setup | Log in in the Codex app, then check again |
| The conversation list is empty | Check that you've used at least one conversation in the Codex app, or use "Advanced: enter conversation ID" in 3-A |
| "Claude session off" | Check that the Claude Code window from step 1 of 3-B is open. On a PC installed earlier, run the install command once more (adds the channel preparation) |
| A Codex question is refused as "in use" | Close that conversation in the Codex app and send again |
| "Real runs are off" or "AI replies are off" | The **AI replies** switch at the top of the PC screen (or **Turn on AI replies** on the card). For hub new sessions, the hub's **Settings → Admin → Hub security → Codex login (this hub)** |
| The bot says "No token" | Choose that messenger in the **Messengers** window and enter the token again |
| No answers in the messenger | Register as the owner with the number from step 4 of Section 6, and check that AI replies are on |
| Bot status is "Conflict" / answers arrive twice | The same bot is on in two places → turn one off following the steps in Section 9 |
| Kakao says "AI chatbot callback is not turned on" | 7-1 step 6: turn on Use callback in the fallback block |
| The Kakao skill URL doesn't appear in the messenger window | The Kakao relay isn't set up on this PC (table in 7-1) |
| The LINE Webhook URL doesn't appear in the messenger window | LINE currently works only on the hub screen (7-2) |
| No answers in LINE | Check that you entered the Webhook URL and turned on **Use webhook**, turned off auto-reply, are in a 1:1 chat, registered as the owner with the 6-digit number, and that AI replies are on |
| "PC disconnected" | Check that the PC is on, and in hub mode, that **Settings → Apps and devices → Hub connection** on the PC screen says "Connected" |
| "This PC is connected to a hub" | You can't send from the PC screen. Use **Open hub screen** to send from the hub |
| A notice that device code is turned off during hub Codex login | Turn on the ChatGPT security setting from Section 8, then click **Log in** again |

Commands for development and troubleshooting (`scripts/ieon.ps1`) are in the appendix of [MANUAL](MANUAL.md). You normally won't need them.
