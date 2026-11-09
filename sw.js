// Tryb offline: zapamiętuje pliki aplikacji w telefonie.
// Z internetem pobiera najnowszą wersję, bez internetu używa zapamiętanej.

const CACHE_NAME = "wydatki-v11";
const NETWORK_TIMEOUT_MS = 3000;
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "i18n.js",
  "pots.js",
  "networth.js",
  "calculators.js",
  "app.js",
  "charts.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    // no-cache: bez tego telefon mógłby złożyć stronę ze starych i nowych plików po aktualizacji
    const response = await fetch(request, { signal: controller.signal, cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./");
    return Response.error();
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const sameOrigin = new URL(event.request.url).origin === self.location.origin;
  if (event.request.method === "GET" && sameOrigin) {
    event.respondWith(networkFirst(event.request));
  }
});
