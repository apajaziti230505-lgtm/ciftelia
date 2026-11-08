const CACHE='ciftelia-studio-v27-short-groups-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v27/main.js','./js/v27/constants.js','./js/v27/audio-engine.js','./js/v27/pitch.js',
  './js/v27/microphone.js','./js/v27/mic-onset-worklet.js','./js/v27/songs.js',
  './js/v27/analysis.js','./js/v27/local-audio.js','./js/v27/grouping.js','./js/v27/timeline.js','./js/v27/manual.js','./js/v27/practice.js','./js/v27/song-editing.js','./js/v27/edit-history.js','./js/v27/song-import.js','./js/v27/group-length.js','./js/v27/note-selection.js'];
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
