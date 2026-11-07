const CACHE='ciftelia-studio-v13-group-speed-20261107';
const CORE=['./','./index.html','./app.css','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v13/main.js','./js/v13/constants.js','./js/v13/audio-engine.js','./js/v13/pitch.js',
  './js/v13/microphone.js','./js/v13/mic-onset-worklet.js','./js/v13/songs.js',
  './js/v13/analysis.js','./js/v13/local-audio.js','./js/v13/grouping.js'];
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
