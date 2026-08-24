/**
 * service-worker.js — Cache del shell instalable (solo index.html + manifest
 * + íconos) para que la PWA abra instantáneo. El contenido real de la app
 * (dashboard, movimientos, saldos) vive dentro de un <iframe> que apunta al
 * Web App de Apps Script (script.google.com) — eso NUNCA se cachea aquí,
 * siempre va directo a red, para no mostrar datos financieros desactualizados.
 */
const CACHE_NAME = 'finanzas-ai-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Nunca cachear llamadas al backend (POST a script.google.com).
  if (req.method !== 'GET' || req.url.includes('script.google.com')) {
    return; // deja pasar directo a la red
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // sin red: usar lo cacheado

      return cached || network;
    })
  );
});
