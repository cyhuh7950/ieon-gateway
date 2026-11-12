// 화면 스크립트가 처음 실행될 때 멈추지 않는다(2026-11-12: U8의 새 세션 코드가 $ 정의보다 앞에 있어 새 화면 전체가 멈췄던 일의 재발 방지).
// 문자열 검사만으로는 이런 순서 오류를 못 잡으므로, 화면의 스크립트를 가짜 DOM에서 실제로 돌려 본다(모델 0, 서버 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = (f) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${f}`, import.meta.url)), 'utf8');
const scripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

// 무엇을 읽어도 다시 자기 자신을 돌려주는 가짜 객체(요소·스타일·classList 등). 넣은 값은 기억한다.
function anything() {
  const store = new Map();
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined; // await에 걸리지 않게
      if (store.has(k)) return store.get(k);
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      return proxy;
    },
    set(_, k, v) { store.set(k, v); return true; },
    apply() { return proxy; },
  });
  return proxy;
}

async function boot(html, { authState }) {
  const errors = [];
  const elements = new Map();
  const document = new Proxy({}, {
    get(_, k) {
      if (k === 'getElementById') return (id) => { if (!elements.has(id)) elements.set(id, anything()); return elements.get(id); };
      if (k === 'querySelectorAll' || k === 'getElementsByName') return () => [];
      if (k === 'createElement') return () => anything();
      if (k === 'createTextNode') return (x) => x;
      return anything();
    },
  });
  const fetch = async (path) => {
    const body = String(path).includes('/v1/auth/state') ? authState : {};
    return { status: String(path).includes('/v1/auth/state') ? 200 : 404, // 401이면 화면이 로그인으로 넘어가며 오류를 던진다(정상 동작) — 여기서는 시작만 본다
      ok: false, json: async () => body, text: async () => '' };
  };
  const location = { hash: '', pathname: '/', host: 'h', origin: 'http://h', href: 'http://h/', reload() {} };
  const ctx = { document, fetch, location, console, Date, JSON, Math, Promise, URL, URLSearchParams, Error, TypeError, Number, String, Object, Array, Map, Set,
    encodeURIComponent, decodeURIComponent, setTimeout: (f, ms) => setTimeout(() => { try { f(); } catch (e) { errors.push(e); } }, Math.min(ms ?? 0, 5)),
    clearTimeout, setInterval: () => 0, clearInterval: () => {}, history: { replaceState() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} } }, confirm: () => false, alert: () => {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    Option: function () {}, addEventListener() {}, innerWidth: 1200 };
  ctx.window = ctx; ctx.self = ctx;
  const onRej = (e) => errors.push(e);
  process.on('unhandledRejection', onRej);
  try { vm.runInNewContext(scripts(html), ctx); } catch (e) { errors.push(e); }
  await new Promise((r) => setTimeout(r, 120));
  process.off('unhandledRejection', onRej);
  // 가짜 DOM이 만드는 엉뚱한 값 때문이 아니라 코드 순서·이름 오류(ReferenceError, 정의 전 사용)만 문제로 본다.
  return errors.filter((e) => e instanceof ReferenceError || /before initialization|is not defined/.test(String(e?.message)));
}

for (const [file, states] of [['app.html', [{ loggedIn: false, mode: 'local', localAuto: true }, { loggedIn: false, mode: 'hub', setupRequired: false }]],
  ['settings.html', [{ loggedIn: true, mode: 'local' }, { loggedIn: true, mode: 'hub' }]]]) {
  test(`화면 시작: ${file}는 정의 전 사용·없는 이름 때문에 멈추지 않는다`, async () => {
    for (const authState of states) {
      const errs = await boot(web(file), { authState });
      assert.deepEqual(errs.map((e) => String(e.message)), [], `${file} ${authState.mode}`);
    }
  });
}