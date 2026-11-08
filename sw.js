const CACHE='ciftelia-studio-v21-catalog-test-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v19/main.js','./js/v19/constants.js','./js/v19/audio-engine.js','./js/v19/pitch.js',
  './js/v19/microphone.js','./js/v19/mic-onset-worklet.js','./js/v19/songs.js',
  './js/v19/analysis.js','./js/v19/local-audio.js','./js/v19/grouping.js','./js/v19/timeline.js','./js/v19/manual.js','./js/v19/practice.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ciftelia-studio-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const req=event.request;const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(req).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{}));}
    return response;
  }).catch(async()=> (await caches.match(req)) || (req.mode==='navigate' ? (await caches.match('./index.html')) : Response.error())));
});
