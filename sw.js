const CACHE='ciftelia-studio-v28-mp3-default-20261108';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/v28/main.js','./js/v28/constants.js','./js/v28/audio-engine.js','./js/v28/pitch.js',
  './js/v28/microphone.js','./js/v28/mic-onset-worklet.js','./js/v28/songs.js',
  './js/v28/analysis.js','./js/v28/local-audio.js','./js/v28/grouping.js','./js/v28/timeline.js','./js/v28/manual.js','./js/v28/practice.js','./js/v28/song-editing.js','./js/v28/edit-history.js','./js/v28/song-import.js','./js/v28/group-length.js','./js/v28/note-selection.js','./js/v28/playback.js'];
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
