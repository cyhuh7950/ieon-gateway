<!-- source: docs/APP_GUIDE.md @ ee3e10c -->
# Ieon App walkthrough — from installation to checking features

This manual is for **following along from start to finish to check the Ieon App (Android and PC) and the new web features**. Just go in order, mark the **☐ Check** at the end of each step, and then report back using [9. Report your results](#9-report-your-results) at the end.

- **The current version is 0.1.9** (updated 2026-11-20, below). This document was first written on 2026-11-14 for 0.1.1 (test version), and later versions' features have been added since (Tasks screen, stopping a request, resume check, hand-off-to-a-human cards, "busy" notices, file paths on approval cards, phone notifications). Current setup: hub `ieun-gateway.sinsan.kr`; this PC is running in **hub mode** (connected to the hub).
- For feature descriptions only, see [BEGINNER_GUIDE](BEGINNER_GUIDE.md) 9-1 to 9-4; for the developer API, see [API_GUIDE](API_GUIDE.md) 7-1.
- 2026-11-20: **0.1.9** — **OpenAI voice** (8-2): 🎤 works as OpenAI speak once then listen, or OpenAI live conversation, following the method chosen in Settings. Asks for microphone permission the first time. Install over 0.1.8.
- 2026-11-20: **0.1.8** — **English screens**: the app's text follows the device language (English if it is not Korean), and you can change it with the language picker under the pairing screen and the list. The PC app window title and menu, and dictation and read-aloud, follow too. Install over 0.1.7.
- 2026-11-20: **0.1.7** — Fixed the settings tab name in the app's pairing screen instructions to **Settings → Apps and devices → Connect Ieon App** (no feature changes). If 0.1.6 is installed, download from the hub's `/app` and install over it (same official signature, so you don't need to uninstall).
- Updated 2026-11-19: The app is now **0.1.7** (officially signed) and is **downloaded from the hub** (no store — section 1-2). **Phone notifications** that arrive even when the app is closed (section 8-7) now work. The iPhone app is on hold.

---

## 0. At a glance — what you'll check

| # | What to check | Where | Time needed |
| --- | --- | --- | --- |
| A | Install and connect the Android app | Phone | 10 min |
| B | Install and connect the PC app | This PC | 5 min |
| C | AI staff list, 1:1 questions and answers | Phone and PC app | 5 min |
| D | Approval cards (work mode) | Phone | 5 min |
| E | Resend | Phone | 5 min |
| F | Rooms (multiple AI staff) | Phone and PC app | 10 min |
| G | AI staff name and icon | Phone | 2 min |
| H | Voice (voice input, read aloud) | Phone, PC app, web | 5 min |
| I | Notifications | PC app, web, phone | 5 min |
| J | Delete history, disconnect, Privacy Policy | Phone and web | 5 min |

> **AI usage:** When you send questions in C to I, the real Codex or Claude answers, so each account's usage is consumed. **Use a test conversation, not a work conversation** (such as the Codex test conversation). Do the approval cards (D) only in a test conversation with work mode turned on.

---

## 1. What you need (before you start)

### 1-1. Must-haves

| Requirement | How to check | If missing |
| --- | --- | --- |
| Ieon is running on this PC | Open **Ieon** on the desktop → the conversation list appears | Restart this PC and open it again (manual [BEGINNER_GUIDE](BEGINNER_GUIDE.md) 11) |
| Signed in to the hub web screen | Open https://ieun-gateway.sinsan.kr in a browser → sign in | The password is the hub admin password you set |
| A conversation to continue is connected to the hub | A conversation (e.g. the Codex test conversation) appears in the list on the left of the hub screen | Connect it with [BEGINNER_GUIDE](BEGINNER_GUIDE.md) section 3 |
| AI replies on | The switch at the top of this PC's Ieon screen shows **AI replies on** | Tap the switch to turn it on |
| Android phone | Android **7.0 or later** (Settings → About phone → Software information) | iPhone isn't supported yet |
| Phone internet | Wi-Fi or mobile data | — |
| Windows for the PC app | Windows 10 or 11 | — |

### 1-2. Installation files — download from the hub (since 2026-11-18, no store)

- **Phone:** In your phone browser's address bar, enter **`ieun-gateway.sinsan.kr/app`** → the Android app downloads right away.
- **PC:** On the hub web screen, use the **PC app** button in **⚙ Settings → Apps and devices → Get the app**.
- When a new version is published, **"New version ○○ available — download"** appears at the top of the app's first screen. Tap it to download; the phone will ask you to install (update).

> From 0.1.6, the Android app has **Ieon's official signature**. If 0.1.5 or earlier (test signature) is installed, **uninstall it once**, install the new one, and reconnect with a pairing code (Android won't install over an app with a different signature). The PC installer isn't signed yet, so a Windows warning appears on first run (below).

### 1-3. Server address and pairing code — once per app

Each time you connect an app, you need a **new pairing code** (usable only once, within 10 minutes). Create separate ones for the phone and the PC app.

1. Open https://ieun-gateway.sinsan.kr in a browser → sign in.
2. Bottom left **⚙ Settings** → top tab **Apps and devices**.
3. Tap **Create pairing code** in the **Connect Ieon App** section.
4. The **server address** (`https://ieun-gateway.sinsan.kr`) and an **8-digit pairing code** appear → enter them in the app within 10 minutes.
5. After connecting, that device (e.g. "Ieon Android") appears in the list in the same section.

☐ Check 1-3: An 8-digit pairing code appeared.

---

## 2. Install and connect the Android app (A)

### 2-1. Get the file onto your phone

- **Easiest way:** In your phone browser's address bar, enter `ieun-gateway.sinsan.kr/app` → download → tap the downloaded file.
- Other ways (moving the file from the PC):

- **KakaoTalk "Chat with myself":** Open Chat with myself in KakaoTalk on the PC and drag the APK file into it → tap that file in KakaoTalk on the phone.
- **USB cable:** Connect the phone to the PC → choose "File transfer" in the phone's notification → in File Explorer on the PC, copy the APK to the phone's `Download` folder → on the phone, open the **My Files** app → tap it under Downloads.
- **Google Drive:** Upload it to Drive on the PC → download it in the Drive app on the phone and tap it.

### 2-2. Install

1. When you tap the APK, a window like **"For your security, your phone is not allowed to install unknown apps from this source"** appears → **Settings** → turn on **Allow from this source** → go back.
   (If you got it via KakaoTalk, it asks about KakaoTalk; if via My Files, about My Files. You can turn it off again after testing.)
2. Tap **Install**.
3. If a **Play Protect** window ("Unknown app" / "Scan app") appears → **More details → Install anyway** (or "Install without scanning").
4. When installation finishes, tap **Open**. An **Ieon** icon — a white Korean letter **"i"** (the first letter of Ieon in Korean) on a teal background — appears on the phone's home screen.

☐ Check 2-2: When you open the app, the teal "i" letter image appears briefly, then the **Connect Ieon** screen appears.

### 2-3. Connect

1. **Server address** field: `ieun-gateway.sinsan.kr` (you can leave out the https:// at the front).
2. **Pairing code** field: the 8 digits you created in 1-3.
3. (Optional) Tap **Device name** to rename it — default "Ieon Android".
4. Tap **Connect**.

| Result | Meaning |
| --- | --- |
| The first screen (**Ieon** — list of rooms and AI staff) appears | Success |
| "The pairing code is wrong, already used, or more than 10 minutes old" | Create a new code and try again |
| "Couldn't reach the server" | Check the phone's internet and the server address |

☐ Check 2-3: The conversations (AI staff) connected to the hub appear on the first screen. This phone appears in the list at hub Settings → Apps and devices → Connect Ieon App.

---

## 3. Install and connect the PC app (B)

1. Double-click the installer you downloaded with the **PC app** button in **⚙ Settings → Apps and devices → Get the app** on the hub web screen.
2. If a blue **"Windows protected your PC"** window appears → **More info** → **Run anyway**.
3. Setup wizard: leave the install folder as is (your user folder; no admin rights needed) → **Install** → **Finish**.
4. Open **Ieon App** from the desktop or Start menu.
   (The **Ieon** that was already on the desktop is a separate shortcut to this PC's web screen. The names differ so you don't mix them up.)
5. Create a **new pairing code** with 1-3 and connect as in 2-3 (server address `ieun-gateway.sinsan.kr`).

☐ Check 3: The PC app window (a tall window) shows the same list as the phone. **🔔 Notifications on** appears at the bottom.

---

## 4. AI staff list and 1:1 conversations (C)

### 4-1. View the list

In the **AI staff** section of the first screen, there is one row per conversation: icon (the first letter of the name if none), name, small text below (role, engine, PC name), and the **status** on the right.

| Status | Meaning |
| --- | --- |
| Idle | You can send right away |
| Processing | This conversation is answering |
| PC off | That PC isn't connected |
| Notifications N | There's a card to handle (e.g. AI is off) |
| Needs review | You need to check the result of the last question |

### 4-2. Ask a question

1. Tap one test conversation.
2. Type a short question in the input box at the bottom (e.g. "Don't tell me the time, just reply with hello") → **Send**.
3. "Waiting for the answer…" → when the answer arrives, it turns into a speech bubble (no refresh needed).
4. Tap ‹ to go back to the list → when you go back in, the messages you just exchanged are still there (messages exchanged on the web show too).

☐ Check 4: Question → the answer appeared without a refresh. The same history also appears in that conversation in the PC app.

> If it can't send, the input box shows "Can't send right now", and a reason card appears at the top (e.g. "The PC is disconnected").

---

## 5. Approval cards (D) — in a Codex or Antigravity test conversation with work mode on

1. On the **hub web screen**, choose the Codex or Antigravity test conversation → **Connection settings** at the top → check **Turn on work mode**.
   (Only conversations with a work folder set can turn it on. If it won't turn on, do the preparation in [BEGINNER_GUIDE](BEGINNER_GUIDE.md) 5-2 first.)
2. In the **phone app**, open that conversation and send a question that creates a file. Example: "Create a file hello.txt in the work folder and write hi in it."
3. After a moment, a yellow-bordered **"Approval needed — change files"** (or "run command") card appears in the conversation. It shows what the AI wants to do, the folder, and "Denied if not decided by ○:○○".
4. **Allow** → the work proceeds and an answer arrives. (Try once more and tap **Deny** too → the answer says it "did not run it.")
5. When done, uncheck **Turn on work mode** on the web again.

☐ Check 5: An approval card appeared on the phone, and Allow/Deny was applied as chosen.

---

## 6. Resend (E) — only when it's certain it wasn't sent

The **Resend** button appears once, only for questions that couldn't be sent (e.g. the conversation is in use elsewhere). Questions with an unknown result are not resent; they are resolved with a review card.

1. Open the test conversation in the **Codex desktop app** (the test conversation, not a work conversation).
2. Send a question to that conversation from the phone app → red speech bubble "Not sent because this conversation is open in the Codex app…" + **Resend**.
3. Close that conversation in the Codex desktop app → tap **Resend** on the phone → an answer arrives. The button appears only once.

☐ Check 6: Couldn't send → Resend → answer.

---

## 7. Rooms (F) — several AI staff together

### 7-1. Create a room

1. **+ New room** in the **Rooms** row of the first screen.
2. Choose a **Room name** (e.g. Dev team), check 2 or more in **AI staff**, choose the **Lead** (the staff member who answers when no one is called), and if needed a **Shared guide** (text added before every question in this room).
3. **Create** → the room screen opens.

### 7-2. Ask in a room

1. Tap an **@name chip** at the bottom (e.g. @codex) and `@codex ` is added to the input box, with **"→ Sending to @codex"** shown above. If no one is called, "→ Sending to @lead".
2. If you call two members and send, it goes to each of them. Answers appear as speech bubbles under each name.
3. If a called member is off or busy, a yellow **"○○ — … Not sent"** notice + **Resend to ○○** (once).
4. Under a finished answer, **Hand off to other AI staff** → choose who to hand off to → (optional) a message to send along → **Hand off**. That answer is quoted and sent to the other staff member (only when a person taps it).
5. If a work-mode conversation in the room asks for approval, the approval card appears in the room.

### 7-3. Edit or delete a room

**⚙** at the top of the room → change the name, members, lead, and shared guide and tap **Save**; at the very bottom, **Delete this room** (only the room's history is deleted; each staff member's conversation stays as is).

☐ Check 7: Only the staff called with @name answered / an off member showed a "Not sent" notice / hand-off worked / after deleting the room, the 1:1 conversations remain.

---

## 8. Other features (G to J)

### 8-1. AI staff name and icon (G)

1. **✎** at the top of a 1:1 conversation.
2. **Name** (no spaces; the name used to call them with @name in rooms), **Icon** (one emoji, e.g. 🛠) → **Save**.
3. The top, the list, and the chips in rooms change right away. Names with spaces are rejected with "Names must be … with no spaces…". The role is set on the web screen.

☐ Check 8-1: The name and icon were applied to the list and rooms.

### 8-2. Voice (H)

The first time you use it, a **"Before using voice"** notice appears once → **OK**.

| Where | 🎤 Voice input | 🔈/🔊 Read aloud |
| --- | --- | --- |
| Phone app | Tap 🎤 and the **Google dictation window** appears → speak → the text goes **into the input box** (not sent right away; edit it, then send). Sent questions show "🎤 Voice" above them | Tap 🔈 at the top of the conversation to make it 🔊 (on) → new answers are read aloud. **🔈 Read** under an answer reads just that answer |
| PC app | Tapping 🎤 shows a hint: **click the input box and press Windows key + H** (Windows dictation) | Reads with a Windows Korean voice |
| Web screen (Chrome, Edge) | 🎤 to the left of the input box → if the browser asks for microphone permission, **Allow** → speak | **🔈 Read aloud** at the top → on |

- Approvals are never given by voice (card buttons only).
- If there's no sound, check the device volume; on Android, check that Korean is available in Settings → Text-to-speech.

**OpenAI voice (V2, 2026-11-20, app 0.1.9 and later; web after the hub is deployed):** On the web, go to **Settings → Accounts → OpenAI voice**, enter an **OpenAI API key** and pick a **Voice method** — it changes right away (the app and web re-read the setting every time you tap 🎤). The first time, a "Before using OpenAI voice" notice appears → **OK**. The phone app asks to **allow the microphone** the first time → allow.

| Voice method | When you tap 🎤 | Hearing answers |
| --- | --- | --- |
| Built-in device (default) | As in the table above | Device voice |
| OpenAI speak once, then listen | Recording starts (red outline) → tap 🎤 again when done → OpenAI turns it into text **in the input box** (edit, then send) | 🔊 and 🔈 Read use an OpenAI voice |
| OpenAI live conversation | A **live bar** appears at the bottom (status, time left, [Mute], [Hang up]) → talk hands-free. For anything about the work, OpenAI sends it to that conversation's **work session as a question** (it shows up in the chat as a 🎤 question), and when the answer arrives it reads back a 1-3 sentence summary (the full answer is on screen) | Interpreter voice |

- Live conversation works in one-to-one chats only (in rooms, use built-in or speak once). It hangs up on its own after silence (60 seconds by default), and when the daily max (30 minutes by default) or max per call (15 minutes by default) runs out. Tap 🎤 again or [Hang up] to end it right away.
- When an approval card appears, it tells you to approve on the screen — approvals are still card buttons only.
- If there's no key or today's time is used up, tapping 🎤 shows the reason below.

☐ Check 8-2: What I said on the phone went into the input box as text / new answers were read aloud.

### 8-3. Notifications (I)

Notifications show only **"○○ replied" / "○○ is waiting for approval" / "Couldn't send to ○○"**, never the content of questions or answers. They don't appear while you're viewing that screen.

- **PC app:** On from the start. With the PC app **minimized** (or while viewing another window), send a question **from the phone**; when the answer arrives, a Windows notification appears at the bottom right of the screen. Clicking the notification brings the PC app to the front and opens that conversation.
- **Web screen:** **🔕 Notifications** at the bottom left of the hub screen → if the browser asks to "Show notifications," **Allow** → **🔔 Notifications on**. While you're viewing another tab, a question from another device triggers a notification.
- **Phone:** Notifications arrive even when the app is closed (8-7 Phone notifications, below). If the app is open, you see it on screen right away.

☐ Check 8-3: A Windows notification appeared while the PC app was minimized / a web notification appeared / notifications had no content.

### 8-4. Delete, disconnect, Privacy Policy (J)

1. **Delete conversation history:** ✎ at the top of a 1:1 conversation → **Delete this conversation's server history** → confirm → that conversation screen is cleared (the original Codex or Claude session history stays). On the web, the same button is in Connection settings → Stored history. **It can't be undone, so do this only in a test conversation.**
2. **Privacy Policy:** **Privacy Policy** at the bottom of the app's first screen → opens in the phone browser.
3. **Disconnect this device:** **Disconnect this device** at the bottom of the first screen → confirm → the app returns to the **Connect Ieon** screen. In hub Settings → Apps and devices → Connect Ieon App, that device shows as disconnected. To use it again, you need a new pairing code.

☐ Check 8-4: Deleting history, opening the Privacy Policy, and disconnecting all worked.

### 8-5. Android back button

On a conversation or room screen, the phone's **Back** → list; on the list, **Back** → the app closes.

☐ Check 8-5

### 8-6. Tasks screen

**☰ Tasks** at the top of the list → shows Awaiting approval (Allow, Deny), In progress / needs review, and recent questions. Try a question's **Details** (question, approval result, answer), **Stop** (while in progress), and **To conversation**. While a question is being sent, you can also stop it with **Stop** in the 1:1 conversation while waiting for the answer.

☐ Check 8-6: The Tasks screen opens, and Details and To conversation work.

### 8-7. Phone notifications (Android, from 0.1.4)

Even when the app is closed or sent to the home screen, "○○ replied / is waiting for approval / Couldn't send" arrives on the phone (question and answer content is not sent). They aren't shown while you're looking at the app.

1. **Once only (hub admin):** In the [Firebase console](https://console.firebase.google.com), create a project → add an Android app (package name `kr.sinsan.ieon`) → download `google-services.json` → ⚙ Project settings → Service accounts → **Generate new private key**. Upload both files in the hub's **⚙ Settings → Apps and devices → Phone notifications** (the private key isn't shown again).
2. When you open the app, **"Allow Ieon to send you notifications?"** → **Allow** (on Android 12 and earlier, it's on without asking).
3. Tapping a notification opens that conversation. To turn off: phone Settings → Notifications → Ieon, or **Turn off phone notifications (remove key)** on the hub.

☐ Check 8-7: With the app in the background, asking a question brings a "○○ replied" notification, and tapping it opens that conversation.

---

## 9. Report your results

Copy the block below, change each ☐ to ☑ (works) / ✗ (doesn't work), and for anything that didn't work, send a screenshot or the message that appeared.

```
[Ieon App test results]
1-3 Pairing code ☐
2-2 Android install ☐   2-3 Connect ☐
3   PC app install and connect ☐
4   Question and answer ☐
5   Approval card (Allow/Deny) ☐
6   Resend ☐
7   Rooms (@name, notices, hand-off, delete) ☐
8-1 Name and icon ☐
8-2 Voice (voice input / read aloud) ☐ / ☐
8-3 Notifications (PC app / web) ☐ / ☐
8-4 Delete history, Privacy Policy, disconnect ☐
8-5 Back button ☐
8-6 Tasks screen ☐
8-7 Phone notifications (even with the app closed) ☐
What didn't work or seemed odd:
```

---

## 10. After testing

| To do | How |
| --- | --- |
| If you'll keep using the app | Just leave it as is |
| Remove the phone app | Long-press the icon → Uninstall. If you do **Disconnect this device** in the app first, the server-side key is deleted too (if you didn't, **Disconnect** it in hub Settings → Apps and devices → Connect Ieon App) |
| Undo "Allow from this source" | Phone Settings → Apps → (KakaoTalk, My Files, etc.) → Install unknown apps → off |
| Remove the PC app | Windows Settings → Apps → Installed apps → **Ieon App** → Uninstall |
| Turn off work mode | Hub web → that conversation's Connection settings → uncheck Turn on work mode |
| Turn off web notifications | Click **🔔 Notifications on** at the bottom left of the hub screen |
| Unused pairing codes | They stop working on their own after 10 minutes |

---

## 11. If something goes wrong

| Message or symptom | Cause | What to do |
| --- | --- | --- |
| The pairing code is wrong… more than 10 minutes old | Wrong code, already used, or expired | Create a new code with 1-3 |
| Couldn't reach the server | Internet or address | Check the address `ieun-gateway.sinsan.kr`, and check Wi-Fi or mobile data |
| This device was disconnected | The device was disconnected on the web | Reconnect with a new code |
| PC off / Can't send because the PC is disconnected | This PC's Ieon is disconnected from the hub | Check that this PC is on and online, and restart Ieon on this PC |
| AI replies are off | This PC's switch is off | Turn on the switch at the top of this PC's Ieon screen |
| Not sent because this conversation is open in the Codex app… | That conversation is open on the desktop | Close it and tap **Resend** |
| The result can't be confirmed | Unclear whether it was sent | On that conversation's review card, choose "It ran / It didn't run" |
| No approval card appears | Work mode is off / not a Codex or Antigravity conversation | Redo step 1 of section 5 |
| 🎤 isn't shown (web) | The browser doesn't support dictation (e.g. Firefox) | Use Chrome or Edge, or Windows key + H |
| No sound | Volume, or no Korean voice installed | See the notes under 8-2 |
| No Windows notification | You're looking at the PC app / notifications off / Windows Do not disturb | Test while minimized, check 🔔 on the first screen, and turn on **Ieon App** in Windows Settings → System → Notifications |
| No web notification | The browser blocks notifications | Lock icon left of the address bar → Notifications → Allow |
| "App not installed" during installation | An app with the same name but a different signature exists | Uninstall the existing Ieon app and install again |
