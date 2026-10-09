/* Gestión Avícola — Service Worker (caché de la app y librerías)
   - HTML: red primero (siempre la versión nueva); si no hay red, la última guardada.
   - Librerías/fuentes/íconos: se sirven de la caché al instante y se actualizan en segundo plano.
   - NUNCA toca /api/, Google Apps Script, ni peticiones que no sean GET (datos siempre frescos).
   - Conserva las notificaciones push si existe /firebase-messaging-sw.js. */
var GS_CACHE = 'gs-v1';
try { importScripts('/firebase-messaging-sw.js'); } catch (e) {}

var CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('gs-') === 0 && k !== GS_CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function guardar_(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    var copia = res.clone();
    caches.open(GS_CACHE).then(function (c) { return c.put(req, copia); }).catch(function () {});
  }
  return res;
}

function redPrimero_(req) {
  return new Promise(function (resolve) {
    var listo = false;
    var t = setTimeout(function () {                       // red muy lenta: usa lo guardado si existe
      caches.match(req, { ignoreSearch: true }).then(function (m) { if (m && !listo) { listo = true; resolve(m); } });
    }, 4000);
    fetch(req).then(function (res) {
      clearTimeout(t);
      if (!listo) { listo = true; resolve(guardar_(req, res)); } else guardar_(req, res);
    }).catch(function () {
      clearTimeout(t);
      if (listo) return;
      caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('/'); })
        .then(function (m) { listo = true; resolve(m || Response.error()); });
    });
  });
}

function rapidoYActualiza_(req) {
  return caches.match(req).then(function (m) {
    var red = fetch(req).then(function (res) { return guardar_(req, res); }).catch(function () { return m; });
    return m || red;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (x) { return; }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return;

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/sw.js' || url.pathname.indexOf('firebase-messaging-sw') !== -1) return;
    if (req.mode === 'navigate') { e.respondWith(redPrimero_(req)); return; }
    e.respondWith(rapidoYActualiza_(req));
    return;
  }
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) e.respondWith(rapidoYActualiza_(req));
});
