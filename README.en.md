# Ieon (ieon-gateway)

[한국어](README.md) | **English**

Ieon connects messengers (KakaoTalk, Telegram, Discord, Slack, LINE), the Ieon App (Android, PC) and the web to the **AI work sessions you already run on your PC or server** (Codex, Claude Code, plus Antigravity and Grok), so you can **ask them questions and give them work**. It continues **the same session** — it never swaps in a new chat.

## What it does

- **Give work from your messenger:** Away from your desk, send "fix this error" or "run the tests and tell me" from your phone's messenger. The Codex or Claude Code session on your PC or server actually edits files and runs commands, then sends the result back to that messenger.
- **Continue the session:** Messages from a messenger, the app or the web go into the session you were working in, and the reply comes back where you sent it. Nothing is sent while the session is busy, the PC is off, or a previous result is unknown.
- **Work mode and approval cards:** File edits and commands are turned on per conversation. Each time, a card appears in the messenger, app or web and a person taps [Allow] or [Deny]. You also get the outcome (succeeded or failed).
- **Two install types:** PC type for this PC only, and Hub type that ties several PCs and servers into one hub (with member sign-up and limits).
- **New sessions, engine slots, scheduled jobs, rooms (several AI staff), phone notifications, voice** (on-device, or OpenAI one-shot and real-time conversation) and **languages** (Korean and English; adding a language is easy).

## Documents

| What | Document |
| --- | --- |
| Step-by-step guide for first-time users | [docs/en/BEGINNER_GUIDE.md](docs/en/BEGINNER_GUIDE.md) |
| User manual | [docs/en/MANUAL.md](docs/en/MANUAL.md) |
| Ieon App | [docs/en/APP_GUIDE.md](docs/en/APP_GUIDE.md) |
| Messenger setup | [docs/en/MESSENGER_MANUAL.md](docs/en/MESSENGER_MANUAL.md) |
| Join and use someone else's hub | [docs/en/MEMBER_GUIDE.md](docs/en/MEMBER_GUIDE.md) |
| Running a hub (members, limits, backups) | [docs/en/OPERATIONS.md](docs/en/OPERATIONS.md) |
| Connect your own program (HTTP API) | [docs/en/API_GUIDE.md](docs/en/API_GUIDE.md) |
| Add a new language | [docs/en/I18N_ADD_LANGUAGE.md](docs/en/I18N_ADD_LANGUAGE.md) |

Design, plan and status records are in Korean: [PRODUCT.md](PRODUCT.md), [docs/design/DESIGN.md](docs/design/DESIGN.md), [docs/WORK_PLAN.md](docs/WORK_PLAN.md), [docs/WORK_STATUS.md](docs/WORK_STATUS.md).

## Run

- **This PC (Windows):** `pwsh scripts/ieon.ps1 start | stop | status` — see section 2 of the manual.
- **Hub (server, Docker):** [deploy/hub](deploy/hub/) — deployment steps are in [OPERATIONS](docs/en/OPERATIONS.md).
- **Install on a new server:** the one-line command at **Settings → Admin → Hub security → Install on a new server** in the hub screen (or `sh deploy/server/install.sh`).
- **Get the Ieon App:** [GitHub downloads (Releases)](https://github.com/cyhuh7950/ieon-gateway/releases/latest) — Android `ieon-android-*.apk`, Windows installer `ieon-setup-*.exe`. You can also download it from `/app` on your hub. Build from [app/](app/) (`npm run package:android:release`, `npm run package:desktop`).

## Development

- Node.js 24 or later. Tests: `node --test --test-timeout=60000 tests/pilot/*.test.mjs tests/relay/*.test.mjs`; app: `cd app && npm test`.
- Screen text is not written in code; it lives in dictionaries (`locales/<language>/*.json`).
- No direct commits to main. Use a `claude/<purpose>` or `codex/<purpose>` branch → push → a `pr-request/<sha>/<branch>` tag, and the PR Broker checks and merges it (AGENTS.md, "기록과 Git").
- Public repository. Secrets (keys, tokens, passwords) never go into code, Git or logs.
