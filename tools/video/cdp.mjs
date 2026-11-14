// 개발자 도구 프로토콜(CDP) 조작 도우미 — 동영상 캡처용
import { writeFileSync } from 'node:fs';

export async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
    return r.result?.result?.value;
  };
  return {
    send, eval: evalJs,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // 화면 크기·밝은/어두운 화면 고정
    async size(width, height, scale = 1, dark = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    // React 입력칸에 글자 넣기
    async type(selector, text) {
      await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const P = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(P.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    },
    async click(selector, textIncludes) {
      return evalJs(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${textIncludes ? `els.find((e) => e.textContent.includes(${JSON.stringify(textIncludes)}))` : 'els[0]'}; if (!el) return false; el.click(); return true; })()`);
    },
    close: () => ws.close(),
  };
}
