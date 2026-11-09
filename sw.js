const CACHE='ciftelia-studio-v31-controls-below-20261109';
const CORE=['./','./index.html','./app.css','./songs/catalog.json','./songs/shtat-shaljan.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',
  './js/main.js','./js/constants.js','./js/audio-engine.js','./js/pitch.js',
  './js/microphone.js','./js/mic-onset-worklet.js','./js/songs.js',
  './js/analysis.js','./js/local-audio.js','./js/grouping.js','./js/timeline.js','./js/manual.js','./js/practice.js','./js/song-editing.js','./js/edit-history.js','./js/song-import.js','./js/group-length.js','./js/note-selection.js','./js/playback.js'];
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
