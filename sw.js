// PrimoBytes — Service Worker
const CACHE_NAME = 'primobytes-v1'
const ASSETS = [
  '/Family-NDT/',
  '/Family-NDT/index.html',
  '/Family-NDT/style.css',
  '/Family-NDT/manifest.json',
  '/Family-NDT/icons/icon-192.png',
  '/Family-NDT/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
]

// Instala e cacheia assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
})

// Ativa e remove caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Estratégia: Network first para Supabase, Cache first para assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Supabase sempre via rede (dados em tempo real)
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })))
    return
  }

  // Assets: cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(response => {
        // Cacheia apenas respostas válidas
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone))
        }
        return response
      }).catch(() => {
        // Offline fallback para navegação
        if (e.request.mode === 'navigate') {
          return caches.match('/Family-NDT/index.html')
        }
      })
    })
  )
})

// Mensagem para forçar atualização
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting()
})
