const CACHE='ciftelia-studio-v26-mp3-link-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v26/main.js','./js/v26/constants.js','./js/v26/audio-engine.js','./js/v26/pitch.js',
  './js/v26/microphone.js','./js/v26/mic-onset-worklet.js','./js/v26/songs.js',
  './js/v26/analysis.js','./js/v26/local-audio.js','./js/v26/grouping.js','./js/v26/timeline.js','./js/v26/manual.js','./js/v26/practice.js','./js/v26/song-editing.js','./js/v26/edit-history.js','./js/v26/song-import.js'];
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
