/* Villa Takrenovering – avvecklad service worker
 *
 * En tidigare version cachade appen och kunde fastna på en gammal, trasig
 * kopia. Den här filen finns kvar enbart för att städa upp efter sig: den
 * rensar all cache och avregistrerar sig själv hos webbläsare som redan
 * hunnit installera den gamla versionen.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
