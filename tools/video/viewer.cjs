// 동영상용 웹 화면 창: electron viewer.cjs <url> — 개발자 도구 포트로 조작·캡처(capture.mjs)
const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: true, autoHideMenuBar: true });
  w.loadURL(process.argv[process.argv.length - 1]);
});
app.on("window-all-closed", () => app.quit());
