// Service worker: caches only the app shell (styles, scripts, default
// images and an offline card template). Never caches card data.
var CACHE = "shell-v3";
var SHELL = ["/card-offline", "/css/app.css?v=3", "/js/card.js?v=3"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Card pages: always network. Offline → the empty shell, filled from localStorage.
  if (req.mode === "navigate" && url.pathname.indexOf("/card/") === 0) {
    e.respondWith(fetch(req).catch(function () { return caches.match("/card-offline"); }));
    return;
  }
  // Static shell assets: cache, refreshed in the background.
  if (/^\/(css|js|img)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
          return hit || net;
        });
      })
    );
  }
});
