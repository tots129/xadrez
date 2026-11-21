// Service worker: deixa o site instalável como app e funcionando sem internet
// (contra o bot, local, problemas e aulas). Sempre tenta a versão nova primeiro;
// só usa a cópia guardada quando está sem internet.
const CACHE = 'xadrez-v1';
const ARQUIVOS = ['/', '/style.css', '/app.js', '/problemas.js', '/aulas.js', '/manifest.json', '/icone-192.png', '/icone-512.png',
  'https://cdn.jsdelivr.net/npm/chess.js@1/+esm'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Não mexe no jogo online, na API, nem em nada que não seja GET
  if (req.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  const guardavel = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com';
  if (!guardavel) return;
  // Internet primeiro; se falhar, usa a cópia guardada
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});
