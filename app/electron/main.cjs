// 이어온 PC 설치형. 화면(out/)을 app://ieon 으로 열어 출처를 고정한다(서버 CORS는 이 출처만 허용).
// 열쇠는 이 앱의 사용자 폴더(localStorage)에만. 다른 창 열기·권한 요청(카메라 등)은 거절, 바깥 링크는 기본 브라우저로.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const OUT = path.join(__dirname, "..", "out");

function fileFor(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (p === "/" || p === "") p = "/index.html";
  const f = path.normalize(path.join(OUT, p));
  if (!f.startsWith(OUT)) return path.join(OUT, "index.html");
  return path.extname(f) ? f : f + ".html";
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 480, height: 820, minWidth: 360, minHeight: 560, title: "이어온", backgroundColor: "#111417",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://ieon/")) e.preventDefault(); });
  // 알림(AP-4a)만 허용 — 카메라·마이크 등 나머지는 거절
  win.webContents.session.setPermissionRequestHandler((_w, perm, cb) => cb(perm === "notifications"));
  win.webContents.session.setPermissionCheckHandler((_w, perm) => perm === "notifications");
  await win.loadURL("app://ieon/");
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("kr.sinsan.ieon");
  app.whenReady().then(() => {
    ipcMain.on("ieon:focus", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
    protocol.handle("app", (req) => net.fetch(pathToFileURL(fileFor(req.url)).toString()));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "이어온", submenu: [{ role: "reload", label: "새로 고침" }, { role: "toggleDevTools", label: "개발자 도구" }, { type: "separator" }, { role: "quit", label: "끝내기" }] },
    ]));
    return createWindow();
  });
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
