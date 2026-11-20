// 소개 영상 실제 화면 캡처: 휴대폰 크기 PC 앱(포트 9333) + 웹 화면 창(포트 9335), 가짜 서버(demo-server.mjs)
// 사용: node tools/video/capture-intro.mjs <연결코드>  → .local/video/shots/*.png
import { mkdirSync } from 'node:fs';
import { connect } from './cdp.mjs';

// 영어판(VIDEO_LANG=en): 앱·웹 화면을 영어로, 질문·이름도 영어, 결과는 .local/video/en/shots
const EN = process.env.VIDEO_LANG === 'en';
const X = (ko, en) => (EN ? en : ko);
const OUT = EN ? '.local/video/en/shots' : '.local/video/shots';
mkdirSync(OUT, { recursive: true });
const code = process.argv[2];
const phone = await connect(9333);
await phone.size(390, 844, 3, false);
await phone.eval(`localStorage.setItem('ieon_lang', '${EN ? 'en' : 'ko'}'), location.reload(), 1`); await phone.sleep(2500);

// 연결
if (await phone.eval('Boolean(document.querySelector(".pair"))')) {
  await phone.type('.pair input:not([maxlength])', 'http://127.0.0.1:28799');
  await phone.type('.pair input[inputmode="numeric"]', code);
  await phone.click('button.primary'); await phone.sleep(2500);
}
await phone.shot(`${OUT}/p_list.png`);

// 1:1 — 하던 대화에 이어서 묻기
await phone.click('button.row', X('코덱스', 'Codex')); await phone.sleep(1500);
await phone.shot(`${OUT}/p_chat_before.png`);
await phone.type('textarea', X('어제 하던 작업 어디까지 했어?', 'How far did you get with yesterday\'s work?'));
await phone.click('.composer button.primary'); await phone.sleep(600);
await phone.shot(`${OUT}/p_chat_wait.png`);
await phone.sleep(3500);
await phone.shot(`${OUT}/p_chat_answer.png`);
await phone.click('.bar button.ghost'); await phone.sleep(1200);

// 방 — 전문 봇 셋
await phone.click('button', X('방 만들기', 'New room')); await phone.sleep(1200);
await phone.type('.sheet input:not([type])', X('전문 상담', 'Expert room'));
await phone.eval(`(() => { for (const n of ${JSON.stringify(X(['법률봇', '세무봇', '보험봇'], ['LawBot', 'TaxBot', 'InsuranceBot']))}) { const l = [...document.querySelectorAll('label.check')].find((x) => x.textContent.includes(n)); l.querySelector('input').click(); } return 1; })()`);
await phone.sleep(300);
await phone.click('.sheet button.primary'); await phone.sleep(1800);
await phone.type('textarea', X('@법률봇 @세무봇 상속받은 집, 법적 절차랑 세금 같이 봐 줘', '@LawBot @TaxBot I inherited a house. Check the legal steps and the tax together.'));
await phone.sleep(300);
await phone.shot(`${OUT}/p_room_typing.png`);
await phone.click('.composer button.primary'); await phone.sleep(5500);
await phone.shot(`${OUT}/p_room_answers.png`);
await phone.click('button.link', X('다른 AI 직원에게 넘기기', 'Hand off to other AI staff')); await phone.sleep(500);
await phone.eval(`(() => { const b = [...document.querySelectorAll('.card .mchip')].find((x) => x.textContent.includes(${JSON.stringify(X('보험봇', 'InsuranceBot'))})); b.click(); return 1; })()`);
await phone.sleep(300);
await phone.shot(`${OUT}/p_room_handoff_pick.png`);
await phone.eval(`(() => { [...document.querySelectorAll('.card button')].find((x) => x.textContent === ${JSON.stringify(X('넘기기', 'Hand off'))}).click(); return 1; })()`);
await phone.sleep(4500);
await phone.eval('document.querySelector(".log").scrollTop = 1e6, 1'); await phone.sleep(400);
await phone.shot(`${OUT}/p_room_handoff.png`);
phone.close();

// 웹 화면 — 같은 대화 기록
const web = await connect(9335);
await web.size(1440, 900, 4 / 3, false);
await web.eval(`document.cookie = 'ieon_lang=${EN ? 'en' : 'ko'}; path=/', location.reload(), 1`); await web.sleep(3000);
await web.eval(`(() => { const el = [...document.querySelectorAll('#list *')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(X(X('코덱스', 'Codex'), 'Codex'))}) || e.textContent.includes(${JSON.stringify(X('결제 모듈', 'Payment module'))})); (el.closest('button, .item, [role=button], div') || el).click(); return 1; })()`);
await web.sleep(2000);
await web.shot(`${OUT}/w_chat.png`);
await web.eval(`(() => { const el = [...document.querySelectorAll('#list *')].find((e) => e.textContent.includes(${JSON.stringify(X(X('전문 상담', 'Expert room'), 'Expert room'))})); if (el) (el.closest('button, .item, div') || el).click(); return 1; })()`);
await web.sleep(2500);
await web.shot(`${OUT}/w_room.png`);
web.close();
console.log('shots done');
