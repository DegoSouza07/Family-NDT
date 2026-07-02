// PrimoBytes Service Worker v2
const CACHE = 'primobytes-v2'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Supabase e CDN — sempre rede
  const url = new URL(e.request.url)
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    e.respondWith(fetch(e.request))
    return
  }

  // Demais recursos — network first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request)
        .then(cached => cached || caches.match('/Family-NDT/index.html'))
      )
  )
})
