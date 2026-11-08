const CACHE='ciftelia-studio-v25-group-history-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v25/main.js','./js/v25/constants.js','./js/v25/audio-engine.js','./js/v25/pitch.js',
  './js/v25/microphone.js','./js/v25/mic-onset-worklet.js','./js/v25/songs.js',
  './js/v25/analysis.js','./js/v25/local-audio.js','./js/v25/grouping.js','./js/v25/timeline.js','./js/v25/manual.js','./js/v25/practice.js','./js/v25/song-editing.js','./js/v25/edit-history.js'];
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
