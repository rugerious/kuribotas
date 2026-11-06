/* global self, caches, fetch, URL */
// Kuribotas' service worker. It makes the app installable and lets it open without network (the app
// shell comes from this cache; the chat then waits for the connection) and shows notifications.
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
// network. The chat itself (/ws), the account API (/api/: who you are must never come from a cache),
// the push key, the family's private sounds and the health check never touch it.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const live = ["/api/", "/push/", "/sounds/"].some((prefix) => url.pathname.startsWith(prefix));
  if (live || url.pathname === "/ws" || url.pathname === "/healthz") return;
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

// A notification from the server (a mention, a nudge, a chinela…): already encrypted end to end,
// the push service only carried it. Same tag = it replaces the previous one instead of piling up.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not ours: show the bare app name
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Kuribotas", {
      body: data.body || "",
      // a tag makes it replace the previous one (and still buzz); renotify without a tag is an error
      ...(data.tag ? { tag: data.tag, renotify: true } : {}),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
  );
});

// Tapping it opens the app (or brings it to the front if it's already open).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
