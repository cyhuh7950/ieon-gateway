// 소개 영상 만들기: 목소리 길이로 시간표 → 그림 장면 프레임 → 목소리 합치기 → MP4 + SRT
// 사용(저장소 맨 위에서): node tools/video/build-intro.mjs [still]
//   먼저 할 일: 실제 화면 캡처(.local/video/shots — capture-intro.mjs), 목소리(.local/video/voice — tts.ps1)
//   영어판(I18N I3): VIDEO_LANG=en — 장면 intro-scenes.en.mjs, 화면 글 intro-text.en.js, 작업 폴더 .local/video/en, 결과 Ieon_intro_en.mp4·.srt
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const LANG = process.env.VIDEO_LANG === 'en' ? 'en' : 'ko';
const { SCENES, FPS, LEAD, TAIL } = await import(LANG === 'en' ? './intro-scenes.en.mjs' : './intro-scenes.mjs');

const OUT = LANG === 'en' ? '.local/video/en' : '.local/video';
const NAME = LANG === 'en' ? 'Ieon_intro_en' : '이어온_소개';
const ELECTRON = 'app/node_modules/electron/dist/electron.exe';
mkdirSync(OUT, { recursive: true });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

// 1) 시간표
let t = 0;
const TL = SCENES.map((s) => {
  const wav = `${OUT}/voice/${s.id}.wav`;
  if (!existsSync(wav)) throw new Error('목소리 없음: ' + wav);
  const sayDur = dur(wav);
  const d = Math.max(s.min, LEAD + sayDur + TAIL);
  const row = { id: s.id, start: +t.toFixed(3), dur: +d.toFixed(3), say: s.say, sayStart: +(t + LEAD).toFixed(3), sayDur: +sayDur.toFixed(3), wav };
  t += d; return row;
});
const total = t;
writeFileSync(`${OUT}/timeline.json`, JSON.stringify(TL, null, 1));
console.log(`시간표 ${TL.length}장면, 길이 ${total.toFixed(1)}초`);

// 미리 보기: 장면마다 중간쯤 한 장
if (process.argv[2] === 'still') {
  const times = TL.map((s) => (s.start + s.dur * 0.75).toFixed(2)).join(',');
  spawnSync(ELECTRON, ['tools/video/render.cjs', `${OUT}/timeline.json`, 'still', `${OUT}/stills`, String(FPS), times], { stdio: 'inherit' });
  process.exit(0);
}

// 2) 그림
const video = `${OUT}/intro_video.mp4`;
const r = spawnSync(ELECTRON, ['tools/video/render.cjs', `${OUT}/timeline.json`, 'video', video, String(FPS)], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('그림 실패');

// 3) 목소리 한 줄로(장면 시작 + LEAD에 놓기)
const inputs = TL.flatMap((s) => ['-i', s.wav]);
const filt = TL.map((s, i) => `[${i}:a]aresample=48000,adelay=${Math.round(s.sayStart * 1000)}|${Math.round(s.sayStart * 1000)}[a${i}]`).join(';')
  + ';' + TL.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${TL.length}:normalize=0,apad=whole_dur=${total.toFixed(2)},volume=1.6[out]`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt, '-map', '[out]', '-ac', '2', '-ar', '48000', `${OUT}/intro_voice.wav`]);

// 4) 자막 파일(SRT) — 화면에는 이미 그려 넣었고, 따로도 준다
const ts = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
writeFileSync(`${OUT}/${NAME}.srt`, TL.map((s, i) => `${i + 1}\n${ts(s.sayStart)} --> ${ts(s.sayStart + s.sayDur + 0.25)}\n${s.say}\n`).join('\n'), 'utf8');

// 5) 합치기
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', `${OUT}/intro_voice.wav`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', `${OUT}/${NAME}.mp4`]);
console.log('완성:', `${OUT}/${NAME}.mp4`, `(${total.toFixed(1)}초)`);
