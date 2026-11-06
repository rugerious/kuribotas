/* global self, caches, fetch, URL */
// Kuribotas' service worker. It makes the app installable and lets it open without network (the app
// shell comes from this cache; the chat then waits for the connection). Phase 3.3 adds notifications.
// Plain JavaScript on purpose: it runs in its own worker, outside the bundle.

const CACHE = "kuribotas-shell-v1";
const SHELL = ["/", "/style.css", "/main.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so a new version shows up straight away; the cache only answers when there is no
// network. The chat itself (/ws), the family's private sounds and the health check never touch it.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/ws" || url.pathname === "/healthz" || url.pathname.startsWith("/sounds/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
  );
});
