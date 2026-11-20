// 이어온 PC 설치형. 화면(out/)을 app://ieon 으로 열어 출처를 고정한다(서버 CORS는 이 출처만 허용).
// 열쇠는 이 앱의 사용자 폴더(localStorage)에만. 다른 창 열기·권한 요청(카메라 등)은 거절, 바깥 링크는 기본 브라우저로.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const OUT = path.join(__dirname, "..", "out");

// I18N: 창 제목·메뉴는 PC 언어(app.getLocale())로 — 사전은 electron/locales.json(app/scripts/copy-locales.mjs가 만듦). 없는 언어는 영어 → 한국어.
const LOCALES = require("./locales.json");
let tr = (k) => k;
function initLang() {
  const loc = String(app.getLocale() || "").replace("_", "-");
  const lang = LOCALES[loc] ? loc : LOCALES[loc.split("-")[0]] ? loc.split("-")[0] : LOCALES.en ? "en" : "ko";
  tr = (k) => LOCALES[lang]?.[k] ?? LOCALES.en?.[k] ?? LOCALES.ko?.[k] ?? k;
}

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
    width: 480, height: 820, minWidth: 360, minHeight: 560, title: tr("common.product"), backgroundColor: "#111417",
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
    initLang();
    ipcMain.on("ieon:focus", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
    protocol.handle("app", (req) => net.fetch(pathToFileURL(fileFor(req.url)).toString()));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: tr("common.product"), submenu: [{ role: "reload", label: tr("app.electron.reload") }, { role: "toggleDevTools", label: tr("app.electron.devtools") }, { type: "separator" }, { role: "quit", label: tr("app.electron.quit") }] },
    ]));
    return createWindow();
  });
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
