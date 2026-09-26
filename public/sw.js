// App shell only: private audio lives in account-isolated IndexedDB.
importScripts('./offline-assets.js');
const CACHE_NAME = 'spl-shell-offline-' + self.SPL_REV;
const ROOT = new URL('./', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([ROOT, new URL('./manifest.webmanifest',ROOT).href, new URL('./favicon.svg',ROOT).href, ...self.SPL_ASSETS.map(path=>new URL(path,ROOT).href)])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key => (key.startsWith('spl-shell-offline-') || key.startsWith('smart-personal-library-')) && key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE_NAME).then(cache=>cache.match(ROOT))));return;
  }
  if(!self.SPL_ASSETS.some(path=>new URL(path,ROOT).href===url.href))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(event.request)) || fetch(event.request)));
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
