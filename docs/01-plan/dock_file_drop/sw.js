self.addEventListener('fetch', (event) => {
    // Just a pass-through to satisfy PWA requirements
    event.respondWith(fetch(event.request));
});