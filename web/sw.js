'use strict';
var CACHE = 'catch-it-shell-v1';
var ASSETS = ['./', './index.html', './manifest.json', './css/base.css', './css/themes.css', './css/layouts.css', './js/config_fallback.js', './js/store.js', './js/theme_switcher.js', './js/renderer.js', './js/controls.js', './js/app.js'];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (key) { return key.indexOf('catch-it-shell-') === 0 && key !== CACHE; }).map(function (key) { return caches.delete(key); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/config/') !== -1) return;
  event.respondWith(caches.match(event.request).then(function (cached) { return cached || fetch(event.request); }));
});
