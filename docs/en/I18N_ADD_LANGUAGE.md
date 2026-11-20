<!-- source: docs/I18N_ADD_LANGUAGE.md @ 85bf42d -->
# Adding a new language — Ieon

How to add a new language (for example Japanese, `ja`) to the Ieon screens, app and messenger bots. **No code changes** — add one dictionary folder and run the copy tool once. Design: [../design/I18N.md](../design/I18N.md) section 5, I18N-c.

## 0. Before you start

- Dictionaries live at the repository root in `locales/<language>/<bundle>.json`. There are 7 bundles: `common` (shared words), `errors` (error messages), `messenger` (bot replies), `server` (text the server makes), `web` (chat screen), `settings` (settings screen), `app` (Ieon App).
- Korean (`ko`) is the original; English (`en`) is the reference translation. A key missing from the new language falls back to **English → Korean**, so the screens never break even if only part is translated.
- Name the folder with a 2–3 letter language code (plus `-REGION` if needed), such as `ko`, `en`, `ja`, `zh-TW`. The folder name becomes the language code.

## 1. Copy the English dictionary

```powershell
Copy-Item -Recurse locales\en locales\ja
```

## 2. Translate

Change **only the values** in `locales/ja/*.json`. Never rename or remove keys.

| Rule | Example |
| --- | --- |
| Keep every `{name}` placeholder with the same name (order may follow the language) | `"{name} replied"` → `"{name}が返信しました"` |
| For plurals use `{count\|one:…\|other:…}` (`#` = the number) | rarely needed |
| Keep HTML snippets (`<b>`), `\n`, commands (`/sessions`), code and paths as they are | |
| User questions, AI answers, conversation names and AI staff names are not in the dictionary | |

**Special values you must set** for the language:

| Key | Meaning | Japanese example |
| --- | --- | --- |
| `common.lang_name` | Name shown in the language picker (in that language) | `日本語` |
| `common.intl_locale` | Date and number format | `ja-JP` |
| `common.speech_lang` | Dictation and read-aloud language | `ja-JP` |
| `messenger.alias.allow` … `confirm` | Bot command aliases (English commands like `/allow` always work too) | `許可` etc. |
| `messenger.call_suffixes` | Words added after a bot's name when calling it (`\|`-separated, empty if none) | `""` |
| `settings.danger.start` / `settings.danger.end` | Buttons starting/ending with these words get the red "cannot undo" style (regex list with `\|`) | `削除\|解除` etc. |

You can let an AI translate; give it the same glossary and rules used for English so terms stay consistent.

## 3. Copy the app dictionaries

The Ieon App (phone and PC) bundles its own copy. It runs automatically on build (`prebuild` of `npm run build`), but the tests check the copy, so run it once and commit the result:

```powershell
node app/scripts/copy-locales.mjs
```

It also writes `app/src/locales/<language>.json` and `index.ts` (app dictionaries), `app/electron/locales.json` (PC app window title and menu), and `app/android/.../res/values-<language>/strings.xml` (Android app name).

## 4. Run the tests

```powershell
node --test --test-timeout=60000 tests/pilot/*.test.mjs tests/relay/*.test.mjs
```

| Test | What it checks for the new language |
| --- | --- |
| Key match | Fails on keys that Korean doesn't have. Missing keys don't fail; the count is reported (`[I18N] ja: 빠진 키 N개(영어로 보임)` — N missing, shown in English) |
| Placeholder match | Fails if `{name}` placeholders differ from Korean |
| App dictionaries | Fails if you skipped step 3 |

## 5. Check

- Web: the language picker at the top (Settings) and under the login form lists the new language, and choosing it switches the screen. A browser set to that language opens in it from the start.
- App: the language picker under the pairing screen and the list, or the device language.
- Messengers: "Server language" under Settings → Admin → Register conversations, or each bot's "Reply language".
- Overflow check (optional): see "screen check" with the pseudo language in [tools/video/README.md](../../tools/video/README.md).

## 6. (Optional) Documents

- Manuals: copy `docs/en/` to `docs/<language>/` and translate. Keep the first line `<!-- source: docs/<original> @ <commit> -->` so you can tell when the original changes.
- Privacy Policy and Terms of Use: add `src/pilot/web/privacy.<language>.html` and `terms.<language>.html`; `/privacy` and `/terms` then open in that language (legal text: native/legal review recommended).
- PC installer language: add the language (e.g. `ja_JP`) to `build.nsis.installerLanguages` in `app/package.json`.

## What you do not need to change

Server, web screen, app and messenger code; the language list (read from the folders); the language pickers; date and voice handling — all follow the dictionaries. On 2026-11-20 this exact procedure was tried with a test language (the picker, screens, app dictionaries and Android name all appeared without code changes) and then reverted.
