// 사용법 영상(01~06) 실제 화면 캡처: 웹 화면 창(포트 9335) + 휴대폰 크기 PC 앱(포트 9333), 가짜 서버(VIDEO_SET=usage demo-server.mjs)
// 사용: node tools/video/capture-usage.mjs [web|phone]  (비우면 둘 다, 웹 먼저 — 작업 모드·방이 웹에서 만들어진 뒤 휴대폰)
// → .local/video/usage-shots/*.png. 확인 창(confirm·prompt)은 화면에 그릴 수 없어 미리 "예"로 답해 둔다(가짜 서버라 실제로 지워지거나 보내지는 것 없음).
import { mkdirSync } from 'node:fs';
import { connect } from './cdp.mjs';

// 영어판(VIDEO_LANG=en): 웹은 쿠키 ieon_lang=en, 앱은 localStorage ieon_lang=en, 질문·이름·버튼 글은 영어(가짜 서버도 VIDEO_LANG=en) → .local/video/en/usage-shots
const EN = process.env.VIDEO_LANG === 'en';
const T = (ko, en) => (EN ? en : ko);
const OUT = EN ? '.local/video/en/usage-shots' : '.local/video/usage-shots';
const BASE = 'http://127.0.0.1:28799';
mkdirSync(OUT, { recursive: true });
const which = process.argv[2] ?? 'all';
const H = { authorization: 'Bearer web-video', 'content-type': 'application/json' };
const workMode = (on) => fetch(`${BASE}/v1/conversations/c_work/work-mode`, { method: 'PUT', headers: H, body: JSON.stringify({ on }) });
let pairCode = null;

// 글자가 든 요소 누르기(가장 안쪽 것)
const clickText = (c, sel, text) => c.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.textContent.includes(${JSON.stringify(text)})); const el = els[els.length - 1]; if (!el) return false; el.click(); return true; })()`);
const must = async (p, what) => { if (!(await p)) throw new Error('찾지 못함: ' + what); };

async function web() {
  const w = await connect(9335);
  await w.size(1440, 900, 4 / 3, false);
  await w.eval(`document.cookie = 'ieon_lang=${EN ? 'en' : 'ko'}; path=/', location.href = '${BASE}/', 1`); await w.sleep(3000);
  await w.eval('window.confirm = () => true, 1');
  const shot = (n) => w.shot(`${OUT}/${n}.png`);
  const row = (t) => must(clickText(w, '#list .row', t), t);

  // 01 웹 화면에서 질문하기
  await shot('w01_list');
  await row(T('결제 모듈', 'Payment module')); await w.sleep(1500);
  await shot('w01_chat');
  await w.type('#question', T('어제 하던 작업 어디까지 했어?', 'How far did you get with yesterday\'s work?')); await w.sleep(300);
  await shot('w01_typing');
  await w.click('#send'); await w.sleep(900);
  await shot('w01_queued');
  await w.sleep(6500);
  await shot('w01_answer');
  await row(T('회사 PC', 'Office PC')); await w.sleep(1500);
  await shot('w01_card');
  await row(T('결제 모듈', 'Payment module')); await w.sleep(1200);
  await w.click('#panelBtn'); await w.sleep(800);
  await shot('w01_panel');

  // 02 AI 직원과 방
  await w.eval(`(() => { const d = document.getElementById('stName').closest('details'); if (d) d.open = true; return 1; })()`); await w.sleep(400);
  await shot('w02_staff');
  await w.click('#panelClose'); await w.sleep(300);
  await must(clickText(w, '#list button', T('＋ 방', '＋ Room')), '방 만들기'); await w.sleep(600);
  await w.type('#rdName', T('전문 상담', 'Expert advice'));
  await w.eval(`(() => { for (const n of ${JSON.stringify(EN ? ['@LawBot', '@TaxBot', '@InsuranceBot'] : ['@법률봇', '@세무봇', '@보험봇'])}) { const l = [...document.querySelectorAll('#rdMembers label')].find((x) => x.textContent.includes(n)); l.querySelector('input').click(); } return 1; })()`);
  await w.sleep(400);
  await shot('w02_room_dlg');
  await w.click('#rdOk'); await w.sleep(1800);
  await w.type('#question', T('@법률봇 @세무봇 상속받은 집, 법적 절차랑 세금 같이 봐 줘', '@LawBot @TaxBot I inherited a house. Check the legal steps and the taxes together.')); await w.sleep(300);
  await shot('w02_mention');
  await w.click('#send'); await w.sleep(10000);
  await w.eval('document.getElementById("msgs").scrollTop = 1e6, 1'); await w.sleep(400);
  await shot('w02_answers');
  await w.eval(`(() => { let k = 0; window.prompt = () => (k++ % 2 === 0 ? '${T('@보험봇', '@InsuranceBot')}' : ''); return 1; })()`);
  await must(clickText(w, '#msgs button', T('다른 AI 직원에게 넘기기', 'Hand off to another AI staff member')), '넘기기'); await w.sleep(9000);
  await w.eval('document.getElementById("msgs").scrollTop = 1e6, 1'); await w.sleep(400);
  await shot('w02_handoff');

  // 03 허락 카드
  await row(T('결제 모듈', 'Payment module')); await w.sleep(1500);
  await w.click('#panelBtn'); await w.sleep(600);
  await w.eval(`(() => { const c = document.getElementById('wmOn'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`); await w.sleep(900);
  await shot('w03_workmode');
  await w.click('#panelClose'); await w.sleep(1500);
  await w.type('#question', T('환불 처리 테스트 돌려서 결과 알려 줘', 'Run the refund tests and tell me the result')); await w.sleep(300);
  await shot('w03_ask');
  await w.click('#send'); await w.sleep(9000);
  await shot('w03_card');
  await must(clickText(w, '#cards button', T('허용', 'Allow')), '허용'); await w.sleep(9000);
  await w.eval('document.getElementById("msgs").scrollTop = 1e6, 1'); await w.sleep(400);
  await shot('w03_answer');

  // 04 휴대폰 앱 연결 — 웹 설정의 연결 코드
  await w.eval(`location.href = '${BASE}/settings#apps', 1`); await w.sleep(2500);
  await w.eval(`document.querySelector('[data-atab=apps]').click(), 1`); await w.sleep(600);
  await w.eval(`document.getElementById('adCode').scrollIntoView({ block: 'center' }), 1`); await w.sleep(400);
  await shot('w04_settings');
  await w.click('#adCode'); await w.sleep(1200);
  await w.eval(`document.getElementById('adCode').scrollIntoView({ block: 'center' }), 1`); await w.sleep(400);
  await shot('w04_code');
  pairCode = (await w.eval(`document.getElementById('adCodeBox').textContent`)).match(/(\d{4}) ?(\d{4})/).slice(1).join('');
  await w.eval(`location.href = '${BASE}/', 1`); await w.sleep(1500);
  w.close();
}

// 06 메신저로 일 시키기 — 웹의 메신저 창(실제 화면). 가짜 서버에는 메신저 모듈·실제 봇이 없으므로
// 이 창이 묻는 봇 상태·토큰 저장·확인 숫자 응답만 화면 안에서 가짜로 돌려준다(아무 데도 보내지 않음, 토큰도 가짜).
async function messenger() {
  const w = await connect(9335);
  await w.size(1440, 900, 4 / 3, false);
  await w.eval(`document.cookie = 'ieon_lang=${EN ? 'en' : 'ko'}; path=/', location.href = '${BASE}/', 1`); await w.sleep(3000);
  const shot = (n) => w.shot(`${OUT}/${n}.png`);
  await w.eval(`(() => {
    const real = window.fetch; let saved = false; window.__claimed = false;
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    const bot = (platform, on) => ({ platform, botId: 'default', enabled: true, status: on ? { state: 'connected', username: '@my_ieon_bot' } : { state: 'token_missing' } });
    window.fetch = async (u, init = {}) => {
      const p = String(u); const m = (init.method || 'GET').toUpperCase();
      if (p.startsWith('/v1/admin/bots')) return J({ bots: [bot('telegram', saved), bot('discord'), bot('slack'), bot('line'), bot('kakao')] });
      if (p.startsWith('/v1/admin/secrets/')) { saved = true; return J({ ok: true }); }
      if (p.startsWith('/v1/admin/secrets')) return J({ names: [{ name: 'TELEGRAM_BOT_TOKEN', platform: 'telegram', botId: 'default', present: false }] });
      if (p.startsWith('/v1/admin/messenger/claim')) return m === 'POST' ? J({ code: '482913' }) : J(window.__claimed ? { state: 'claimed' } : { state: 'pending' });
      return real(u, init);
    };
    return 1; })()`);
  await shot('m06_btn');
  await w.click('#msgBtn'); await w.sleep(1200);
  await shot('m06_plats');
  await must(clickText(w, '#mPlats button', T('텔레그램', 'Telegram')), '텔레그램'); await w.sleep(1000);
  await w.type('#m2Fields input[data-name]', '7712345678:AAH-video-demo-token-not-real'); await w.sleep(300);
  await shot('m06_token');
  await w.click('#m2Next'); await w.sleep(4000);
  await shot('m06_code');
  await w.eval('window.__claimed = true, 1'); await w.sleep(4000);
  await shot('m06_done');
  w.close();
}

async function phone() {
  const p = await connect(9333);
  await p.size(390, 844, 3, false);
  await p.eval(`localStorage.clear(), localStorage.setItem('ieon_lang', '${EN ? 'en' : 'ko'}'), location.reload(), 1`); await p.sleep(2500);
  await p.eval('window.confirm = () => true, window.alert = () => {}, 1');
  const shot = (n) => p.shot(`${OUT}/${n}.png`);
  if (!pairCode) pairCode = (await (await fetch(`${BASE}/v1/admin/app-devices/code`, { method: 'POST', headers: H, body: '{}' })).json()).code;
  await workMode(false);

  // 04 휴대폰 앱 연결하기
  await p.type('.pair input:not([maxlength])', BASE);
  await p.type('.pair input[inputmode="numeric"]', pairCode); await p.sleep(300);
  await shot('p04_pair');
  await p.click('.pair button.primary'); await p.sleep(3000);
  await p.eval('window.confirm = () => true, window.alert = () => {}, 1');
  await shot('p04_list');
  await must(clickText(p, 'button.row', T('코덱스', '🛠')), '코덱스'); await p.sleep(1500);
  await p.type('textarea', T('환불 처리 테스트는 어떻게 됐어?', 'How did the refund tests go?'));
  await p.click('.composer button.primary'); await p.sleep(900);
  await shot('p04_wait');
  await p.sleep(6000);
  await shot('p04_answer');
  await workMode(true);
  await p.type('textarea', T('테스트 한 번 더 돌려 줘', 'Run the tests once more'));
  await p.click('.composer button.primary'); await p.sleep(9000);
  await shot('p04_card');
  await must(clickText(p, '.card button', T('허용', 'Allow')), '허용'); await p.sleep(8000);
  await shot('p04_allowed');
  await workMode(false);

  // 05 음성·알림·지우기
  await p.eval('localStorage.removeItem("ieon.voice.notice.v1"), 1');
  await must(p.click('button.mic'), '마이크');
  await p.sleep(800);
  await shot('p05_notice');
  await must(clickText(p, '.dialog button', T('확인', 'OK')), '확인'); await p.sleep(500);
  await p.eval(`(() => { const b = [...document.querySelectorAll('.vhint button')].find((x) => x.textContent === '${T('닫기', 'Close')}'); if (b) b.click(); return 1; })()`); await p.sleep(300);
  await shot('p05_chat');
  await p.type('textarea', T('결제 모듈 테스트 결과를 짧게 정리해 줘', 'Summarize the payment module test results briefly')); await p.sleep(300);
  await shot('p05_dictated');
  await p.type('textarea', ''); await p.sleep(200);
  await p.eval(`(() => { const b = document.querySelector('header.bar button[aria-pressed]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); return 1; })()`); await p.sleep(600);
  await shot('p05_speaker');
  await p.eval(`(() => { const b = document.querySelector('header.bar button[aria-pressed="true"]'); if (b) b.click(); return 1; })()`); await p.sleep(300);
  await p.eval(`(() => { const b = [...document.querySelectorAll('header.bar button')].find((x) => x.textContent === '✎'); b.click(); return 1; })()`); await p.sleep(700);
  await shot('p05_edit');
  await p.eval(`(() => { const b = [...document.querySelectorAll('header.bar button')].find((x) => x.textContent === '✎'); b.click(); return 1; })()`); await p.sleep(300);
  await p.click('header.bar button.ghost'); await p.sleep(1200);
  await shot('p05_list');
  // PC 앱 창 크기(알림 장면)
  await p.size(480, 820, 2, false); await p.sleep(800);
  await shot('p05_pc');
  await p.size(390, 844, 3, false);
  p.close();
}

if (which === 'messenger') await messenger();
else {
  if (which !== 'phone') await web();
  if (which !== 'web') await phone();
  if (which === 'all') await messenger();
}
console.log('usage shots done');
