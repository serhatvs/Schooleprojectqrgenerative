const CACHE_NAME = "attendance-scan-web-v5";
const APP_ASSETS = [
  "/scan-web",
  "/scan-web/",
  "/scan-web/scan-web.css",
  "/scan-web/scan-web.js",
  "/scan-web/manifest.webmanifest",
  "/scan-web/icons/icon-192.png",
  "/scan-web/icons/icon-512.png",
  "/scan-web/vendor/html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || !APP_ASSETS.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request);
    })
  );
});
