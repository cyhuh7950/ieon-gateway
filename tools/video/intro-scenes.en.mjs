// 소개 영상 장면 목록 — 영어(intro-scenes.mjs와 같은 장면·같은 순서). min: 계획 길이(초) — 목소리가 더 길면 늘어난다.
export const SCENES = [
  { id: '1-1', min: 6, say: 'Inside your PC, AI is at work.' },
  { id: '1-2', min: 6, say: 'But people are outside the PC, in front of their messengers.' },
  { id: '1-3', min: 5, say: 'There is no connection between the two.' },
  { id: '2-1', min: 6, say: 'Ieon is what connects them.' },
  { id: '2-2', min: 9, say: 'On one side are the messengers you always use: KakaoTalk, Telegram, Discord, Slack, LINE, plus the Ieon App and the web.' },
  { id: '2-3', min: 8, say: 'On the other side are AI work sessions: Codex, Claude Code, Antigravity, and Grok.' },
  { id: '2-4', min: 11, say: 'What you send from Telegram does not start a new chat. It continues the very session you were working in, and the answer comes back to Telegram.' },
  { id: '2-5', min: 7, say: 'Ask from a messenger, the app, or the web, and the same conversation continues.' },
  { id: '2-6', min: 5, say: 'Between messengers and LLM sessions, Ieon sits right in the middle.' },
  { id: '3-1', min: 5, say: 'How you grow a session is up to you.' },
  { id: '3-2', min: 10, say: 'Teach it laws and court cases, connect an expert MCP like law search, and that session becomes a LawBot.' },
  { id: '3-3', min: 6, say: 'In the same way, it can become a TaxBot or an InsuranceBot.' },
  { id: '3-4', min: 12, say: 'Whatever expert bot a session becomes, Ieon connects it straight to messengers. People ask the bot they need, right in the messenger they already use.' },
  { id: '3-5', min: 10, say: 'You can gather several expert bots in one room, ask them together, and hand one bot\'s answer to another.' },
  { id: '3-6', min: 9, say: 'Add bots, add messengers, add PCs, and Ieon in the middle connects them all. With a hub, it works the same from outside.' },
  { id: '4-1', min: 10, say: 'The connection must be safe. It sends only to sessions you choose, never while one is in use, runs things only when a person allows it, and keeps records only on your server.' },
  { id: '4-2', min: 7, say: 'Install it, pick a session, and connect a messenger. That is all.' },
  { id: '4-3', min: 5, say: 'Ieon. Connecting messengers and AI.' },
  { id: '4-4', min: 6, say: 'Next time, we will show how to grow your session into an expert bot.' },
];
export { FPS, LEAD, TAIL } from './intro-scenes.mjs';
