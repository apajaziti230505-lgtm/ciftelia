const CACHE='ciftelia-studio-v24-local-entry-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v24/main.js','./js/v24/constants.js','./js/v24/audio-engine.js','./js/v24/pitch.js',
  './js/v24/microphone.js','./js/v24/mic-onset-worklet.js','./js/v24/songs.js',
  './js/v24/analysis.js','./js/v24/local-audio.js','./js/v24/grouping.js','./js/v24/timeline.js','./js/v24/manual.js','./js/v24/practice.js','./js/v24/song-editing.js'];
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
