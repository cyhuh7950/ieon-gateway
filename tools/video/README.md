# 소개 동영상 만들기 도구

[docs/video/INTRO_SCENARIO.md](../../docs/video/INTRO_SCENARIO.md)의 소개 영상을 만드는 도구. 새로 설치할 것 없음 — 이 PC에 있는 ffmpeg, `app/`의 Electron, Windows 한국어 목소리(Heami)를 쓴다. 결과물은 `.local/video/`(저장소에 올리지 않음).

| 파일 | 하는 일 |
| --- | --- |
| `demo-server.mjs` | 영상용 가짜 서버(127.0.0.1:28799). 법률봇·세무봇·보험봇·코덱스 대화와 미리 써 둔 예시 답(모델 호출 없음, 실제 업무 대화·열쇠 없음) |
| `viewer.cjs` | 웹 화면을 띄우는 Electron 창(개발자 도구 포트로 조작) |
| `cdp.mjs` | 개발자 도구 조작 도우미(크기·밝은 화면·글자 넣기·누르기·찍기) |
| `capture-intro.mjs` | 실제 화면 캡처 — 휴대폰 크기 PC 앱 + 웹 화면 → `.local/video/shots/` |
| `intro-scenes.mjs` | 장면 목록(말·최소 길이) — 시나리오와 같은 문장 |
| `tts.ps1` | 장면별 목소리 WAV(Heami) |
| `intro.html` | 그림 장면 — `render(t)`로 그 순간을 그림(자막도 화면에 그림) |
| `render.cjs` | `intro.html`을 프레임마다 찍어 ffmpeg로(개발자 도구 화면 찍기) |
| `build-intro.mjs` | 시간표(목소리 길이) → 그림 → 목소리 합치기 → MP4 + SRT |
| `sheet.mjs` | 미리 보기 그림을 한 장으로 모으기 |

## 다시 만들기 (저장소 맨 위에서)

```bash
node tools/video/demo-server.mjs
```
(첫 줄의 `code` 확인 — 연결 코드)

```bash
app/node_modules/electron/dist/electron.exe app/electron/main.cjs --remote-debugging-port=9333 --user-data-dir=.local/video/ud-app
```

```bash
app/node_modules/electron/dist/electron.exe tools/video/viewer.cjs --remote-debugging-port=9335 --user-data-dir=.local/video/ud-web http://127.0.0.1:28799/
```

```bash
node tools/video/capture-intro.mjs <연결코드>
```

```bash
node -e "import('./tools/video/intro-scenes.mjs').then(m=>require('fs').writeFileSync('.local/video/lines.json', JSON.stringify(m.SCENES.map(s=>({id:s.id,say:s.say})))))"
```

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/video/tts.ps1 -List .local/video/lines.json -Out .local/video/voice
```

```bash
node tools/video/build-intro.mjs still
```
(장면마다 한 장 → `.local/video/stills`, `node tools/video/sheet.mjs .local/video/stills .local/video/sheet.png`로 한눈에)

```bash
node tools/video/build-intro.mjs
```
→ `.local/video/이어온_소개.mp4`, `.local/video/이어온_소개.srt`

## 알아 둘 것

- **Electron에 콜론(:)이 든 인수를 주면 바로 꺼진다** — `render.cjs`는 인수를 나눠 받는다.
- 화면 밖(offscreen) 창의 `capturePage`·`paint`는 **바로 앞 그림**이 찍히는 일이 있어, 개발자 도구 `Page.captureScreenshot`으로 찍는다.
- 메신저·AI 제품 로고는 상표라 쓰지 않고 글자 이름표 + 첫 글자 동그라미로 그린다.
- 배경음은 넣지 않았다(저작권 없는 음원을 고르면 `build-intro.mjs` 5단계에서 섞으면 됨).
- 목소리를 신산님 목소리로 바꾸려면 `.local/video/voice/<장면>.wav`를 같은 이름으로 바꾸고 `build-intro.mjs`를 다시 실행(장면 길이가 목소리에 맞춰 바뀜).

## 영어 소개 영상 만들기 (I18N I3 — 소개 영상만 영어)

같은 도구에 `VIDEO_LANG=en`만 붙인다. 장면 말은 `intro-scenes.en.mjs`, 그림 장면의 화면 글은 `intro-text.en.js`(`intro.html`의 `L('한국어 원문')` → 영어), 작업 폴더는 `.local/video/en/`.

```bash
VIDEO_LANG=en VIDEO_PORT=28799 node tools/video/demo-server.mjs
```
(대화 이름·AI 직원·예시 답·서버 언어가 영어. 첫 줄의 `code`)

```bash
app/node_modules/electron/dist/electron.exe app/electron/main.cjs --remote-debugging-port=9333 --user-data-dir=.local/video/en/ud-app
```

```bash
app/node_modules/electron/dist/electron.exe tools/video/viewer.cjs --remote-debugging-port=9335 --user-data-dir=.local/video/en/ud-web http://127.0.0.1:28799/
```

```bash
VIDEO_LANG=en node tools/video/capture-intro.mjs <연결코드>
```
(앱은 `ieon_lang=en`, 웹은 쿠키 `ieon_lang=en`으로 영어 화면을 찍는다 → `.local/video/en/shots`)

```bash
node -e "import('./tools/video/intro-scenes.en.mjs').then(m=>require('fs').writeFileSync('.local/video/en/lines.json', JSON.stringify(m.SCENES.map(s=>({id:s.id,say:s.say})))))"
```

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/video/tts.ps1 -List .local/video/en/lines.json -Out .local/video/en/voice -Culture en-US
```
(Windows 기본 영어 목소리 Zira)

```bash
VIDEO_LANG=en node tools/video/build-intro.mjs still
VIDEO_LANG=en node tools/video/build-intro.mjs
```
→ `.local/video/en/Ieon_intro_en.mp4`, `.local/video/en/Ieon_intro_en.srt`

- 화면 점검(가짜 언어): `VIDEO_LANG=xx node tools/video/demo-server.mjs`로 띄우면 서버가 가짜 언어 `xx`(모든 문구를 `[!! … !!]`로 1.4배)를 켠다. 화면 맨 위 언어 칸에서 `xx`를 고르면 넘침·잘린 버튼·사전에 없는 글을 찾을 수 있다(평소에는 없음 — `IEON_PSEUDO_LOCALE=1`일 때만).

## 사용법 영상(01~06) 만들기

[docs/video/SCRIPT.md](../../docs/video/SCRIPT.md)의 01~06편. 소개 영상과 같은 도구에 아래만 더했다.

| 파일 | 하는 일 |
| --- | --- |
| `usage-scenes.mjs` | 편마다 장면 목록(말·화면 종류·캡처 그림·강조 테두리·확대) — 대본과 같은 문장 |
| `capture-usage.mjs` | 웹 화면(01~04) + 휴대폰 크기 PC 앱(04·05) 실제 화면 → `.local/video/usage-shots/` |
| `usage.html` | 그림 장면(표지·웹 창·휴대폰 틀·받아쓰기 흐름·PC 알림·끝) — 자막도 화면에 그림 |
| `build-usage.mjs` | 목소리(없을 때만 `tts.ps1`) → 시간표 → 그림(`render.cjs`, `VIDEO_HTML=usage.html`) → MP4 + SRT |

```bash
VIDEO_SET=usage VIDEO_DELAY_MS=3500 node tools/video/demo-server.mjs
```
(`VIDEO_SET=usage`: 꺼진 회사 PC 대화를 더하고, 작업 모드 대화는 허락 카드를 올린다 — 실제로 실행하는 것은 없음)

```bash
app/node_modules/electron/dist/electron.exe tools/video/viewer.cjs --remote-debugging-port=9335 --user-data-dir=.local/video/ud-web http://127.0.0.1:28799/
```

```bash
app/node_modules/electron/dist/electron.exe app/electron/main.cjs --remote-debugging-port=9333 --user-data-dir=.local/video/ud-usage-app
```

```bash
node tools/video/capture-usage.mjs
```
(웹 먼저 — 방·작업 모드·연결 코드를 웹에서 만든 뒤 휴대폰. 캡처가 끝나면 가짜 서버·두 창을 끈다)

```bash
node tools/video/build-usage.mjs still
```
(편마다 장면 한 장씩 → `.local/video/usage-stills/<편>`)

```bash
node tools/video/build-usage.mjs
```
→ `.local/video/이어온_사용법_01_웹질문.mp4` … `_06_메신저로일시키기.mp4`와 같은 이름의 `.srt`. 한 편만: `node tools/video/build-usage.mjs 03`.

- **06 메신저로 일 시키기:** 웹 메신저 창만 찍으려면 `node tools/video/capture-usage.mjs messenger`(가짜 서버·웹 창만 켜 두면 됨). 가짜 서버에는 메신저 모듈·실제 봇이 없어, 캡처 도구가 그 창이 묻는 봇 상태·토큰 저장·확인 숫자만 화면 안에서 가짜로 돌려준다(아무 데도 보내지 않음, 토큰도 가짜). 텔레그램 대화는 `usage.html`의 `chat` 장면이 그린다 — 장면의 `msgs`는 `[보낸 쪽, 글, 나타나는 비율]`, 봇 글은 `locales/ko/messenger.json`과 같은 문장으로 맞춘다.

- 확인 창(confirm·prompt)은 캡처에 찍히지 않아 캡처 도구가 미리 "예"로 답한다. 받아쓰기 창과 Windows 알림은 실제로 띄우지 않고 `usage.html`에서 그린다.
- 목소리를 바꾸려면 `.local/video/usage-voice/<편>/<장면>.wav`를 같은 이름으로 바꾸고 `build-usage.mjs`를 다시 실행.

## 영어 사용법 영상(01~06) 만들기 (2026-11-25)

같은 도구에 `VIDEO_LANG=en`만 붙인다. 말·제목·텔레그램 대화는 `usage-scenes.en.mjs`(장면·캡처·강조 상자는 한국어판과 같고, 영어 글이 길어 자리가 바뀐 02-6·03-2·05-6만 상자 위치가 다름), 그림 장면의 고정 글은 `usage-text.en.js`, 작업 폴더는 `.local/video/en/`.

```bash
VIDEO_LANG=en VIDEO_SET=usage VIDEO_DELAY_MS=3500 node tools/video/demo-server.mjs
```

```bash
app/node_modules/electron/dist/electron.exe tools/video/viewer.cjs --remote-debugging-port=9335 --user-data-dir=.local/video/en/ud-usage-web http://127.0.0.1:28799/
```

```bash
app/node_modules/electron/dist/electron.exe app/electron/main.cjs --remote-debugging-port=9333 --user-data-dir=.local/video/en/ud-usage-app
```

```bash
VIDEO_LANG=en node tools/video/capture-usage.mjs
```
(웹은 쿠키 `ieon_lang=en`, 앱은 `ieon_lang=en`으로 영어 화면 → `.local/video/en/usage-shots`. 영어에서는 직원 이름 "Codex"와 엔진 이름이 같아 휴대폰에서는 아이콘 🛠으로 그 줄을 고른다)

```bash
VIDEO_LANG=en node tools/video/build-usage.mjs still
VIDEO_LANG=en node tools/video/build-usage.mjs
```
→ `.local/video/en/Ieon_usage_01_ask_on_the_web.mp4` … `Ieon_usage_06_give_work_by_messenger.mp4`와 같은 이름의 `.srt`(목소리는 Windows 영어 목소리 Zira).

- 가짜 서버의 영어 예시 답은 낱말 단위로 고른다 — 전에는 질문의 "Please"에 든 "lease"가 전세 답을 골랐다.
- 만드는 중 `GPU process exited unexpectedly` / `Unable to capture screenshot`으로 영상이 깨지면(2026-11-25 영어 06편) 그 편만 `VIDEO_NO_GPU=1 VIDEO_LANG=en node tools/video/build-usage.mjs 06`으로 다시 만든다(소프트웨어로 그림, 조금 느림).
