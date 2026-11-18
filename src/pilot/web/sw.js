// 이어온 웹 알림 전용 서비스 워커(탭을 닫아도 "○○가 답했어요"). 화면을 저장해 두거나 요청을 가로채지 않는다(알림만).
// 이어온 화면을 보고 있으면(보이는 탭이 앞에 있으면) 띄우지 않는다 — 그 화면에 이미 보임.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || '이어온', {
      body: d.body || '새 소식이 있어요', tag: d.tag || undefined, icon: '/icon-192.png', badge: '/icon-192.png',
      data: { conversationId: d.conversationId || '' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data?.conversationId || '';
  const url = '/' + (id ? '#conv=' + encodeURIComponent(id) : '');
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).pathname === '/');
    if (w) { await w.focus(); w.postMessage({ ieon: 'open', conversationId: id }); return; }
    await self.clients.openWindow(url);
  })());
});
