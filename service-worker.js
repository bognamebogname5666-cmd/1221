/**
 * NEXUS BLOCKS — Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Vanilla implementation — zero Workbox dependency.
 *
 * Strategies:
 *   • Shell assets    → Cache-First  (instant load, update in background)
 *   • Fonts           → Cache-First  (stale-while-revalidate after first fetch)
 *   • API / scores    → Network-First (always fresh, cached fallback)
 *   • Everything else → Stale-While-Revalidate
 *
 * Features:
 *   • Cache versioning with automatic cleanup on activation
 *   • Background Sync for offline score submission (sync-scores tag)
 *   • Web Push notifications for score milestone alerts
 *   • Offline fallback page
 *   • Install / activate / fetch / sync / push event handlers
 */

'use strict';

// ── Cache names ────────────────────────────────────────────────────────────────
const CACHE_VER    = 'v2.0.0';
const CACHE_SHELL  = `nexus-shell-${CACHE_VER}`;
const CACHE_FONTS  = `nexus-fonts-${CACHE_VER}`;
const CACHE_ASSETS = `nexus-assets-${CACHE_VER}`;
const CACHE_API    = `nexus-api-${CACHE_VER}`;

/** All caches owned by this version — used during cleanup */
const OWNED_CACHES = new Set([CACHE_SHELL, CACHE_FONTS, CACHE_ASSETS, CACHE_API]);

// ── Static pre-cache manifest ──────────────────────────────────────────────────
// Everything the game needs to run completely offline.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles.css',
  '/nexus_visuals.css',
  '/game.css',
  '/manifest.webmanifest',
  // Game core (self-contained)
  '/blockblast.js',
  '/install-prompt.js',
];

const ICON_URLS = [
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
];

// ── URL matchers ───────────────────────────────────────────────────────────────
const API_ORIGIN   = 'https://api.nexus-blocks.app';
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

const isApiRequest  = (url) => url.startsWith(API_ORIGIN) || url.includes('/api/');
const isFontRequest = (url) => FONT_ORIGINS.some(o => url.startsWith(o));
const isIconRequest = (url) => url.includes('/icons/');
const isHtmlNav     = (req) => req.mode === 'navigate';

// ── IndexedDB helpers for background-sync queue ────────────────────────────────
const IDB_NAME    = 'nexus-sync-store';
const IDB_VERSION = 1;
const IDB_STORE   = 'pending-scores';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getPendingScores() {
  const db    = await openIDB();
  const tx    = db.transaction(IDB_STORE, 'readonly');
  const store = tx.objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function deletePendingScore(id) {
  const db    = await openIDB();
  const tx    = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Install ────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing NEXUS BLOCKS service worker…');

  event.waitUntil(
    (async () => {
      // Pre-cache shell assets — don't fail install if one icon is missing
      const shellCache = await caches.open(CACHE_SHELL);
      await shellCache.addAll(SHELL_URLS).catch((err) => {
        console.warn('[SW] Shell pre-cache partial failure (non-fatal):', err.message);
      });

      // Pre-cache icons separately so a missing icon doesn't block shell
      const assetCache = await caches.open(CACHE_ASSETS);
      await Promise.allSettled(
        ICON_URLS.map(url => assetCache.add(url).catch(() => { /* ignore missing icons */ }))
      );

      // Skip waiting so the new SW takes control immediately
      await self.skipWaiting();
      console.log('[SW] Installed and skipped waiting.');
    })()
  );
});

// ── Activate ───────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating and cleaning up old caches…');

  event.waitUntil(
    (async () => {
      // Remove any cache not belonging to this version
      const allCacheNames = await caches.keys();
      await Promise.all(
        allCacheNames
          .filter(name => name.startsWith('nexus-') && !OWNED_CACHES.has(name))
          .map(name => {
            console.log('[SW] Deleting stale cache:', name);
            return caches.delete(name);
          })
      );

      // Take control of all clients immediately
      await self.clients.claim();
      console.log('[SW] Activated. Controlling all clients.');

      // Notify clients that a new SW has activated
      const clientList = await self.clients.matchAll({ includeUncontrolled: true });
      clientList.forEach(client => client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VER }));
    })()
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Skip non-GET requests (POST, etc.) — let them pass through
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) schemes
  if (!url.startsWith('http')) return;

  // ── HTML navigation → Network-First with offline fallback ─────────────────
  if (isHtmlNav(request)) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // ── API requests → Network-First ──────────────────────────────────────────
  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request, CACHE_API));
    return;
  }

  // ── Font requests → Cache-First (fonts rarely change) ─────────────────────
  if (isFontRequest(url)) {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // ── Icons / images → Cache-First ──────────────────────────────────────────
  if (isIconRequest(url)) {
    event.respondWith(cacheFirst(request, CACHE_ASSETS));
    return;
  }

  // ── Everything else (JS, CSS) → Shell cache-first, then stale-while-reval ──
  event.respondWith(shellCacheFirst(request));
});

// ── Caching Strategies ─────────────────────────────────────────────────────────

/**
 * Cache-First: return from cache; if miss, fetch → cache → return.
 * Best for versioned/immutable assets.
 */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response('Asset not available offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Shell Cache-First: check CACHE_SHELL first, then CACHE_ASSETS, then network.
 * Falls back to stale-while-revalidate for dynamic assets.
 */
async function shellCacheFirst(request) {
  const shellCache  = await caches.open(CACHE_SHELL);
  const assetCache  = await caches.open(CACHE_ASSETS);
  const shellMatch  = await shellCache.match(request);
  if (shellMatch) {
    // Background revalidation for long-lived assets
    revalidateInBackground(request, shellCache);
    return shellMatch;
  }

  const assetMatch = await assetCache.match(request);
  if (assetMatch) return assetMatch;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) assetCache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response('Resource not available offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Network-First: try network; on failure return from cache.
 * Best for API calls where fresh data matters.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetchWithTimeout(request, 4000);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', scores: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Network-First for HTML navigation with custom offline page fallback.
 */
async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const fresh = await fetchWithTimeout(request, 5000);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    // Try exact match first, then the root /index.html
    const cached = await cache.match(request)
                || await cache.match('/index.html')
                || await cache.match('/');
    if (cached) return cached;

    // Last resort: offline.html
    const offline = await cache.match('/offline.html');
    return offline || new Response('<h1>Offline</h1>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Wraps fetch with an AbortController timeout. */
function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(id));
}

/** Re-fetch and update cache entry in the background (fire-and-forget). */
function revalidateInBackground(request, cache) {
  fetch(request)
    .then(res => { if (res.ok) cache.put(request, res); })
    .catch(() => { /* silent — offline or error */ });
}

// ── Background Sync — offline score submission ─────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-scores') {
    console.log('[SW] Background sync: submitting pending scores…');
    event.waitUntil(flushPendingScores());
  }
});

async function flushPendingScores() {
  let scores;
  try {
    scores = await getPendingScores();
  } catch (err) {
    console.warn('[SW] Could not read pending scores from IDB:', err);
    return;
  }

  for (const entry of scores) {
    try {
      const res = await fetch(`${API_ORIGIN}/scores`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(entry.payload),
      });

      if (res.ok) {
        await deletePendingScore(entry.id);
        console.log('[SW] Synced score id:', entry.id);
      } else {
        console.warn('[SW] Score submission returned', res.status, '— will retry.');
      }
    } catch (err) {
      console.warn('[SW] Score submission failed (will retry on next sync):', err.message);
      // Don't delete — Background Sync will retry automatically
      throw err; // Re-throw so the browser knows sync failed and will retry
    }
  }
}

// ── Push Notifications ─────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'NEXUS BLOCKS', body: event.data.text() };
  }

  const { title = 'NEXUS BLOCKS', body = '', icon, badge, tag, data = {} } = payload;

  const options = {
    body,
    icon:              icon  || '/icons/icon-192.png',
    badge:             badge || '/icons/icon-96.png',
    tag:               tag   || 'nexus-notification',
    data,
    requireInteraction: data.requireInteraction ?? false,
    silent:            data.silent ?? false,
    vibrate:           [100, 50, 100],
    actions: data.actions ?? [
      { action: 'open',    title: '🎮 Play Now' },
      { action: 'dismiss', title: '✕ Dismiss'  },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click ─────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const { url = '/', mode } = event.notification.data ?? {};

  if (action === 'dismiss') return;

  const targetUrl = mode ? `/?mode=${mode}&source=push` : url;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Re-focus existing window if already open
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          client.postMessage({ type: 'PUSH_NAVIGATE', url: targetUrl });
          return;
        }
      }

      // Open new window
      await self.clients.openWindow(targetUrl);
    })()
  );
});

// ── Message handling from client ───────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'QUEUE_SCORE':
      // Store score for background-sync submission
      queueScoreForSync(payload).then(() => {
        event.source?.postMessage({ type: 'SCORE_QUEUED', id: payload?.id });
      });
      break;

    case 'CACHE_URLS':
      // Pre-cache additional URLs (e.g. after a game mode is unlocked)
      if (Array.isArray(payload?.urls)) {
        caches.open(CACHE_ASSETS).then(cache => cache.addAll(payload.urls).catch(() => {}));
      }
      break;

    case 'GET_CACHE_VERSION':
      event.source?.postMessage({ type: 'CACHE_VERSION', version: CACHE_VER });
      break;
  }
});

async function queueScoreForSync(payload) {
  try {
    const db    = await openIDB();
    const tx    = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    await new Promise((res, rej) => {
      const req = store.add({ payload, queuedAt: Date.now() });
      req.onsuccess = res;
      req.onerror   = () => rej(req.error);
    });
    // Register a sync — fires immediately if online, defers if offline
    await self.registration.sync?.register('sync-scores').catch(() => {});
  } catch (err) {
    console.warn('[SW] Failed to queue score:', err);
  }
}

// ── Periodic Background Sync (optional — refresh leaderboard cache) ───────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-leaderboard') {
    event.waitUntil(refreshLeaderboardCache());
  }
});

async function refreshLeaderboardCache() {
  try {
    const res = await fetch(`${API_ORIGIN}/leaderboard/top10`);
    if (res.ok) {
      const cache = await caches.open(CACHE_API);
      cache.put(`${API_ORIGIN}/leaderboard/top10`, res);
    }
  } catch { /* offline — skip */ }
}
