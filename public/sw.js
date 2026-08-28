// Mobile cache revision 1: force iPhone and Samsung to adopt this build.
const CACHE_NAME = "smart-personal-library-v0.10.3-3";
const APP_SHELL = ["./", "./manifest.webmanifest", "./favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Never intercept or cache Supabase/API responses. Library data must always
  // come from the authenticated network request, not an old browser snapshot.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("./", copy));
      return response;
    }).catch(() => caches.match("./")));
    return;
  }
  // Network-first prevents phones and installed PWAs from remaining on an old
  // JavaScript/CSS build after a deployment. The cache is only an offline fallback.
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (!response || (response.status !== 200 && response.type !== "opaque")) return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./"))));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() ?? "" }; }
  const title = payload.title || "المكتبة الشخصية الذكية";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "حان وقت العودة إلى كتابك.",
    icon: "./favicon.svg",
    badge: "./favicon.svg",
    tag: payload.tag || "spl-book-reminder",
    renotify: false,
    data: { url: payload.url || "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const current = clients.find((client) => client.url.startsWith(self.location.origin));
    if (current) return current.focus().then(() => current.navigate(target));
    return self.clients.openWindow(target);
  }));
});
