// English usage videos (01–06) — same scenes, shots, highlight boxes and timing rules as usage-scenes.mjs; only the spoken lines,
// titles and drawn chat messages are English (2026-11-25 신산님 "사용법 영상 영어판을 만들어 줘"). Shots come from .local/video/en/usage-shots/
// (capture-usage.mjs with VIDEO_LANG=en), bot messages match locales/en/messenger.json. Highlight boxes that moved because English text is longer: 02-6, 03-2, 05-6.
export const EPISODES = {
  '01': { file: 'Ieon_usage_01_ask_on_the_web', title: 'Asking on the web', scenes: [
    { id: '1', min: 4, type: 'title', say: 'Here is how to ask a question on the web screen.' },
    { id: '2', min: 8, type: 'web', shots: [['w01_list', 0]], hl: [10, 325, 352, 430], say: 'On the left is the list of work sessions to continue — your AI staff. The mark on the right shows the current status.' },
    { id: '3', min: 5, type: 'web', shots: [['w01_chat', 0]], hl: [10, 325, 352, 90], say: 'Pick one to see the messages exchanged with that session.' },
    { id: '4', min: 5, type: 'web', shots: [['w01_typing', 0]], hl: [395, 1108, 1508, 74], zoom: [1150, 1000, 1.25], say: 'Type your question in the box at the bottom and press Send.' },
    { id: '5', min: 8, type: 'web', shots: [['w01_queued', 0], ['w01_answer', 0.62]], zoom: [900, 520, 1.15], say: 'It goes from received to running, and the answer appears here as soon as the work session on your PC replies.' },
    { id: '6', min: 6, type: 'web', shots: [['w01_card', 0]], hl: [397, 95, 1499, 144], say: 'If it can\'t be sent right now, a card explains why first.' },
    { id: '7', min: 6, type: 'web', shots: [['w01_panel', 0]], hl: [1505, 75, 405, 275], zoom: [1500, 400, 1.3], say: 'Connection settings show the engine, its status, and how the session is continued.' },
    { id: '8', min: 5, type: 'end', next: '02 AI staff and rooms', say: 'In the next video, we\'ll look at AI staff and rooms.' },
  ] },
  '02': { file: 'Ieon_usage_02_ai_staff_and_rooms', title: 'AI staff and rooms', scenes: [
    { id: '1', min: 4, type: 'title', say: 'Here is how to use AI staff and rooms.' },
    { id: '2', min: 8, type: 'web', shots: [['w02_staff', 0]], hl: [1508, 535, 395, 275], zoom: [1500, 620, 1.35], say: 'In the AI staff section of connection settings, set a name and an icon. In rooms, you call staff by this name.' },
    { id: '3', min: 9, type: 'web', shots: [['w02_room_dlg', 0]], zoom: [965, 600, 1.3], say: 'Press new room, then choose a name, members and a lead. The lead answers when nobody is called.' },
    { id: '4', min: 6, type: 'web', shots: [['w02_mention', 0]], hl: [395, 1108, 1508, 74], zoom: [1150, 1000, 1.25], say: 'Call someone with at-name, and the question goes only to that staff member.' },
    { id: '5', min: 5, type: 'web', shots: [['w02_answers', 0]], zoom: [1000, 450, 1.15], say: 'Each staff member\'s answer appears under their name.' },
    { id: '6', min: 9, type: 'web', shots: [['w02_answers', 0], ['w02_handoff', 0.35]], hl: [1365, 655, 535, 60], hlAt: 0.4, say: 'You can hand a finished answer to another staff member to carry on. A hand-off only happens when you press it.' },
    { id: '7', min: 5, type: 'end', next: '03 Approval cards', say: 'In the next video, we\'ll look at approval cards.' },
  ] },
  '03': { file: 'Ieon_usage_03_approval_cards', title: 'Approval cards — handing off work', scenes: [
    { id: '1', min: 4, type: 'title', say: 'Here is how to hand real work to the AI.' },
    { id: '2', min: 10, type: 'web', shots: [['w03_workmode', 0]], hl: [1510, 430, 380, 80], zoom: [1500, 420, 1.35], say: 'Turn on work mode in connection settings, and the AI in that conversation can edit files and run commands. It is off by default.' },
    { id: '3', min: 3, type: 'web', shots: [['w03_ask', 0]], hl: [395, 1108, 1508, 74], zoom: [1150, 1000, 1.2], say: 'When you ask for a task,' },
    { id: '4', min: 6, type: 'web', shots: [['w03_card', 0]], hl: [397, 95, 1499, 144], zoom: [1000, 300, 1.2], say: 'an approval card shows what it wants to do before it runs.' },
    { id: '5', min: 9, type: 'web', shots: [['w03_card', 0], ['w03_answer', 0.3]], zoom: [1000, 500, 1.1], say: 'Press Allow, and it runs just that once and reports the result. If you don\'t decide within fifteen minutes, it is denied.' },
    { id: '6', min: 5, type: 'end', next: '04 Connecting the phone app', say: 'In the next video, we\'ll connect the phone app.' },
  ] },
  '04': { file: 'Ieon_usage_04_connect_the_phone_app', title: 'Connecting the phone app', scenes: [
    { id: '1', min: 4, type: 'title', say: 'Here is how to connect the Ieon app on your phone.' },
    { id: '2', min: 10, type: 'web', shots: [['w04_settings', 0], ['w04_code', 0.45]], hl: [360, 740, 1182, 206], hlAt: 0.5, zoom: [950, 800, 1.2], say: 'In the web screen, open Settings, then Apps and devices, and press Create connection code. A server address and an eight-digit code appear.' },
    { id: '3', min: 9, type: 'phone', shots: [['p04_pair', 0]], hl: [50, 1180, 1070, 480], say: 'Enter the server address and the code in the phone app and press Connect. The code works once, for ten minutes.' },
    { id: '4', min: 5, type: 'phone', shots: [['p04_list', 0]], hl: [20, 250, 1130, 1550], say: 'You see the same AI staff and rooms as on the web.' },
    { id: '5', min: 6, type: 'phone', shots: [['p04_wait', 0], ['p04_answer', 0.5]], say: 'Send a question, and the answer appears as soon as it arrives.' },
    { id: '6', min: 7, type: 'phone', shots: [['p04_card', 0], ['p04_allowed', 0.7]], hl: [30, 1300, 1110, 610], hlEnd: 0.7, say: 'You can allow or deny approval cards right on your phone, too.' },
    { id: '7', min: 5, type: 'end', next: '05 Voice, alerts, deleting', say: 'In the next video, we\'ll look at voice and alerts.' },
  ] },
  '05': { file: 'Ieon_usage_05_voice_alerts_deleting', title: 'Voice, alerts, deleting', scenes: [
    { id: '1', min: 4, type: 'title', say: 'Here is how voice, alerts and deleting work.' },
    { id: '2', min: 7, type: 'phone', shots: [['p05_notice', 0]], hl: [45, 830, 1080, 860], say: 'The first time you use voice, a notice explains once that your voice may go through the device maker\'s servers.' },
    { id: '3', min: 9, type: 'dictate', shots: [['p05_chat', 0], ['p05_dictated', 0.62]], text: 'Summarize the payment module test results briefly', hl: [100, 2330, 780, 170], hlAt: 0.64, say: 'Press the microphone and speak, and your words go into the input box as text. Edit it, then send.' },
    { id: '4', min: 5, type: 'phone', shots: [['p05_speaker', 0]], hl: [840, 40, 130, 120], say: 'Turn on the speaker, and new answers are read aloud.' },
    { id: '5', min: 10, type: 'toast', shots: [['p05_pc', 0]], toast: ['Ieon', 'Codex replied'], say: 'Minimize the PC app, and an alert appears when an answer arrives. The alert only says who replied, not what.' },
    { id: '6', min: 9, type: 'phone', shots: [['p05_edit', 0], ['p05_list', 0.5]], hl: [140, 745, 890, 85], hlEnd: 0.5, hl2: [700, 2410, 430, 100], say: 'You can also delete a conversation\'s server records and disconnect this device right in the app.' },
    { id: '7', min: 5, type: 'end', next: '06 Giving work by messenger', say: 'In the next video, we\'ll give the AI work through a messenger.' },
  ] },
  '06': { file: 'Ieon_usage_06_give_work_by_messenger', title: 'Giving work by messenger', scenes: [
    { id: '1', min: 5, type: 'title', say: 'Here is how to give the AI on your PC work from a phone messenger. We\'ll use Telegram as the example.' },
    { id: '2', min: 9, type: 'chat', peer: 'BotFather', msgs: [['me', '/newbot', 0.05], ['bot', 'Alright, a new bot. How are we going to call it?', 0.15], ['me', 'Ieon assistant', 0.27], ['bot', 'Good. Now let\'s choose a username for your bot.', 0.37], ['me', 'my_ieon_bot', 0.48], ['bot', 'Done! Use this token to access the HTTP API:\n7712345678:AAH••••••••••••••••', 0.6]], hlMsg: 5, say: 'First, open BotFather in Telegram and send new bot. Choose the bot\'s name twice, and you get a bot token.' },
    { id: '3', min: 12, type: 'web', shots: [['m06_btn', 0], ['m06_plats', 0.25], ['m06_token', 0.55]], hl: [12, 1038, 340, 46], hlEnd: 0.25, zoom: [960, 580, 1.2], say: 'In the Ieon web screen, press Messenger at the bottom left, choose Telegram, paste the token, and press Connect.' },
    { id: '4', min: 6, type: 'web', shots: [['m06_code', 0]], zoom: [960, 600, 1.3], say: 'Once the bot is connected, a six-digit number appears.' },
    { id: '5', min: 10, type: 'chat', peer: 'Ieon assistant', msgs: [['me', '482913', 0.1], ['bot', 'You\'re registered as the owner. Ask a question and it will continue from there. You can choose a conversation with /sessions.', 0.3]], webAfter: ['m06_done', 0.62], say: 'Send that number to the bot in Telegram, and the sender is registered as the bot\'s owner. The bot doesn\'t answer people the owner hasn\'t allowed.' },
    { id: '6', min: 10, type: 'chat', peer: 'Ieon assistant', msgs: [['me', '/sessions', 0.05], ['bot', '1. Payment module work — Codex(fast replies) · ready to send · work mode\n2. Legal advice — Claude · ready to send\n3. Tax advice — Codex(fast replies) · ready to send\n4. Insurance advice — Codex(fast replies) · ready to send', 0.18], ['me', '/use 1', 0.55], ['bot', 'Connected this chat to "Payment module work".', 0.66]], say: 'Use the sessions command to see the work sessions on your PC, then send use and a number to connect this chat to that session.' },
    { id: '7', min: 10, type: 'chat', peer: 'Ieon assistant', msgs: [['me', 'Run the refund tests and tell me the result', 0.05], ['bot', '[Payment module work] Received — waiting for the answer', 0.18], ['bot', '[Payment module work] Approval request 1: Run command — npm test -- refund (work folder D:\\work\\payment)\nAllow: /allow 1   Deny: /deny 1   (within 15 min, this time only)', 0.4]], hlMsg: 2, say: 'Now give it work as usual, and that session on your PC carries on. Before running a command or editing a file, it asks for approval in the messenger.' },
    { id: '8', min: 10, type: 'chat', peer: 'Ieon assistant', msgs: [['me', 'Run the refund tests and tell me the result', 0], ['bot', '[Payment module work] Received — waiting for the answer', 0], ['bot', '[Payment module work] Approval request 1: Run command — npm test -- refund (work folder D:\\work\\payment)\nAllow: /allow 1   Deny: /deny 1   (within 15 min, this time only)', 0], ['me', '/allow 1', 0.08], ['bot', 'Approval request 1: Allowed (this time only)', 0.18], ['bot', '[Payment module work] Approval request 1: Run completed', 0.4], ['bot', 'I ran the tests. All 12 passed, including the 2 refund tests.', 0.55]], hlMsg: 6, say: 'Send allow and the number, and it runs just that once, then sends the result and the AI\'s answer back to the messenger. You can hand off work from your phone, even when you\'re out.' },
    { id: '9', min: 7, type: 'end', last: true, say: 'Discord, Slack, LINE and KakaoTalk follow the same steps. For details, see the messenger setup guide.' },
  ] },
};
export const FPS = 25;
export const LEAD = 0.35;
export const TAIL = 0.6;
