/* MyWeather service worker: lets the Home Screen app open with no network.
   Cache-first for the page itself (refreshed in the background). The app's live-version probe (?u=...) goes
   straight to the network, and an update load (?v=...) is fetched fresh and replaces the cached copy.
   Weather calls and everything else are untouched (the page keeps its own per-place cache in localStorage). */
const CACHE = 'myweather-page-v1';
const PAGE = new URL(new URL(self.location.href).searchParams.get('p') || './', self.location.href);
const pageKey = PAGE.origin + PAGE.pathname;
const isPage = (u) => { const b = u.origin + u.pathname; return b === pageKey || b === pageKey + 'index.html' || b + 'index.html' === pageKey || b === pageKey.replace(/\/index\.html$/, '/'); };

self.addEventListener('install', (e) => {
  e.waitUntil((async () => { try { const c = await caches.open(CACHE); const r = await fetch(pageKey, { cache: 'reload' }); if (r.ok) await c.put(pageKey, r.clone()); } catch (err) {} await self.skipWaiting(); })());
});
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (!isPage(u) || u.searchParams.has('u')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (u.searchParams.has('v')) {
      try { const r = await fetch(e.request, { cache: 'reload' }); if (r.ok) await c.put(pageKey, r.clone()); return r; }
      catch (err) { const hit = await c.match(pageKey); if (hit) return hit; throw err; }
    }
    const hit = await c.match(pageKey);
    // 'no-cache' revalidates with the server instead of trusting the browser's HTTP cache (GitHub Pages sends max-age=600),
    // so a new release reaches the saved copy on the next open instead of up to ten minutes later.
    const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r && r.ok) c.put(pageKey, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net; if (r) return r;
    return new Response('MyWeather is offline and not cached yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
