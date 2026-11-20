<!-- source: docs/store/PLAY_LISTING.md @ ee3e10c -->
# Ieon — Google Play listing draft (AP-5a)

Written 2026-11-14. This collects in advance the text and answers you will paste into the Play Console. The actual submission (AP-5) is done with your account. The values below were written to match the current code — update them together when features change.

## 1. Basic information

| Field | Value |
| --- | --- |
| App name (30 chars) | Ieon |
| Package name | `kr.sinsan.ieon` |
| Category | Productivity |
| Short description (80 chars) | Continue your PC's Codex and Claude Code work sessions from your phone. |
| Privacy Policy URL | https://ieun-gateway.sinsan.kr/privacy |
| Contact email | (you decide — shown publicly) |
| Ads | None |
| In-app purchases | None |

## 2. Full description (up to 4000 chars)

```
Ieon lets you continue the AI work sessions running on your PC (Codex, Claude Code, and more) from your phone and PC.

■ Continue the same session
Instead of starting a new conversation, you send questions to the very work session you were using on your PC and get the answers back.

■ AI staff and rooms
Give each session a name and icon and call it like "AI staff," and gather several AI staff in one room to call them by @name. You can also hand off one staff member's answer to another.

■ Approvals with buttons
When the AI tries to change files or run commands, an approval card appears in the app. You decide only with the Allow/Deny buttons, and if you don't answer within 15 minutes, it is denied.

■ Ask by voice, listen to answers
Use your device's built-in dictation and read-aloud features to ask questions by voice and hear the answers (you edit dictated text before sending).

■ Stored only on your server
Questions and answers are stored only on the Ieon server you installed (your PC or your hub). No account sign-up, no ads, no usage analytics.

※ To use the Ieon App, first install the Ieon program on your PC, then connect the app with a pairing code created on the web screen.
```

## 3. Data safety answers

| Question | Answer | Basis |
| --- | --- | --- |
| Does the app collect or share user data? | **Collects, does not share** | Questions and answers are sent only to the user-owned server the user connected. There is no developer server |
| Encryption in transit | Yes (hub https). When PC mode is used over Tailscale http, Tailscale encryption | |
| How to request deletion | In-app "Disconnect this device", "Delete this conversation's server history", Privacy Policy section 5 | |
| Data collected | Messages (in-app messages — questions and answers), device or other IDs (device name, notification address) | For app functionality, not optional |
| Location, contacts, photos, financial, health | Not collected | No permissions |
| Voice | Not collected (handled by the device's dictation window; the app has no microphone permission) | |

> Note: In Google's terms, "collection" means data leaving the device from the app. Even if the destination is the user's own server, it is safer to answer "Collects" (to avoid rejection in review).

## 4. Content rating and audience

- Target age: 18 and over (developer tool), not directed at children.
- User-generated content: AI answers appear on screen → in the questionnaire, "no sharing between users" (no feature for conversations with other users).

## 5. Reviewer instructions (required — prepare before AP-5)

When a reviewer opens the app, they need a "server address + pairing code." Set up a separate **test hub for review**, connect a test conversation (a test PC that gives fake answers, or a real test session), and then fill in the review instructions field.

```
This app is used by connecting to an Ieon server the user installs themselves. We have prepared a test server for review.
1) Server address: (review hub address)
2) Pairing code: (a code valid during the review period — each code works only once, so prepare several)
After connecting, tap one item in the "AI staff" list and send a question to get a test answer.
```

- Pairing codes currently last 10 minutes and work only once, which doesn't suit review → at AP-5, decide on a "long code for review" (that the owner can create and turn off on the web) or a way to run a review-only test hub.

## 6. Graphics (needed at submission)

| Item | Spec | Status |
| --- | --- | --- |
| App icon | 512×512 PNG | `src/pilot/web/icon-512.png` exists |
| Feature graphic | 1024×500 | Needs to be made |
| Phone screenshots | 2–8 | Take them in the emulator (fake server) |

## 7. Release build

- A Play release requires a signed AAB. **You create and keep the signing key** (if lost, the app can't be updated — Play App Signing recommended). Only a debug APK is being built now.
