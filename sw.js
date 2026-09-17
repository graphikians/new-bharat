// Minimal service worker — required for "Add to Home Screen" installability
// on Android/Chrome. Deliberately does no offline caching of AI reports
// (they need a live network call), just passes requests through.
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ self.clients.claim(); });
self.addEventListener('fetch', function(e){
  // Pass-through — no caching, since reports need live data.
  e.respondWith(fetch(e.request).catch(function(){ return new Response('Offline', { status: 503 }); }));
});
