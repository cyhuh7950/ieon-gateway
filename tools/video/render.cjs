// intro.html을 프레임마다 그려 ffmpeg로 보낸다(화면 녹화가 아니라 시간값으로 그리기 — 매번 같은 결과).
// electron render.cjs <timeline.json> <video|still> <out.mp4|폴더> <fps> [t1,t2,..]  (Electron은 콜론 든 인수를 받으면 꺼져서 나눠 받는다)
// 찍기는 개발자 도구의 Page.captureScreenshot — 그 순간 화면을 새로 그려 찍으므로 앞 장면이 찍히지 않는다.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.on("window-all-closed", () => {});
const ai = process.argv.findIndex((a) => a.endsWith("timeline.json"));
const [tlFile, mode, out, fpsArg, timesArg] = process.argv.slice(ai, ai + 5);
const FPS = Number(fpsArg) || 25;

app.whenReady().then(async () => {
  const TL = JSON.parse(fs.readFileSync(tlFile, "utf8"));
  const total = TL[TL.length - 1].start + TL[TL.length - 1].dur;
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, "intro.html"));
  await win.webContents.executeJavaScript(`window.__TIMELINE = ${JSON.stringify(TL)}; window.__ready.then(() => true)`);
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const frame = async (t, format = "jpeg") => {
    await win.webContents.executeJavaScript(`render(${t}); 1`);
    const r = await dbg.sendCommand("Page.captureScreenshot", { format, quality: 93, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
    return Buffer.from(r.data, "base64");
  };
  if (mode === "still") {
    fs.mkdirSync(out, { recursive: true });
    for (const t of timesArg.split(",").map(Number)) fs.writeFileSync(path.join(out, `f_${t.toFixed(2)}.png`), await frame(t, "png"));
    console.log("stills", timesArg);
    app.exit(0); return;
  }
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), out], { stdio: ["pipe", "inherit", "inherit"] });
  const n = Math.round(total * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frame(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % (FPS * 10) === 0) process.stdout.write(`frame ${i}/${n} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
  }
  ff.stdin.end();
  ff.on("close", (c) => { console.log("video done", c, out); app.exit(c); });
});
