// Tilebloom offline service worker (replaces Godot's stock one after export).
//
// Godot's stock worker only precaches the small files and caches index.wasm / index.pck
// lazily, so the first visit (or the first visit after an update) left the 40 MB engine
// uncached and offline launches hung at ~4%. This worker:
//  - downloads EVERY file at install time (all-or-nothing; cache: 'reload' skips stale HTTP cache)
//  - activates immediately and serves everything cache-first
//  - keeps the previous version's cache until the new one is completely downloaded,
//    so there is always one complete offline copy
// 1794579140 and ["index.144x144.png","index.180x180.png","index.512x512.png","index.apple-touch-icon.png","index.audio.position.worklet.js","index.audio.worklet.js","index.html","index.icon.png","index.js","index.manifest.json","index.offline.html","index.pck","index.png","index.wasm"] are filled in by deploy_web.sh / tools/finish_web.sh.

const CACHE_PREFIX = 'tilebloom-';
const CACHE_NAME = CACHE_PREFIX + '1794579140';
const FILES = ["index.144x144.png","index.180x180.png","index.512x512.png","index.apple-touch-icon.png","index.audio.position.worklet.js","index.audio.worklet.js","index.html","index.icon.png","index.js","index.manifest.json","index.offline.html","index.pck","index.png","index.wasm"];
const INDEX = 'index.html';

self.addEventListener('install', (event) => {
	event.waitUntil((async () => {
		const cache = await caches.open(CACHE_NAME);
		await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
		await self.skipWaiting();
	})());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
		// also drop Godot's old stock-worker caches from earlier builds
		await Promise.all(keys.filter((k) => k.indexOf('-sw-cache-') !== -1).map((k) => caches.delete(k)));
		await self.clients.claim();
	})());
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	const scope = new URL(self.registration.scope);
	if (!url.pathname.startsWith(scope.pathname)) return;

	event.respondWith((async () => {
		const cache = await caches.open(CACHE_NAME);
		// Any page navigation inside the app (/, /index.html, ?query...) -> the cached game page.
		if (req.mode === 'navigate') {
			const page = await cache.match(INDEX);
			if (page) return page;
			try { return await fetch(req); } catch (e) { return new Response('Offline and not cached yet.', { status: 503 }); }
		}
		const cached = await cache.match(req, { ignoreSearch: true });
		if (cached) return cached;
		try {
			const resp = await fetch(req);
			if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
			return resp;
		} catch (e) {
			return new Response('', { status: 504 });
		}
	})());
});

// Godot's page script may post these; keep them harmless.
self.addEventListener('message', (event) => {
	if (event.data === 'claim' || event.data === 'update') {
		self.skipWaiting().then(() => self.clients.claim());
	}
});
