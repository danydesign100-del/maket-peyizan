// Service worker template. The build (vite.config.ts) fills in the version and
// the list of files to precache, then writes it to dist/sw.js. Data requests (Supabase, local API)
// are never cached here: the app's offline layer in src/lib/offline owns them.
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL = `mp-shell-${VERSION}`
const IMAGES = 'mp-images-v1'

// Installing downloads the whole application, so it opens offline right away,
// including screens that have not been visited yet.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('mp-shell-') && key !== SHELL).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()))
})

// The page asks the waiting version to take over when the user accepts the update.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

const putIn = (name, request, response) => {
  if (response.ok) { const copy = response.clone(); caches.open(name).then((cache) => cache.put(request, copy)) }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Pages: network first so a reachable server always serves the latest
  // index.html, then the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => putIn(SHELL, '/', response)).catch(() => caches.match('/', { ignoreSearch: true })))
    return
  }

  // Built assets have hashed names and never change: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => putIn(SHELL, request, response))))
    return
  }

  // Public product images from Supabase Storage.
  if (url.pathname.includes('/storage/v1/object/public/')) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => putIn(IMAGES, request, response))))
  }
})
