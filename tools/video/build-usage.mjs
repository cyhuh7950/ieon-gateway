// 사용법 영상(01~06) 만들기: 목소리(tts.ps1) → 목소리 길이로 시간표 → usage.html 프레임 → 목소리 합치기 → MP4 + SRT
// 사용(저장소 맨 위에서): node tools/video/build-usage.mjs [01 02 …] [still]   (편 번호를 비우면 다섯 편 모두)
//   먼저 할 일: 실제 화면 캡처(.local/video/usage-shots — capture-usage.mjs)
//   목소리는 .local/video/usage-voice/<편>/<장면>.wav — 없을 때만 만든다(신산님 목소리로 바꾸려면 같은 이름으로 넣고 다시 실행)
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
// 영어판(2026-11-25): VIDEO_LANG=en — 장면 usage-scenes.en.mjs, 그림 장면 글 usage-text.en.js, 작업 폴더 .local/video/en, 목소리 en-US(Zira)
const LANG = process.env.VIDEO_LANG === 'en' ? 'en' : 'ko';
const { EPISODES, FPS, LEAD, TAIL } = await import(LANG === 'en' ? './usage-scenes.en.mjs' : './usage-scenes.mjs');

const OUT = LANG === 'en' ? '.local/video/en' : '.local/video';
const ELECTRON = 'app/node_modules/electron/dist/electron.exe';
const args = process.argv.slice(2);
const still = args.includes('still');
const eps = args.filter((a) => EPISODES[a]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ts = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };

for (const ep of eps.length ? eps : Object.keys(EPISODES)) {
  const E = EPISODES[ep];
  const vdir = `${OUT}/usage-voice/${ep}`;
  mkdirSync(vdir, { recursive: true });
  // 1) 목소리(없는 장면만)
  const missing = E.scenes.filter((s) => !existsSync(`${vdir}/${s.id}.wav`));
  if (missing.length) {
    writeFileSync(`${vdir}/lines.json`, JSON.stringify(missing.map((s) => ({ id: s.id, say: s.say }))), 'utf8');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/video/tts.ps1', '-List', `${vdir}/lines.json`, '-Out', vdir, ...(LANG === 'en' ? ['-Culture', 'en-US'] : [])], { stdio: 'inherit' });
  }
  // 2) 시간표
  let t = 0;
  const TL = E.scenes.map((s) => {
    const wav = `${vdir}/${s.id}.wav`;
    const sayDur = dur(wav);
    const d = Math.max(s.min, LEAD + sayDur + TAIL);
    const row = { ...s, ep, epTitle: E.title, start: +t.toFixed(3), dur: +d.toFixed(3), sayStart: +(t + LEAD).toFixed(3), sayDur: +sayDur.toFixed(3), wav };
    t += d; return row;
  });
  const total = t;
  const tlFile = `${OUT}/usage${ep}_timeline.json`;
  writeFileSync(tlFile, JSON.stringify(TL, null, 1));
  console.log(`${ep} ${E.title}: ${TL.length}장면, ${total.toFixed(1)}초`);
  const env = { ...process.env, VIDEO_HTML: 'usage.html', VIDEO_LANG: LANG };
  if (still) {
    const times = TL.map((s) => (s.start + s.dur * 0.8).toFixed(2)).join(',');
    spawnSync(ELECTRON, ['tools/video/render.cjs', tlFile, 'still', `${OUT}/usage-stills/${ep}`, String(FPS), times], { stdio: 'inherit', env });
    continue;
  }
  // 3) 그림
  const video = `${OUT}/usage${ep}_video.mp4`;
  const r = spawnSync(ELECTRON, ['tools/video/render.cjs', tlFile, 'video', video, String(FPS)], { stdio: 'inherit', env });
  if (r.status !== 0) throw new Error('그림 실패 ' + ep);
  // 4) 목소리 한 줄로
  const inputs = TL.flatMap((s) => ['-i', s.wav]);
  const filt = TL.map((s, i) => `[${i}:a]aresample=48000,adelay=${Math.round(s.sayStart * 1000)}|${Math.round(s.sayStart * 1000)}[a${i}]`).join(';')
    + ';' + TL.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${TL.length}:normalize=0,apad=whole_dur=${total.toFixed(2)},volume=1.6[out]`;
  const voice = `${OUT}/usage${ep}_voice.wav`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt, '-map', '[out]', '-ac', '2', '-ar', '48000', voice]);
  // 5) 자막 파일(화면에는 이미 그려 넣음)
  writeFileSync(`${OUT}/${E.file}.srt`, TL.map((s, i) => `${i + 1}\n${ts(s.sayStart)} --> ${ts(s.sayStart + s.sayDur + 0.25)}\n${s.say}\n`).join('\n'), 'utf8');
  // 6) 합치기
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', voice, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', `${OUT}/${E.file}.mp4`]);
  console.log('완성:', `${OUT}/${E.file}.mp4`);
}
