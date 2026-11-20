<!-- source: docs/OPERATIONS.md @ ee3e10c -->
# Ieon hub operations manual — opening your hub to multiple people

This document is the manual for the **hub owner (admin)** when opening and running an Ieon hub so family, colleagues, or other people can use it together. For people signing up, see the [member walkthrough](MEMBER_GUIDE.md); for feature descriptions, see "Using it with multiple people" in the [manual](MANUAL.md); for the design, see [MULTI_USER](../design/MULTI_USER.md).

- Written 2026-11-19 (M4 shared-service operations prep; your instruction "go through item 9 in order").
- Reference hub: `ieun-gateway.sinsan.kr` (Docker on your Oracle server); empty-server install example: `ieon-daon.sinsan.kr` (daon-server, [SERVER_SESSIONS](../design/SERVER_SESSIONS.md) SV4).

---

## 0. What to know before opening

| Item | Details |
| --- | --- |
| AI usage and fees | Members use **their own AI accounts on their own PCs**. They do not share the hub owner's Codex or Claude accounts (hub engine cells and hub new sessions are admin-only). |
| Conversation content | Even the admin **can't see members' conversations through the screen or the API**. However, they can be seen by opening the server's DB file (`hub/data/s2/pilot.db`) directly, so only the hub owner should have server access. |
| Email | Ieon does not send email. If someone forgets their password, the admin creates a **Temporary password** and hands it over directly. |
| Terms and policy | `<hub address>/terms` (Terms of Use) and `<hub address>/privacy` (Privacy Policy) can be opened by anyone regardless of the access restriction, and agreement is collected at sign-up. They are **drafts provided by Ieon**, so the hub owner should read them and check that they fit their own operation (to edit them, change `src/pilot/web/terms.html` and `privacy.html` on the server). |
| Messengers | Members share the hub's Telegram, Discord, Slack, LINE, and KakaoTalk bots (6-digit linking). KakaoTalk can't send messages first, so scheduled replies don't go to KakaoTalk rooms. |

## 1. Opening steps

1. **Check the https address:** For others to use it, the hub must be open on an https domain (with a front end such as Nginx Proxy Manager). For an empty server, see 8-1 of the [beginner walkthrough](BEGINNER_GUIDE.md).
2. **Open the access restriction:** On the hub screen, **Settings → Admin → Hub security → Security (hub access restriction)**. If it's currently an IP list, other people can't reach it. Change it to the range that will use it (login is still required even when opened).
3. **Read the terms and policy:** Open `/terms` and `/privacy` and check the content.
4. **Turn on multi-user:** On the same screen, **Multiple users → Multi-user (accept sign-up requests)**. **Sign-up request** and the **terms agreement box** appear on the login screen.
5. **Set a limit (optional):** In the same section, **Member daily question limit**. Leave it empty for no limit. To set it differently per person, use the **Limit** field in the list.
6. **Announce it:** Send the hub address and the [member walkthrough](MEMBER_GUIDE.md) to the people who will use it.

## 2. Daily tasks

| Task | Where | Notes |
| --- | --- | --- |
| Approve / reject sign-ups | Settings → Admin → Hub security → Multiple users list | No features can be used before approval. The time of terms agreement is recorded |
| Disconnect / turn back on | Same list | Disconnecting logs them out immediately and they can't log in again |
| Temporary password | Same list | Shown only once. That person's logins end. Tell them to change it after logging in |
| Delete | Same list | Deletes all of that person's Ieon records, rooms, schedules, connected PCs, apps, and messenger connections (can't be undone). The original session records on that person's PC remain |
| View usage | **Questions today** in the same list | Number of questions counted since midnight Korea time / limit |
| Change limits | Same section | Default (all members) and per person. 0 = no limit for that person only |

**When the limit is reached:** "You've used up today's question limit" appears on the member's screen and messenger, and the question is not sent (it isn't resent automatically). Admins have no limit.

## 3. Updates, backup, and restore

- **Updates (your hub):** On the development side, like `deploy_w3.sh`, unpack the latest repository version into `~/deploy/ieon-gateway` on the server, then `docker compose -f deploy/hub/compose.yaml build` → `stop` → **back up** → `up -d`. Before deploying, copy the data folder `hub/data/s2` to `backups/<name>-<time>`.
- **New server install and update (empty-server install type):** Paste the command created at **Settings → Admin → Hub security → Install on a new server** on the hub screen (valid 1 hour, admin only) into that server, and it installs or updates to this hub's version (entered values and data stay as they are). The bundle is `/app/ieon-gateway.tar.gz` inside the hub image (source only, no secrets), and it is not handed out without a key (because the repository is private). Reinstalling also recreates existing engine cells with the new version (data and logins stay). For a single cell only, use `sh deploy/hub/ieun.sh engine update <cell name>`.
- **What to back up:** `hub/data/s2` (DB, settings, device key hashes), `hub/data/messenger` (bot token files — secret), `hub/data/apps` (downloadable app files), `hub/data/shared-auth` (server Claude and Codex logins — secret). Backups containing secret files are not moved off the server.
- **Restore:** Stop the container, replace `hub/data/s2` with the backup, and start it again.
- The screens (main screen, settings) ask the server fresh every time, so you don't need to refresh after a deployment.

## 4. When something goes wrong

| Symptom | Check |
| --- | --- |
| A member can't reach the hub | Access restriction (1-2), front-end domain and certificate |
| No "Sign-up request" button | Multi-user is off (1-4) |
| A member's question shows "No device" or "Off" | Ieon on that person's PC is off, or they didn't connect with the PC connection link |
| A member's Codex conversations don't appear in the list | That PC is off, Codex app login, the work conversation is excluded on purpose |
| The server is slow | Check `ieun-relay` memory (default limit 2g) and engine cells with `docker stats`; lower limits |
| Lots of strange access | Narrow the access restriction again, and block that person with Disconnect. Logs don't keep questions, replies, or secrets |

## 5. Not done yet (2026-11-19)

- Real-account check of KakaoTalk member linking.
- Real-account check of shared bots and connecting other people's PCs (only stand-in tests so far).
- Measured specs for a large number of members.
