/*
const CACHE_NAME = "gravitywars-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/client.js",
  "/alus.png",
  "/kenttä1.png",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
*/

// remove the service worker
self.addEventListener("install", function(event) {
    self.registration.unregister().then(() => {
        console.log("✅ Service Worker Unregistered!");
    });
});
