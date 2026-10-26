// Offline cache for the player: keeps the player page and the media of the current
// playlist on the device so playback survives server or network outages.
const PAGE_CACHE = 'signboard-page-v1';
const MEDIA_CACHE = 'signboard-media-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGE_CACHE).then((c) => c.add('/player')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname === '/player') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put('/player', copy));
          return res;
        })
        .catch(() => caches.match('/player'))
    );
  } else if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(fromMediaCache(e.request, url.pathname));
  }
});

async function fromMediaCache(request, path) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(path);
  if (!cached) {
    // Cache the whole file in the background; serve this request from the network
    cache.add(path).catch(() => {});
    return fetch(request);
  }
  const range = request.headers.get('range');
  if (!range) return cached;
  // Videos ask for byte ranges; answer them from the cached full file
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m && m[1] ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// The player sends the media URLs of its current playlist: download any that are
// missing and drop files that are no longer used, so the cache doesn't grow forever.
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'sync') return;
  const wanted = new Set(e.data.urls.filter((u) => u.startsWith('/uploads/')));
  e.waitUntil(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      for (const req of await cache.keys()) {
        if (!wanted.has(new URL(req.url).pathname)) await cache.delete(req);
      }
      for (const u of wanted) {
        if (!(await cache.match(u))) await cache.add(u).catch(() => {});
      }
    })
  );
});
