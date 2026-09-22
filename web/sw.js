/* Service worker: the shell is cached so the app opens offline, the forecast is
   fetched from the network first so a fresh run always wins, and the last good
   forecast stays in the cache as the offline fallback. */
"use strict";

const CACHE = "mys-aladin-v39";
const FORECAST = "data/forecast.json";

/* Tiles of the area pack live in their own cache, so that a few places looked
   up on the road cannot push the shell of the app out of storage. Only the
   last few are kept; the rest is a fetch away. */
const TILES = "mys-aladin-tiles-v1";
const AREA = "data/area/";
const TILE_LIMIT = 12;

const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "area.js",
  "places.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  // Fetch past the browser cache. Pages serves the shell with a ten minute
  // lifetime, so a plain addAll can fill a brand new cache with the very files
  // the new version is meant to replace.
  const fresh = SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(fresh)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE && name !== TILES)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(FORECAST, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(FORECAST);
    if (!cached) throw error;
    // The page cannot otherwise tell a cached fallback from a fresh fetch, and
    // it has to, so that it can mark the forecast as possibly stale.
    const headers = new Headers(cached.headers);
    headers.set("X-From-Cache", "1");
    return new Response(await cached.blob(), { status: 200, statusText: "OK", headers });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === "GET") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/* A tile belongs to one model run, so the network decides and the cache is
   only the answer when there is none. */
async function tileFirst(request) {
  const cache = await caches.open(TILES);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (!cached) throw error;
    return cached;
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  // Oldest first: keys() returns them in insertion order.
  for (const key of keys.slice(0, Math.max(0, keys.length - TILE_LIMIT))) {
    await cache.delete(key);
  }
}

/* The page shows which cache is serving it, so a version that refuses to go
   away can be recognised rather than guessed at. */
self.addEventListener("message", (event) => {
  if (event.data !== "version" || !event.ports.length) return;
  event.ports[0].postMessage({ cache: CACHE, tiles: TILES });
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(FORECAST)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.includes(AREA)) {
    event.respondWith(tileFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
