<!-- source: docs/MEMBER_GUIDE.md @ ee3e10c -->
# Ieon member walkthrough — using someone else's hub

This document is for **people who sign up and use an Ieon hub run by someone else (the hub owner)**. What the hub owner (admin) needs to do is in "Using it with multiple people" in the [manual](MANUAL.md).

- Written 2026-11-19. Reference hub: `ieun-gateway.sinsan.kr` (the address is different for every hub — get it from the hub owner).
- Once you sign up, you use **only your own Codex and Claude sessions on your own PC**. Usage is also billed to your own account. Your conversations are not shown on screen to other members or to the hub owner.

---

## 0. What you need (before you start)

| What you need | Why |
| --- | --- |
| Hub address | Get it from the hub owner. You can only get in if the hub owner has turned on **multi-user** and opened the hub access restriction |
| One email address | Used as your sign-up ID (no email is sent) |
| Password (10+ characters) | You choose it yourself |
| Your PC (Windows) | This is where the AI actually works. This PC must have **the Codex app (or Claude Code, Antigravity) installed and logged in with your account** |
| Ieon installed on your PC | The program that connects the hub and your PC. For the installation steps, see chapters 2–3 of the [beginner walkthrough](BEGINNER_GUIDE.md) |
| (Optional) Telegram, Discord, Slack, LINE, or KakaoTalk account | Only if you also want to use a messenger (only those messenger bots the hub owner has turned on) |
| (Optional) Android phone | Only if you want to use the Ieon App |

---

## 1. Sign-up request

1. Open the hub address in a browser (Chrome or Edge).
2. On the login screen, enter your **Email** and **Password**, read the **Terms of Use and Privacy Policy**, check the agreement box, and press **Sign-up request**.
   - If there is no "Sign-up request" button, the hub owner hasn't turned on multi-user yet.
3. Press **OK** in the confirmation window → when the **"Waiting for approval"** screen appears, your request is done.
4. Tell the hub owner "I sent a sign-up request." You can't use any features until you're approved.

☐ Check 1: The "Waiting for approval" screen appeared.

## 2. Log in

1. Once approved, open the hub address again, enter your **Email and Password**, and **Log in**.
2. At first there are no conversations at all (this is normal — you haven't connected your PC yet).

| If you see this | It means |
| --- | --- |
| Waiting for approval | You haven't been approved yet |
| This account can't be used | The hub owner rejected or disconnected you |
| Wrong password | Enter it again, or ask the hub owner for a **Temporary password** |

## 3. Connect your PC to the hub

1. On the hub screen, bottom left **⚙ Settings** → top **Apps and devices** → under **Devices**, in **PC connection link**, press **Create link** → **Copy**.
2. Open the link **on your PC** (your PC's Ieon settings screen opens) → enter a name for this PC and press **Connect**.
3. When your PC shows as "Connected" in the device list under **Settings → Apps and devices → Devices** on the hub screen, you're done. Other members' PCs are not shown.

☐ Check 3: Your PC appears in the device list.

## 4. Using conversations — connect an existing conversation or create a new session

**Continue a Codex conversation you were using**

1. On the hub's main screen, left side, press **＋ Connect conversation** → a list of Codex conversations recently used on your PC appears (takes about 10 seconds). If you have more than one PC, choose one in the **PC** field at the top.
2. Press the conversation you want to continue; it connects right away and that conversation opens. Your questions continue in the same Codex conversation on your PC.
   - If your PC is off, you'll see "That PC is off" — turn on Ieon on the PC and press it again.
   - If it's not in the list, use **Advanced: enter conversation ID**.
   - If you ask a question while the same conversation is open in the Codex app on your PC, it is rejected as "in use" (close that conversation in the app).

**Create a new session**

1. On the hub's main screen, top left, press **＋ New session** → enter the engine (Codex, Claude, Antigravity — Antigravity only when it's installed on that PC) and a name, then press **Create**. Where it's created is set to your PC (if none of your PCs is on, it shows "No device").
2. When you send a question to the new conversation, the engine on your PC replies.

☐ Check 4: Your PC's Codex conversations appear in ＋ Connect conversation, and when you choose one, it shows up in the conversation list.

## 5. Using it with a messenger too (optional)

1. On the hub screen, **Settings → Messenger → Messenger connection** shows a "Shared bot" (e.g., Telegram @…bot).
2. Press **Get linking number** → send the 6-digit number exactly as shown to that bot **in a 1:1 chat** (once, within 10 minutes).
3. When the bot replies **"Connected to your Ieon account"** and your messenger account appears in the list on the same screen, the connection is done. Now when you type `/sessions` in that bot, you see **only your conversations**. Choose a conversation with `/use <number>` and ask your question.
4. To stop using it, press **Disconnect** in the same list.

- We recommend a **1:1 chat with the bot** rather than a group chat (in a group chat, one room is tied to one conversation).
- If you enter the wrong number 5 times, you're blocked for 15 minutes. Get a new number.

☐ Check 5: When you type `/sessions` in the bot, only your conversations appear.

## 6. Using the phone app (optional, Android)

1. In your phone browser's address bar, enter **`<hub address>/app`** → the app file downloads → tap it to install (the first time, allow "unknown apps").
2. On the hub screen, **Settings → Apps and devices → Connect Ieon App → Create pairing code** → enter the hub address and the 8-digit code in the app and press **Connect**.
3. When the notification permission window appears, press **Allow** — you'll get "○○ replied" even when the app is closed.

For detailed steps, see the [Ieon App walkthrough](APP_GUIDE.md).

## 7. Other things

- **Change password:** Settings → Account → **My password**. Changing it signs you out everywhere else.
- **If you forget your password:** Ask the hub owner for a temporary password, log in, then change it as above.
- **Browser notifications:** On the hub screen, bottom left 🔕 Notifications → if you allow them, you'll get notifications even when the tab is closed.
- **Scheduled questions:** Settings → Work → Scheduled tasks. Replies arrive in the conversation, in the connected messenger room, and as app notifications.
- **Daily question limit:** If the hub owner has set one, you'll see "You've used up today's question limit" and the question is not sent. You can send again at midnight Korea time.
- **What members can't do:** Hub settings and security, messenger bot settings, other people's PCs and conversations, and the hub server's engine cells. If you need any of these, ask the hub owner.
- **Stopping use:** If you ask the hub owner to delete your account, all your Ieon records (conversation history, rooms, schedules, connected PCs, app connections) are deleted. The original Codex and Claude records on your PC remain.
