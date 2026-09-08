// wigwag service worker -- exists for one thing: it's a prerequisite for
// Web Push (iOS/most browsers refuse PushManager.subscribe without one
// registered). Deliberately minimal otherwise -- no offline caching, no
// asset precaching. That's out of scope for the push-notification work
// this shipped alongside (tracker issue #72, 67fa1ba2); add it later as a
// separate, independently-testable change if wanted, rather than folding
// it in here silently.
//
// Registered by wigwag.html's componentDidMount, only when the page isn't
// open as a file: -- service workers can't register there at all.
//
// Deliberately NO 'fetch' event listener: once a service worker controls
// a page (clients.claim(), below), a 'fetch' handler intercepts EVERY
// request that page makes -- including the app's own GitHub/Jira/
// Salesforce API calls -- and routes them through the service worker's
// own fetch, bypassing Playwright's page.route() mocks entirely (real
// regression, caught by the full suite: every proxy/GitHub-token test
// failed with this listener in place, even a pure passthrough
// `respondWith(fetch(event.request))`). No caching need justifies that
// cost right now, so there's nothing to intercept requests for at all.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// push-relay.js (repo root) sends a JSON payload shaped like
// { title, body, tag, url } -- see that file's own header comment for the
// full picture of what runs on the other end of this. `tag` mirrors the
// in-tab Notification path's own collapsing behavior (see
// checkForNewMentions in wigwag.html): repeat pushes for the same mention
// replace the existing notification instead of stacking a duplicate.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'wigwag';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag ? ('wigwag-mention-' + data.tag) : undefined,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) { await client.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
