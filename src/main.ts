import {AudioEngine} from './audio-engine.js';
import {MicrophoneRecorder,DetectedHit,FilterOptions} from './microphone.js';
import {KEYS,HZ,DEMO,Song,NoteEvent,Stanza,labelFor,fmt,withOpenF} from './constants.js';
import {allSongs,loadSongs,newSong,saveSongs,exportSong} from './songs.js';
import {analyzeAudio,GuessedHit} from './analysis.js';
import {putOriginal,getOriginal,deleteOriginal} from './local-audio.js';
import {GROUP_COLORS,detectNoteGroups,groupAtTime,groupForNote,GroupSensitivity} from './grouping.js';
import {timelineGeometry,timelineX,timelineTime,clampTimelineStart,clampGroupBoundary,findGroupBoundary} from './timeline.js';
import {manualTapTime,manualNote} from './manual.js';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById('ciftelia') as unknown as SVGSVGElement;
const fretLayer=document.getElementById('fret-layer')!;
const hitZones=document.getElementById('hit-zones')!;
const highlights=document.getElementById('highlights')!;
const audio=new AudioEngine();
const mic=new MicrophoneRecorder(audio);
let savedSongs=loadSongs();
let draft:Song|null=null;
let selectedId=DEMO[0].id;
let keyboardRecordStart:number|null=null;
let keyboardEvents:NoteEvent[]=[];
let micHits:DetectedHit[]=[];
let micActive=false;
let playToken=0;
let playFrame=0;
const originalPlayer=$<HTMLAudioElement>('originalPlayer');
let importFile:File|null=null;
let importedHits:GuessedHit[]=[];
let originalObjectUrl:string|null=null;
let originalSourceId:string|null=null;
let analysisRowsVisible=60;
let audioSelectToken=0;
let analyzing=false;
let editingSongId:string|null=null;
let stanzas:Stanza[]=[{start:0,label:'Grupi 1',color:GROUP_COLORS[0]}];
let selectedImportedHit:GuessedHit|null=null;
let selectedGroupStart=0;
let activeGroupEndMs:number|null=null;
let playbackSpeed=1;
let currentPlayMode:'all'|'group'='all';
// Koha e riprodhimit dhe pamja horizontale mbahen të ndara.
let tabCurrentMs=0;
let tabViewStartMs=0;
let tabFollowPlayback=true;
let tabDrag:{pointerId:number;index:number;oldStart:number;previewMs:number}|null=null;
// Manual transcription: a tap captures the audio playback time; the user chooses the fret.
let manualMode=false;
let manualPending:{time:number;string:1|2}|null=null;
let syntheticStartMs=0;
let seekPendingUntilMetadata:number|null=null;

const STANZA_COLORS=GROUP_COLORS;
function importedSong(song:Song|null):boolean{return !!song?.originalAudioId;}
function clearOriginalUrl():void { seekPendingUntilMetadata=null;if(originalObjectUrl)URL.revokeObjectURL(originalObjectUrl);originalObjectUrl=null;originalSourceId=null;originalPlayer.removeAttribute('src');originalPlayer.load(); }
function showOriginalBlob(blob:Blob,id:string):void {
  clearOriginalUrl();originalObjectUrl=URL.createObjectURL(blob);originalSourceId=id;
  originalPlayer.src=originalObjectUrl;originalPlayer.hidden=false;originalPlayer.load();
}
async function prepareOriginalForSelection():Promise<void> {
  const song=currentSong();const token=++audioSelectToken;
  if(!importedSong(song)){originalPlayer.pause();originalPlayer.hidden=true;clearOriginalUrl();return;}
  if(song!.originalAudioId==='__draft' && importFile){
    if(originalSourceId!=='__draft')showOriginalBlob(importFile,'__draft');
    return;
  }
  if(originalSourceId===song!.originalAudioId)return;
  originalPlayer.pause();originalPlayer.hidden=true;clearOriginalUrl();
  try {
    const blob=await getOriginal(song!.originalAudioId!);
    if(token!==audioSelectToken)return;
    if(!blob){setStatus('Nuk gjendet audioja e kësaj kënge në këtë pajisje. JSON ruan notat, jo skedarin audio.');return;}
    showOriginalBlob(blob,song!.originalAudioId!);
  }catch(e){if(token===audioSelectToken)setStatus('Audioja e ruajtur nuk u lexua: '+String(e));}
}

const fretXs:number[]=[201];
const denom=1-Math.pow(2,-13/12);
for(let i=1;i<=13;i++){fretXs.push(201+808*(1-Math.pow(2,-i/12))/denom);}
function setStatus(s:string){ $('status').textContent=s; }
function setMicStatus(s:string){ $('micStatus').textContent=s; }
function currentSong():Song|null {
  if(selectedId==='__draft')return draft;
  return allSongs(savedSongs).find(s=>s.id===selectedId)||null;
}
function songForDisplay():Song|null{return currentSong();}
function activeSongGroups(song:Song|null):Stanza[]{
  return sanitizeStanzas(song?.stanzas);
}
function refreshGroupPicker(song:Song|null):void{
  const select=$<HTMLSelectElement>('selectedGroupSelect');
  const groups=activeSongGroups(song);
  if(!groups.some(g=>g.start===selectedGroupStart))selectedGroupStart=groups[0].start;
  select.replaceChildren(...groups.map((g,i)=>new Option(g.label,String(g.start))));
  select.value=String(selectedGroupStart);
  $('groupPlayBtn').toggleAttribute('disabled',!song || (!song.notes.length&&!importedSong(song)));
}
function selectGroup(start:number):void{
  const groups=activeSongGroups(currentSong());
  const group=groups.find(g=>g.start===start);
  if(!group)return;
  selectedGroupStart=group.start;
  $<HTMLSelectElement>('selectedGroupSelect').value=String(group.start);
  document.querySelectorAll('.stanza-entry').forEach(el=>el.classList.toggle('group-active',(el as HTMLElement).dataset.groupStart===String(group.start)));
  focusTimelineAt(group.start);
  setStatus(`U zgjodh ${group.label}. Vija me ngjyrë shfaqet në tablaturë.`);
}
function renderSongs():void {
  const selected=selectedId;
  const select=$<HTMLSelectElement>('songSelect');select.replaceChildren();
  if(draft){const opt=new Option(`● PROVË — ${draft.name}`,'__draft');select.add(opt);}
  for(const song of allSongs(savedSongs))select.add(new Option(song.name,song.id));
  select.value=selected;
  if(select.selectedIndex<0)select.selectedIndex=0;
  selectedId=select.value;
  const selectedSong=currentSong();
  const isUserSong=!!selectedSong && selectedSong.id!=='draft' && !DEMO.some(s=>s.id===selectedSong.id);
  $('saveBtn').toggleAttribute('disabled',!(draft && draft.notes.length>0));
  $('analysisEditSavedBtn').toggleAttribute('disabled',!selectedSong?.originalAudioId || selectedId==='__draft');
  $('deleteBtn').toggleAttribute('disabled',!isUserSong && selectedId!=='__draft');
  $('exportBtn').toggleAttribute('disabled',!selectedSong || !selectedSong.notes.length);
  $('songMeta').textContent=`${selectedSong?.notes.length??0} nota · ${selectedSong?fmt((selectedSong.notes.at(-1)?.time??0)+300):'00:00.00'}`;
  refreshGroupPicker(selectedSong);
  renderTimeline();
}
function sEl(tag:string,attrs:Record<string,string|number>,text?:string):SVGElement{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  if(text!==undefined)el.textContent=text;
  return el;
}
function renderInstrument():void {
  for(let n=1;n<=13;n++){
    const l=fretXs[n-1],r=fretXs[n],cx=(l+r)/2;
    fretLayer.append(sEl('line',{x1:r,x2:r,y1:208,y2:253,'stroke':'#dec5a0','stroke-width':2.6,'stroke-linecap':'round',opacity:.95}));
    fretLayer.append(sEl('text',{x:cx,y:188,'text-anchor':'middle',fill:'#bbad9c','font-size':15,'font-weight':650},`${n}`));
    if([4,7,8,11].includes(n))fretLayer.append(sEl('circle',{cx,cy:230.5,r:5.2,fill:'#edb657',stroke:'#352012','stroke-width':2,opacity:.9}));
    for(const string of [1,2] as const){
      const number=string===1?n:14;
      const name=string===1?`Perdja ${n}, teli poshtë, ${labelFor(n)}`:'Teli lart i hapur F, 220 Hz';
      const rect=sEl('rect',{x:l+1,y:string===1?231:208,width:Math.max(8,r-l-1),height:22,fill:'transparent',style:'cursor:pointer',tabindex:0,role:'button','aria-label':name});
      rect.addEventListener('pointerdown',()=>void hit(number,string));
      rect.addEventListener('keydown',(e:Event)=>{const k=e as KeyboardEvent;if(k.key==='Enter'||k.key===' '){k.preventDefault();void hit(number,string);}});
      hitZones.append(rect);
    }
  }
  for(const string of [1,2] as const){
    const number=string===1?15:14;
    const cup=sEl('rect',{x:1050,y:string===1?230:207,width:308,height:24,rx:6,fill:'transparent',style:'cursor:pointer',tabindex:0,role:'button','aria-label':string===1?'Teli poshtë i hapur G, 293 Hz':'Teli lart i hapur F, 220 Hz'});
    cup.addEventListener('pointerdown',()=>void hit(number,string));
    cup.addEventListener('keydown',(e:Event)=>{const k=e as KeyboardEvent;if(k.key==='Enter'||k.key===' '){k.preventDefault();void hit(number,string)}});
    hitZones.append(cup);
  }
}
function showActive(events:NoteEvent[]):void {
  highlights.replaceChildren();
  const visualEvents=withOpenF(events);
  const shown=new Set<string>();
  for(const ev of visualEvents){
    const key=`${ev.string}-${ev.noteNumber}`;
    if(shown.has(key))continue;
    shown.add(key);
    const cx=ev.noteNumber>=14?1175:(fretXs[ev.noteNumber-1]+fretXs[ev.noteNumber])/2;
    const cy=ev.string===1?240:219;
    highlights.append(sEl('circle',{cx,cy,r:17,fill:'#fbbf24',opacity:.32,filter:'url(#glow)'}));
    highlights.append(sEl('circle',{cx,cy,r:7.7,fill:'#f59e0b',stroke:'#fef3c7','stroke-width':2}));
  }
  const last=[...events].reverse().find(e=>e.noteNumber!==14) ?? events.at(-1);
  $('liveNote').textContent=last?`${labelFor(last.noteNumber)}${last.noteNumber!==14&&last.withF!==false?' + F':''}`:'—';
  $('liveHz').textContent=last?`${HZ[last.noteNumber-1]} Hz${last.noteNumber!==14&&last.withF!==false?' · F':''}`:'— Hz';
}
function renderKeys():void {
  const root=$('keypad');root.replaceChildren();
  KEYS.forEach((key,i)=>{
    const el=document.createElement('button');el.type='button';    el.className=`keycap ${i>=13?'keycap-open':''}`;
    el.innerHTML=`<strong>${key.toUpperCase()}</strong><span>${i===13?'LART HAPUR':i===14?'POSHTË HAPUR':`PERDJA ${i+1}`}</span><small>${HZ[i]} Hz</small>`;
    el.addEventListener('pointerdown',()=>void hit(i+1,i===13?2:1));root.append(el);
  });
}
async function hit(noteNumber:number,string:1|2):Promise<void> {
  if(micActive){setStatus('Mikrofoni është aktiv. Ndaloje për të luajtur notat në shfletues.');return;}
  try {void audio.hit(noteNumber).catch(e=>setStatus(String(e.message||e)));}
  catch(e){setStatus(String(e));}
  showActive([{string,noteNumber,time:0}]);
  if(keyboardRecordStart!==null){
    const now=performance.now();
    if(keyboardEvents.length===0)keyboardRecordStart=now;
    keyboardEvents.push({string,noteNumber,time:Math.round(now-keyboardRecordStart),velocity:audio.strength==='lehte'?.35:.92});
    $('recordCounter').textContent=`${keyboardEvents.length} nota`;
  }
  setStatus(`${labelFor(noteNumber)} · ${HZ[noteNumber-1]} Hz · Teli ${string}${noteNumber!==14?' + F (i hapur 220 Hz)':''}`);
}
function createDraftFromNotes(notes:NoteEvent[],name:string):void {
  draft=newSong(name,notes);
  selectedId='__draft';renderSongs();
  setStatus(`U krijua një provë me ${notes.length} nota. Shtyp Luaj për ta dëgjuar, pastaj Ruaj nëse dëshiron.`);
}
function recordKeyboard():void {
  if(micActive){setStatus('Ndalo mikrofonin përpara regjistrimit me tastierë.');return;}
  if(keyboardRecordStart!==null){
    keyboardRecordStart=null;$('recordBtn').classList.remove('recording');$('recordBtn').textContent='＋ Regjistro';
    createDraftFromNotes(keyboardEvents,'Regjistrim me tastierë');return;
  }
  stopPlayback();keyboardEvents=[];keyboardRecordStart=performance.now();
  $('recordBtn').classList.add('recording');$('recordBtn').textContent='■ Ndal regjistrimin';
  $('recordCounter').textContent='0 nota';
  setStatus('Regjistrimi nisi. Luaj notat, pastaj ndalo.');
}
function filterOptions():FilterOptions {
  return {lowCut:$<HTMLInputElement>('lowCut').checked,sensitivity:Number($<HTMLInputElement>('sensitivity').value)};
}
function renderMicHits():void {
  const root=$('micEvents');root.replaceChildren();
  if(!micHits.length){root.textContent='Ende nuk ka goditje të regjistruara.';return;}
  const start=micHits.slice(-100);
  const base=micHits.length-start.length;
  start.forEach((h,i)=>{
    const row=document.createElement('div');row.className='mic-hit';
    const time=document.createElement('span');time.className='hit-time';time.textContent=`+${Math.round(h.time-(micHits[base+i-1]?.time??0))}ms`;
    const freq=document.createElement('span');freq.className='hit-freq';freq.textContent=h.hz?`${h.hz.toFixed(1)} Hz`:'Hz ?';
    const select=document.createElement('select');select.setAttribute('aria-label',`Korrigjo notën në kohën ${h.time} ms`);
    select.add(new Option('? — e panjohur',''));
    KEYS.forEach((k,index)=>select.add(new Option(`${k.toUpperCase()} · ${HZ[index]} Hz`,String(index+1))));
    select.value=String(h.noteNumber??'');
    select.addEventListener('change',()=>{h.noteNumber=select.value?Number(select.value):null;if(!micActive)updateDraftFromMic();});
    row.append(time,select,freq);root.append(row);
  });
}
function updateDraftFromMic():void {
  const notes:NoteEvent[]=micHits.filter(h=>h.noteNumber!==null).map(h=>({string:(h.noteNumber===14?2:1) as 1|2,noteNumber:h.noteNumber!,time:h.time,measuredHz:h.hz??undefined,confidence:h.clarity}));
  if(draft && selectedId==='__draft'){draft.notes=notes;renderSongs();}
}
function stopMic():void {
  mic.stop();micActive=false;
  $('micBtn').textContent='🎙 Nis mikrofonin';$('micBtn').classList.remove('recording');
  const notes:NoteEvent[]=micHits.filter(h=>h.noteNumber!==null).map(h=>({string:(h.noteNumber===14?2:1) as 1|2,noteNumber:h.noteNumber!,time:h.time,measuredHz:h.hz??undefined,confidence:h.clarity}));
  createDraftFromNotes(notes,'Regjistrim me mikrofon');
  renderMicHits();
  const unknown=micHits.filter(h=>h.noteNumber===null).length;
  setMicStatus(`U ndal mikrofoni. ${notes.length} nota të njohura; ${unknown} të paqarta. Për ? përdor listën më poshtë për të zgjedhur notën, pastaj Luaj dhe Ruaj.`);
}
async function toggleMic():Promise<void> {
  if(micActive){stopMic();return;}
  if(keyboardRecordStart!==null)recordKeyboard();
  stopPlayback();
  setMicStatus('Po kërkohet leja e mikrofonit…');
  try {
    await mic.start(filterOptions());
    micActive=true;micHits=[];renderMicHits();
    $('micBtn').textContent='■ Ndal mikrofonin';$('micBtn').classList.add('recording');
    setMicStatus('Mikrofoni aktiv. Luaj vetëm telin e poshtëm. Tingulli nuk kthehet në altoparlant për të shmangur jehonën.');
  }catch(e){setMicStatus(`Gabim: ${e instanceof Error?e.message:String(e)}`);}
}
mic.onHit=(hit)=>{
  micHits.push(hit); // keep editable list separate from worklet-owned array
  $('micCurrent').textContent=hit.noteNumber?`${labelFor(hit.noteNumber)} · ${HZ[hit.noteNumber-1]} Hz`:'? · notë e paqartë';
  $('micMeasured').textContent=hit.hz?`${hit.hz.toFixed(1)} Hz`:'— Hz';
  $('micInterval').textContent=micHits.length>1?`${hit.time-micHits[micHits.length-2].time} ms`:'0 ms';
  $('micCount').textContent=`${micHits.filter(h=>h.noteNumber!==null).length} / ${micHits.length}`;
  if(hit.noteNumber)showActive([hit as NoteEvent]);
  renderMicHits();
};
function stopPlayback():void {
  playToken++;cancelAnimationFrame(playFrame);audio.stop();originalPlayer.pause();
  activeGroupEndMs=null;currentPlayMode='all';showActive([]);
  $('playBtn').textContent='▶ Luaj';$('groupPlayBtn').textContent='▶ Luaj grupin';$('studioState').textContent='GATI';
  syncTabTransport();
}
function selectedGroupRange(song:Song):{start:number;end:number;name:string;index:number}{
  const groups=activeSongGroups(song);
  const i=Math.max(0,groups.findIndex(g=>g.start===selectedGroupStart));
  const start=groups[i].start;
  const audioEnd=importedSong(song)&&Number.isFinite(originalPlayer.duration)?Math.round(originalPlayer.duration*1000):Math.max(start+600,...song.notes.map(n=>n.time+500));
  const end=Math.max(start+100,Math.min(audioEnd,groups[i+1]?.start??audioEnd));
  return {start,end,name:groups[i].label,index:i};
}
function configurePlaybackSpeed():void{
  originalPlayer.playbackRate=playbackSpeed;
  if('preservesPitch' in originalPlayer)originalPlayer.preservesPitch=true;
}
function completeGroupPlayback():void{
  stopPlayback();setStatus('Luajtja e grupit përfundoi.');
}
async function playSelectedGroup():Promise<void>{
  if(micActive){setStatus('Ndalo mikrofonin përpara luajtjes.');return;}
  if(keyboardRecordStart!==null)recordKeyboard();
  const song=currentSong();if(!song){setStatus('Zgjidh një këngë.');return;}
  const range=selectedGroupRange(song);
  stopPlayback();currentPlayMode='group';
  tabCurrentMs=range.start;tabFollowPlayback=true;
  tabViewStartMs=clampTimelineStart(range.start-visibleTab().visibleMs*.25,visibleTab().visibleMs,tabSongEnd(song));
  redrawTab();
  if(importedSong(song)){
    if(!originalPlayer.src){setStatus('Mungon audioja origjinale në këtë pajisje.');return;}
    activeGroupEndMs=range.end;
    configurePlaybackSpeed();
    try{
      originalPlayer.currentTime=range.start/1000;
      await originalPlayer.play();
      $('groupPlayBtn').textContent='▶ Po luhet grupi';
      setStatus(`Po luhet vetëm ${range.name} · ${playbackSpeed.toFixed(2)}×`);
    }catch(e){stopPlayback();setStatus('Gabim gjatë luajtjes së grupit: '+String(e));}
    return;
  }
  const notes=song.notes.filter(n=>groupForNote(activeSongGroups(song),n)===range.index);
  if(!notes.length){stopPlayback();setStatus('Grupi i zgjedhur nuk ka nota.');return;}
  const first=Math.min(...notes.map(n=>n.time));
  const clip:Song={...song,notes:notes.map(n=>({...n,time:n.time-first}))};
  const token=++playToken;
  try{
    await audio.play(clip,playbackSpeed);
    if(token!==playToken){audio.stop();return;}
    $('groupPlayBtn').textContent='▶ Po luhet grupi';$('studioState').textContent='GRUPI';
    const loop=()=>{
      if(token!==playToken)return;
      const ms=first+audio.elapsedMs*playbackSpeed;
      drawTab(song,ms);$('timeLabel').textContent=`${fmt(ms)} / ${fmt(range.end)}`;
      const active=notes.filter(n=>Math.abs(n.time-ms)<75);
      if(active.length)showActive(active);
      if(audio.done()){completeGroupPlayback();return;}
      playFrame=requestAnimationFrame(loop);
    };loop();
  }catch(e){stopPlayback();setStatus('Gabim gjatë luajtjes së grupit: '+String(e));}
}
/** All tab controls share the exact original audio clock and position. */
function playbackPositionMs():number {
  return importedSong(currentSong()) && Number.isFinite(originalPlayer.currentTime)
    ? originalPlayer.currentTime*1000
    : audio.playing ? syntheticStartMs + audio.elapsedMs*playbackSpeed : tabCurrentMs;
}
function activeSeekEndMs():number {
  const song=currentSong();
  if(importedSong(song) && Number.isFinite(originalPlayer.duration) && originalPlayer.duration>0)
    return Math.round(originalPlayer.duration*1000);
  return tabSongEnd(song);
}
function preciseTime(ms:number):string {
  return (Math.max(0,ms)/1000).toFixed(3);
}
function syncTabTransport():void {
  const song=currentSong(), maxMs=activeSeekEndMs();
  const ms=Math.max(0,Math.min(tabCurrentMs,maxMs));
  const seconds=$<HTMLInputElement>('tabSeekSeconds');
  if(document.activeElement!==seconds)seconds.value=preciseTime(ms);
  seconds.max=preciseTime(maxMs);
  const slider=$<HTMLInputElement>('tabSeekSlider');
  slider.max=preciseTime(maxMs);
  if(document.activeElement!==slider)slider.value=preciseTime(ms);
  $('tabSeekReadout').textContent=`${fmt(ms)} · ${preciseTime(ms)} s`;
  const playing=importedSong(song) ? !originalPlayer.paused : audio.playing;
  $('playBtn').textContent=playing?'⏸ Pauzë':'▶ Luaj';
}
/** Pause before seeking so the player cannot overwrite the clicked position. */
function seekToMs(target:number):void {
  const song=currentSong();if(!song)return;
  const end=activeSeekEndMs();
  const ms=Math.max(0,Math.min(end,Number.isFinite(target)?Math.round(target):0));
  if(importedSong(song)){
    originalPlayer.pause();
    try {
      if(originalPlayer.readyState>0){originalPlayer.currentTime=ms/1000;seekPendingUntilMetadata=null;}
      else seekPendingUntilMetadata=ms;
    }catch{seekPendingUntilMetadata=ms;}
  }else{
    playToken++;cancelAnimationFrame(playFrame);audio.stop();
  }
  activeGroupEndMs=null;currentPlayMode='all';
  tabCurrentMs=ms;tabFollowPlayback=false;
  const geom=visibleTab(),x=timelineX(ms,tabViewStartMs,geom.left,geom.scale);
  if(x<geom.left || x>geom.width-geom.right){
    tabViewStartMs=clampTimelineStart(ms-geom.visibleMs*.45,geom.visibleMs,tabSongEnd(song));
  }
  drawTab(song,ms);
  $('timeLabel').textContent=`${fmt(ms)} / ${fmt(activeSeekEndMs())}`;
  setStatus(`U ndal te ${preciseTime(ms)} s. Kliko telin në tablaturë për të vendosur notën.`);
}
/** For synthesized demos, play only notes after the chosen cursor. */
async function playSynthFromCursor():Promise<void>{
  const song=currentSong();if(!song||!song.notes.length)return;
  const first=Math.max(0,tabCurrentMs);
  const events=song.notes.filter(n=>n.time>=first);
  if(!events.length){seekToMs(0);return;}
  const clip:Song={...song,notes:events.map(e=>({...e,time:e.time-first}))};
  playToken++;const token=playToken;syntheticStartMs=first;
  try{
    await audio.play(clip,playbackSpeed);
    if(token!==playToken)return;
    const frame=()=>{
      if(token!==playToken||!audio.playing)return;
      const ms=Math.min(activeSeekEndMs(),syntheticStartMs+audio.elapsedMs*playbackSpeed);
      drawTab(song,ms);$('timeLabel').textContent=`${fmt(ms)} / ${fmt(activeSeekEndMs())}`;
      const now=song.notes.filter(e=>Math.abs(e.time-ms)<70);if(now.length)showActive(now);
      if(audio.done()){audio.stop();syncTabTransport();return;}
      playFrame=requestAnimationFrame(frame);
    };frame();
  }catch(e){setStatus(`Luajtja nuk nisi: ${String(e)}`);syncTabTransport();}
}
/** Same Play/Pause button resumes from the chosen second; never resets unexpectedly. */
async function toggleTabPlay():Promise<void>{
  if(micActive){setStatus('Ndalo mikrofonin përpara luajtjes.');return;}
  if(manualPending){setStatus('Vendos ose anulo notën e hapur para luajtjes.');return;}
  const song=currentSong();if(!song)return;
  if(importedSong(song)){
    if(!originalPlayer.src){setStatus('Audioja origjinale nuk është gati.');return;}
    if(!originalPlayer.paused){originalPlayer.pause();tabCurrentMs=originalPlayer.currentTime*1000;redrawTab();return;}
    if(Number.isFinite(originalPlayer.duration) && originalPlayer.currentTime>=originalPlayer.duration-.02){seekToMs(0);}
    configurePlaybackSpeed();
    try{await originalPlayer.play();}catch(e){setStatus('Luajtja nuk nisi: '+String(e));}
  }else{
    if(audio.playing){const at=playbackPositionMs();playToken++;cancelAnimationFrame(playFrame);audio.stop();tabCurrentMs=at;redrawTab();return;}
    await playSynthFromCursor();
  }
  syncTabTransport();
}
async function playCurrent():Promise<void> {
  if(micActive){setStatus('Ndalo mikrofonin para luajtjes.');return;}
  if(keyboardRecordStart!==null)recordKeyboard();
  stopPlayback();
  const song=currentSong();if(!song){setStatus('Zgjidh këngën.');return;}
  if(!song.notes.length && !importedSong(song)){setStatus('Kënga nuk ka nota të njohura. Korrigjo notat ? te regjistrimi.');return;}
  const token=++playToken;
  currentPlayMode='all';configurePlaybackSpeed();tabCurrentMs=0;tabViewStartMs=0;tabFollowPlayback=true;
  if(importedSong(song)){
    if(!originalPlayer.src){setStatus('Mungon audioja origjinale në këtë pajisje. Zgjidh këngën sërish.');return;}
    try {originalPlayer.currentTime=0;await originalPlayer.play();}
    catch(e){setStatus('Shfletuesi nuk nisi audion: '+String(e));$('playBtn').textContent='▶ Luaj';}
    return;
  }
  $('playBtn').textContent='… Po ngarkohet';$('studioState').textContent='NGARKIM';
  try {
    await audio.play(song,playbackSpeed);
    if(token!==playToken)return;
    $('playBtn').textContent='▶ Po luhet';$('studioState').textContent='DUKE LUAJTUR';
    setStatus(`Po luhet ${song.name} · ${song.notes.length} nota`);
    const loop=()=>{
      if(token!==playToken)return;
      const ms=audio.elapsedMs*playbackSpeed;
      const current=song.notes.filter(n=>Math.abs(n.time-ms)<75);
      if(current.length)showActive(current);
      drawTab(song,ms);
      $('timeLabel').textContent=`${fmt(ms)} / ${fmt(song.notes.at(-1)!.time+600)}`;
      if(audio.done()){stopPlayback();setStatus('Kënga përfundoi.');return;}
      playFrame=requestAnimationFrame(loop);
    };loop();
  }catch(e){$('playBtn').textContent='▶ Luaj';$('studioState').textContent='GABIM';setStatus(`Audio: ${e instanceof Error?e.message:String(e)}`);}
}
async function saveDraft():Promise<void> {
  if(manualPending){setStatus('Vendos ose anulo notën e hapur para ruajtjes.');return;}
  if(!draft||!draft.notes.length){setStatus('Nuk ka këngë provë për ruajtje.');return;}
  const title=prompt('Emri i këngës:',draft.name);
  if(title===null)return;
  if(!title.trim()){setStatus('Vendos një emër për këngën.');return;}
  const saved={...draft,id:editingSongId||newSong(title,[]).id,name:title.trim(),stanzas:sanitizeStanzas(stanzas)};
  if(draft.originalAudioId==='__draft' && importFile){
    try {await putOriginal(saved.id,importFile);saved.originalAudioId=saved.id;}
    catch(e){setStatus(`Audioja nuk u ruajt në këtë pajisje: ${String(e)}. Liro hapësirë dhe provo përsëri.`);return;}
  }
  const next=editingSongId?savedSongs.map(s=>s.id===editingSongId?saved:s):[...savedSongs,saved];
  if(!saveSongs(next)){if(draft.originalAudioId==='__draft' && importFile)void deleteOriginal(saved.id).catch(()=>{});setStatus('Ruajtja dështoi: hapësira e shfletuesit është plot. Eksporto JSON.');return;}
  savedSongs=next;draft=null;editingSongId=null;selectedId=saved.id;importedHits=[];importFile=null;renderImportedHits();renderSongs();void prepareOriginalForSelection();setStatus(`Kënga “${saved.name}” u ruajt në këtë shfletues.`);
}
async function deleteSong():Promise<void> {
  if(selectedId==='__draft'){
    if(confirm('Ta fshijmë këngën provë?')){draft=null;editingSongId=null;importFile=null;importedHits=[];renderImportedHits();selectedId=DEMO[0].id;renderSongs();void prepareOriginalForSelection();setStatus('Prova u fshi.');}
    return;
  }
  const song=currentSong();if(!song||DEMO.some(d=>d.id===song.id))return;
  if(!confirm(`Ta fshijmë këngën “${song.name}”?`))return;
  const next=savedSongs.filter(s=>s.id!==song.id);if(!saveSongs(next)){setStatus('Fshirja nuk u ruajt.');return;}savedSongs=next;
  if(song.originalAudioId)try{await deleteOriginal(song.originalAudioId);}catch{}
  selectedId=DEMO[0].id;renderSongs();void prepareOriginalForSelection();setStatus('Kënga u fshi nga ky shfletues.');
}
const canvas=$<HTMLCanvasElement>('tabCanvas');
function tabSongEnd(song:Song|null):number{
  const maxNote=Math.max(0,...(song?.notes??[]).map(n=>n.time));
  const maxGroup=Math.max(0,...(song?.stanzas??[]).map(g=>g.start));
  const audioEnd=importedSong(song)&&Number.isFinite(originalPlayer.duration)?originalPlayer.duration*1000:0;
  return Math.max(1600,maxNote+950,maxGroup+850,audioEnd);
}
function visibleTab():{left:number;right:number;scale:number;visibleMs:number;width:number}{
  return timelineGeometry(canvas.getBoundingClientRect().width||360);
}
function tabCurrentGroups(song:Song|null):Stanza[]{
  return activeSongGroups(song);
}
function editableTab():boolean{return selectedId==='__draft' && !!draft?.originalAudioId;}
function redrawTab():void{drawTab(songForDisplay(),tabCurrentMs);}
function focusTimelineAt(time:number):void{
  const geom=visibleTab();
  tabViewStartMs=clampTimelineStart(time-geom.visibleMs*.25,geom.visibleMs,tabSongEnd(songForDisplay()));
  tabFollowPlayback=false;
  redrawTab();
}
function moveTimeline(direction:-1|1):void{
  const song=songForDisplay();if(!song)return;
  const geom=visibleTab();
  tabViewStartMs=clampTimelineStart(tabViewStartMs+direction*geom.visibleMs*.66,geom.visibleMs,tabSongEnd(song));
  tabFollowPlayback=false;redrawTab();
}
function applyGroupMarkerPosition(index:number,proposed:number):void{
  if(!editableTab()){setStatus('Për të lëvizur grupet, hap Redakto këngën.');return;}
  const marker=stanzas[index];if(!marker || index===0)return;
  const old=marker.start;
  const next=clampGroupBoundary(stanzas,index,proposed,tabSongEnd(draft));
  if(next===null){setStatus('Grupet janë shumë afër për ta lëvizur këtë vijë.');return;}
  if(next===old){redrawTab();return;}
  marker.start=next;
  for(const hit of importedHits)if(hit.groupStart===old)hit.groupStart=next;
  if(selectedGroupStart===old)selectedGroupStart=next;
  stanzas=sanitizeStanzas(stanzas);
  updateImportDraft();renderImportedHits();
  tabFollowPlayback=false;
  redrawTab();
  setStatus(`Vija e ${marker.label} u zhvendos nga ${fmt(old)} në ${fmt(next)}. Shtyp Ruaj për ta ruajtur.`);
}
function moveSelectedMarker(delta:number):void{
  const index=stanzas.findIndex(g=>g.start===selectedGroupStart);
  if(index<=0){setStatus('Zgjidh grupin 2 ose një grup pas tij. Grupi i parë fillon në 0.');return;}
  applyGroupMarkerPosition(index,stanzas[index].start+delta);
}
function setTabControls(song:Song|null,geom:ReturnType<typeof timelineGeometry>):void{
  const groups=tabCurrentGroups(song);
  const canMove=editableTab() && groups.findIndex(g=>g.start===selectedGroupStart)>0;
  $('tabLeftBtn').toggleAttribute('disabled',!song || tabViewStartMs<=0);
  $('tabRightBtn').toggleAttribute('disabled',!song || tabViewStartMs>=clampTimelineStart(tabSongEnd(song),geom.visibleMs,tabSongEnd(song)));
  $('tabMarkLeftBtn').toggleAttribute('disabled',!canMove);
  $('tabMarkRightBtn').toggleAttribute('disabled',!canMove);
  $('tabFollowBtn').classList.toggle('is-on',tabFollowPlayback);
  $('tabFollowBtn').setAttribute('aria-pressed',String(tabFollowPlayback));
  $('tabViewRange').textContent=`${fmt(tabViewStartMs)} – ${fmt(tabViewStartMs+geom.visibleMs)}`;
}
function drawTab(song:Song|null,elapsed=tabCurrentMs):void {
  tabCurrentMs=Math.max(0,elapsed);
  const rect=canvas.getBoundingClientRect();const geom=timelineGeometry(rect.width);const {width:w,left,right,scale,visibleMs}=geom;
  const h=175,dpr=Math.min(2,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);
  if(song && tabFollowPlayback && (audio.playing || (!originalPlayer.paused && importedSong(song)))){
    const x=timelineX(tabCurrentMs,tabViewStartMs,left,scale);
    if(x>left+(w-left-right)*.79 || x<left+8)tabViewStartMs=clampTimelineStart(tabCurrentMs-visibleMs*.24,visibleMs,tabSongEnd(song));
  }
  tabViewStartMs=clampTimelineStart(tabViewStartMs,visibleMs,tabSongEnd(song));
  c.clearRect(0,0,w,h);c.fillStyle='#101c2c';c.fillRect(0,0,w,h);
  const groups=tabCurrentGroups(song);
  const visualGroups=groups.map((g,i)=>tabDrag?.index===i?{...g,start:tabDrag.previewMs}:g);
  // Each group has a continuous colored region, so manually corrected starts are visible.
  for(let i=0;i<visualGroups.length;i++){
    const g=visualGroups[i],start=g.start,end=visualGroups[i+1]?.start??tabSongEnd(song);
    const x1=Math.max(left,timelineX(start,tabViewStartMs,left,scale));
    const x2=Math.min(w-right,timelineX(end,tabViewStartMs,left,scale));
    if(x2<=x1)continue;
    const color=g.color||STANZA_COLORS[i%STANZA_COLORS.length];
    c.fillStyle=color;c.globalAlpha=g.start===selectedGroupStart?.21:.11;c.fillRect(x1,27,x2-x1,131);c.globalAlpha=1;
    c.fillStyle=color;c.globalAlpha=.65;c.fillRect(x1,3,x2-x1,22);c.globalAlpha=1;
    if(x2-x1>28){c.fillStyle='#101c2c';c.font='bold 10px system-ui';c.fillText(g.label.slice(0,Math.max(3,Math.floor((x2-x1)/8))),x1+5,17);}
  }
  c.strokeStyle='#33465b';c.lineWidth=1;
  for(const y of [60,120]){c.beginPath();c.moveTo(left,y);c.lineTo(w-right,y);c.stroke();}
  c.fillStyle='#9baebc';c.font=w<430?'10px system-ui':'12px system-ui';
  c.fillText('LART',12,62);c.fillText('POSHTË',12,122);
  // Accurate 0.5 s grid, 0.1 s subdivisions; labels show decimal seconds.
  c.font='10px system-ui';c.fillStyle='#9bb4c6';
  for(let tick=Math.ceil(tabViewStartMs/100);tick*100<=tabViewStartMs+visibleMs;tick++){
    const at=tick*100,sx=timelineX(at,tabViewStartMs,left,scale);
    if(sx<left||sx>w-right)continue;
    const major=tick%5===0, whole=tick%10===0;
    c.strokeStyle=major?'#50677f':'#304154';c.lineWidth=major?1:.6;
    c.globalAlpha=major?.65:.28;c.beginPath();c.moveTo(sx,major?26:146);c.lineTo(sx,155);c.stroke();c.globalAlpha=1;
    if(major && sx<w-right-32)c.fillText(`${(at/1000).toFixed(whole?0:1)} s`,sx+3,170);
  }
  // Colored boundary lines and draggable handles. The first group starts at zero (fixed).
  for(let i=1;i<visualGroups.length;i++){
    const group=visualGroups[i],sx=timelineX(group.start,tabViewStartMs,left,scale);
    if(sx<left-8||sx>w-right+8)continue;
    const color=group.color||STANZA_COLORS[i%STANZA_COLORS.length];
    c.strokeStyle=color;c.lineWidth=group.start===selectedGroupStart?4.5:3;
    c.beginPath();c.moveTo(sx,23);c.lineTo(sx,157);c.stroke();
    c.fillStyle=color;c.beginPath();c.moveTo(sx-9,24);c.lineTo(sx+9,24);c.lineTo(sx,37);c.closePath();c.fill();
    if(tabDrag?.index===i){
      c.fillStyle='#f8f4ed';c.font='bold 11px system-ui';
      const text=fmt(group.start);c.fillText(text,Math.min(w-65,Math.max(left+4,sx+12)),48);
    }
  }
  const playerX=timelineX(tabCurrentMs,tabViewStartMs,left,scale);
  if(playerX>=left && playerX<=w-right){
    c.strokeStyle='#f8cc76';c.lineWidth=2;c.beginPath();c.moveTo(playerX,26);c.lineTo(playerX,159);c.stroke();
  }
  if(song){
    for(const e of withOpenF(song.notes)){
      const x=timelineX(e.time,tabViewStartMs,left,scale);
      if(x<left-11||x>w-right+11)continue;
      const y=e.string===1?120:60;
      const gi=groupForNote(groups,e);
      const groupColor=groups[gi]?.color||STANZA_COLORS[gi%STANZA_COLORS.length];
      c.beginPath();c.arc(x,y,11,0,Math.PI*2);c.fillStyle=Math.abs(e.time-tabCurrentMs)<60?groupColor:'#203f4f';c.fill();
      c.strokeStyle=groupColor;c.lineWidth=2;c.stroke();
      c.fillStyle=Math.abs(e.time-tabCurrentMs)<60?'#141e2b':'#f6e6ca';c.font='bold 12px system-ui';c.textAlign='center';c.fillText(importedSong(song)&&e.noteNumber<=13?String(e.noteNumber):labelFor(e.noteNumber),x,y+4);c.textAlign='start';
      // Notes manually moved between groups keep their original time but take their target group's color.
      if(Number.isFinite(e.groupStart) && gi!==groupAtTime(groups,e.time)){
        c.fillStyle=groupColor;c.fillRect(x+6,y-15,5,5);
      }
    }
  }else{c.font='13px system-ui';c.fillStyle='#8d9bac';c.fillText('Zgjidh këngën.',left+20,92);}
  if(manualPending && editableTab()){
    const px=timelineX(manualPending.time,tabViewStartMs,left,scale);
    if(px>=left&&px<=w-right){
      const py=manualPending.string===2?60:120;
      c.beginPath();c.arc(px,py,14,0,Math.PI*2);c.fillStyle='#f0b75b';c.fill();
      c.strokeStyle='#fff4db';c.lineWidth=2;c.stroke();
      c.fillStyle='#1b2532';c.textAlign='center';c.font='bold 14px system-ui';c.fillText('?',px,py+5);c.textAlign='start';
    }
  }
  c.fillStyle='#132437';c.fillRect(0,0,left-1,h);
  c.fillStyle='#a7bccc';c.font='bold 11px system-ui';c.fillText('TELI LART',7,47);c.fillText('TELI POSHTË',7,106);
  setTabControls(song,geom);
  syncTabTransport();
}
function renderTimeline():void {
  drawTab(songForDisplay(),tabCurrentMs);
  const song=songForDisplay();
  $('timeLabel').textContent=`${fmt(tabCurrentMs)} / ${fmt(tabSongEnd(song))}`;
}
/** A click must use its own position, even if music was playing elsewhere. */
function captureManualTime(x:number,geom:ReturnType<typeof timelineGeometry>):number {
  return manualTapTime(false,0,x,tabViewStartMs,geom.left,geom.scale,activeSeekEndMs());
}
function renderManualMode():void{
  const btn=$<HTMLButtonElement>('manualModeBtn');
  btn.classList.toggle('is-on',manualMode);
  btn.setAttribute('aria-pressed',String(manualMode));
  btn.textContent=manualMode?'✍ Shënim manual: AKTIV':'✍ Shëno manualisht';
  $('manualEntryPanel').hidden=!manualPending;
  $('manualClearBtn').toggleAttribute('disabled',!editableTab()||!importedHits.length);
  $('tabHelp').textContent=manualMode
    ?'Kliko te sekonda ku dëshiron notën: kënga ndalet në atë pozicion. Zgjidh perden dhe përdor Vendos & Vazhdo. Koha mund të rregullohet në 0.001 sekonda.'
    :'Tërhiq vijën e grupit për të korrigjuar kufirin. Përdor ✍ Shëno manualisht për të vendosur notat ndërsa dëgjon muzikën.';
}
function cancelManualNote():void{
  manualPending=null;renderManualMode();redrawTab();
}
function beginManualNote(x:number,y:number,geom:ReturnType<typeof timelineGeometry>):void{
  if(!editableTab()||!importedSong(currentSong())||!originalPlayer.src){
    setStatus('Për shënim manual, importo një audio ose hap Redakto këngën.');return;
  }
  if(manualPending){setStatus('Përfundo ose anulo notën e mëparshme.');return;}
  const time=captureManualTime(x,geom);
  const string:1|2=y<90?2:1;
  seekToMs(time);
  manualPending={time,string};
  const select=$<HTMLSelectElement>('manualFretSelect');
  select.value=string===2?'14':'';
  $<HTMLInputElement>('manualFCompanion').checked=string===1;
  $<HTMLInputElement>('manualFCompanion').disabled=string===2;
  $('manualTimeLabel').textContent=`${preciseTime(time)} s · ${string===2?'Teli lart':'Teli poshtë'}`;
  $<HTMLInputElement>('manualTimeSeconds').value=preciseTime(time);
  renderManualMode();
  tabFollowPlayback=false;
  focusTimelineAt(time);
  setStatus(`Shënim në ${fmt(time)}. Zgjidh perden dhe shtyp Vendos ose Vendos & Vazhdo.`);
  $<HTMLElement>('manualEntryPanel').scrollIntoView({block:'nearest',behavior:'smooth'});
  select.focus({preventScroll:true});
}
function commitManualNote(resume:boolean):void{
  if(!manualPending||!editableTab())return;
  const noteNumber=Number($<HTMLSelectElement>('manualFretSelect').value);
  if(!Number.isInteger(noteNumber)||noteNumber<1||noteNumber>15){
    setStatus('Zgjidh perden 1–13, F (14) ose telin e poshtëm të hapur (15).');return;
  }
  const entered=Number($<HTMLInputElement>('manualTimeSeconds').value);
  if(!Number.isFinite(entered)||entered<0||entered*1000>activeSeekEndMs()){
    setStatus('Shkruaj sekonda të vlefshme për notën.');return;
  }
  const time=Math.round(entered*1000);
  // The saved note follows the precise user-selected second, not the old playback clock.
  seekToMs(time);
  const groupStart=stanzas[groupAtTime(stanzas,time)]?.start??0;
  const h:GuessedHit=manualNote(noteNumber,time,$<HTMLInputElement>('manualFCompanion').checked,groupStart);
  importedHits.push(h);
  selectedImportedHit=h;
  const count=stanzas.flatMap((_,i)=>importedHits.filter(v=>groupForNote(stanzas,v)===i)).indexOf(h);
  analysisRowsVisible=Math.max(analysisRowsVisible,count+1);
  manualPending=null;
  updateImportDraft();renderImportedHits();renderManualMode();redrawTab();
  setStatus(`Nota ${noteNumber===14?'F':noteNumber===15?'G':noteNumber} u vendos te ${fmt(time)}. ${resume?'Vazhdo dëgjimin.':'Mund të korrigjosh kohën në listë.'}`);
  if(resume){
    configurePlaybackSpeed();
    void originalPlayer.play().catch(e=>setStatus('Audioja nuk vazhdoi: '+String(e)));
  }
}
function setManualMode(on:boolean):void{
  if(!on)cancelManualNote();
  manualMode=on;renderManualMode();
  setStatus(on?'Shënim manual aktiv. Shtyp Luaj; prek tablaturën në goditjen që dëgjon.':'Shënimi manual u çaktivizua.');
}
function installTabInteraction():void{
  $('tabLeftBtn').addEventListener('click',()=>moveTimeline(-1));
  $('tabRightBtn').addEventListener('click',()=>moveTimeline(1));
  $('tabFollowBtn').addEventListener('click',()=>{
    tabFollowPlayback=true;tabViewStartMs=clampTimelineStart(tabCurrentMs-visibleTab().visibleMs*.25,visibleTab().visibleMs,tabSongEnd(songForDisplay()));redrawTab();
  });
  $('tabMarkLeftBtn').addEventListener('click',()=>moveSelectedMarker(-50));
  $('tabMarkRightBtn').addEventListener('click',()=>moveSelectedMarker(50));
  $('tabBackBtn').addEventListener('click',()=>seekToMs(playbackPositionMs()-1000));
  $('tabNextBtn').addEventListener('click',()=>seekToMs(playbackPositionMs()+1000));
  $('tabFineBackBtn').addEventListener('click',()=>seekToMs(playbackPositionMs()-100));
  $('tabFineNextBtn').addEventListener('click',()=>seekToMs(playbackPositionMs()+100));
  const seekSeconds=$<HTMLInputElement>('tabSeekSeconds');
  const submitSeek=()=>{
    if(!seekSeconds.value.trim()||!Number.isFinite(Number(seekSeconds.value)))return;
    seekToMs(Number(seekSeconds.value)*1000);
  };
  $('tabSeekGoBtn').addEventListener('click',submitSeek);
  seekSeconds.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitSeek();seekSeconds.blur();}});
  seekSeconds.addEventListener('change',submitSeek);
  const seekSlider=$<HTMLInputElement>('tabSeekSlider');
  seekSlider.addEventListener('input',()=>seekToMs(Number(seekSlider.value)*1000));
  seekSlider.addEventListener('change',()=>{seekSlider.blur();syncTabTransport();});
  canvas.addEventListener('pointerdown',(event:PointerEvent)=>{
    const song=songForDisplay();if(!song)return;
    const rect=canvas.getBoundingClientRect(),geom=visibleTab();
    const x=event.clientX-rect.left,y=event.clientY-rect.top;
    if(y<16||y>162||x<geom.left||x>geom.width-geom.right)return;
    // In the string area, a tap ALWAYS selects the tapped second, not a nearby group marker.
    if(y>=37){
      if(manualMode && editableTab())beginManualNote(x,y,geom);
      else seekToMs(timelineTime(x,tabViewStartMs,geom.left,geom.scale));
      event.preventDefault();return;
    }
    // Group boundaries can only be dragged by their top triangles.
    const groups=tabCurrentGroups(song);
    const index=findGroupBoundary(groups,x,tabViewStartMs,geom.left,geom.scale,13);
    if(index<1){seekToMs(timelineTime(x,tabViewStartMs,geom.left,geom.scale));event.preventDefault();return;}
    if(!editableTab()){
      selectedGroupStart=groups[index].start;
      refreshGroupPicker(song);redrawTab();
      setStatus('Për të tërhequr këtë vijë, shtyp Redakto këngën.');return;
    }
    selectedGroupStart=groups[index].start;tabFollowPlayback=false;
    tabDrag={pointerId:event.pointerId,index,oldStart:groups[index].start,previewMs:groups[index].start};
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor='ew-resize';event.preventDefault();redrawTab();
  });
  canvas.addEventListener('pointermove',(event:PointerEvent)=>{
    if(!tabDrag||event.pointerId!==tabDrag.pointerId)return;
    const geom=visibleTab(),rect=canvas.getBoundingClientRect();
    const proposed=timelineTime(event.clientX-rect.left,tabViewStartMs,geom.left,geom.scale);
    const value=clampGroupBoundary(stanzas,tabDrag.index,proposed,tabSongEnd(draft));
    if(value!==null)tabDrag.previewMs=value;
    redrawTab();event.preventDefault();
  });
  canvas.addEventListener('pointerup',(event:PointerEvent)=>{
    if(!tabDrag||event.pointerId!==tabDrag.pointerId)return;
    const drag=tabDrag;tabDrag=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor='crosshair';
    applyGroupMarkerPosition(drag.index,drag.previewMs);
    event.preventDefault();
  });
  canvas.addEventListener('pointercancel',()=>{tabDrag=null;canvas.style.cursor='crosshair';redrawTab();});
  canvas.addEventListener('keydown',(event:KeyboardEvent)=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();
      if(event.shiftKey)moveSelectedMarker(event.key==='ArrowLeft'?-50:50);
      else moveTimeline(event.key==='ArrowLeft'?-1:1);
    }
  });
  window.addEventListener('resize',redrawTab);
}

async function importSongFile(file:File):Promise<void> {
  try {
    if (file.size > 2_000_000) throw new Error('Skedari është tepër i madh.');
    const data:unknown=JSON.parse(await file.text());
    if (!data || typeof data !== 'object') throw new Error('JSON i pavlefshëm.');
    const obj=data as {name?:unknown,notes?:unknown};
    if(!Array.isArray(obj.notes) || obj.notes.length<1 || obj.notes.length>10000) throw new Error('Lista e notave nuk është e vlefshme.');
    const notes:NoteEvent[]=obj.notes.map((v:unknown)=>{
      const n=v as Partial<NoteEvent>;
      if(!n || (n.string!==1&&n.string!==2) || !Number.isInteger(n.noteNumber) || (n.noteNumber as number)<1 || (n.noteNumber as number)>15 || !Number.isFinite(n.time) || (n.time as number)<0 || (n.time as number)>3_600_000) throw new Error('Një notë ka vlera të pavlefshme.');
      return {string:n.string as 1|2,noteNumber:n.noteNumber as number,time:n.time as number,withF:n.withF!==false,
        ...(Number.isInteger(n.groupStart) && (n.groupStart as number)>=0?{groupStart:n.groupStart}:{} )};
    });
    const name=typeof obj.name==='string'?obj.name:'Këngë e importuar';
    stopPlayback();createDraftFromNotes(notes,name);
    const markers=(data as {stanzas?:Stanza[]}).stanzas;stanzas=sanitizeStanzas(Array.isArray(markers)?markers:undefined);if(draft)draft.stanzas=stanzas;
    setStatus('Kënga u importua si PROVË. Shtyp Luaj dhe pastaj Ruaj nëse dëshiron.');
  }catch(e){setStatus(`Importimi dështoi: ${e instanceof Error?e.message:String(e)}`)}
}
/** Edit a saved transcription in a draft; the original stored recording remains untouched. */
async function editSavedAudio():Promise<void>{
  const song=currentSong();
  if(!song?.originalAudioId || selectedId==='__draft')return;
  stopPlayback(); editingSongId=song.id; importFile=null;selectedImportedHit=null; $('analyzeBtn').setAttribute('disabled','');
  draft={...song,notes:song.notes.map(n=>({...n}))};
  stanzas=sanitizeStanzas(song.stanzas);
  importedHits=song.notes.map(n=>({time:n.time,noteNumber:n.noteNumber,string:n.string,confidence:n.confidence??1,withF:n.withF!==false,groupStart:n.groupStart,detail:'Ruajtur'}));
  analysisRowsVisible=60; selectedId='__draft';manualPending=null;manualMode=true;
  renderSongs();renderImportedHits();renderManualMode();await prepareOriginalForSelection();
  setStatus('Po redakton këngën e ruajtur. Ndryshimet ruhen vetëm kur shtyp Ruaj.');
}
function sanitizeStanzas(value:Stanza[]|undefined):Stanza[]{
  const valid=(value??[]).filter(s=>Number.isFinite(s.start)&&s.start>=0&&typeof s.label==='string'&&s.label.trim())
    .map(s=>({start:Math.round(s.start),label:s.label.slice(0,65),color:/^#[0-9a-f]{6}$/i.test(s.color??'')?s.color:undefined}))
    .sort((a,b)=>a.start-b.start);
  const unique=valid.filter((s,i,a)=>i===0 || s.start!==a[i-1].start);
  return [{start:0,label:unique.find(s=>s.start===0)?.label||'Grupi 1',color:unique.find(s=>s.start===0)?.color||GROUP_COLORS[0]},
    ...unique.filter(s=>s.start>0).map((s,i)=>({...s,color:s.color||GROUP_COLORS[(i+1)%GROUP_COLORS.length]}))].slice(0,90);
}
function autoStanzas(hits:GuessedHit[]):Stanza[]{
  const sensitivity=$<HTMLSelectElement>('groupSensitivity').value as GroupSensitivity;
  return detectNoteGroups(hits,3,sensitivity);
}
function groupColorAt(time:number):string{
  const i=groupAtTime(stanzas,time);
  return stanzas[i]?.color||STANZA_COLORS[i%STANZA_COLORS.length];
}
function colorForHit(hit:GuessedHit):string{
  const i=groupForNote(stanzas,hit);
  return stanzas[i]?.color||STANZA_COLORS[i%STANZA_COLORS.length];
}
function moveHitGroup(hit:GuessedHit,direction:-1|1):void{
  const index=groupForNote(stanzas,hit);
  const destination=stanzas[index+direction];
  if(!destination){setStatus(direction<0?'Kjo notë është në grupin e parë.':'Kjo notë është në grupin e fundit.');return;}
  hit.groupStart=destination.start;
  selectedImportedHit=hit;selectedGroupStart=destination.start;
  const groupOrder=stanzas.flatMap((_,i)=>importedHits.filter(h=>groupForNote(stanzas,h)===i).sort((a,b)=>a.time-b.time));
  analysisRowsVisible=Math.max(analysisRowsVisible,groupOrder.indexOf(hit)+1);
  updateImportDraft();renderImportedHits();
  document.querySelector<HTMLElement>('.analysis-note-row.is-selected')?.scrollIntoView({block:'nearest'});
  setStatus(`Nota u zhvendos te ${destination.label} dhe mori ngjyrën e tij. Koha mbeti ${fmt(hit.time)}.`);
}
function createGroupAtHit(hit:GuessedHit):void{
  const start=Math.round(hit.time);
  if(!draft?.originalAudioId || !importedHits.includes(hit))return;
  if(start<=0){setStatus('Grupi i parë fillon në 0 ms. Zgjidh një notë tjetër.');return;}
  if(stanzas.length>=90){setStatus('U arrit numri maksimal i grupeve.');return;}
  const existing=stanzas.find(s=>s.start===start);
  if(existing){hit.groupStart=existing.start;selectedGroupStart=existing.start;setStatus('Grupi ekziston tashmë. U zgjodh ai grup.');}
  else{
    const index=stanzas.findIndex(s=>s.start>start);
    const position=index<0?stanzas.length:index;
    stanzas.push({start,label:`Grupi ${stanzas.length+1}`,color:GROUP_COLORS[position%GROUP_COLORS.length]});
    stanzas=sanitizeStanzas(stanzas);
    hit.groupStart=start;selectedGroupStart=start;
    focusTimelineAt(start);
    setStatus(`U krijua grupi i ri në ${fmt(start)}. Kufiri i tij shihet tani te Tablatura.`);
  }
  selectedImportedHit=hit;
  const groupOrder=stanzas.flatMap((_,i)=>importedHits.filter(h=>groupForNote(stanzas,h)===i).sort((a,b)=>a.time-b.time));
  analysisRowsVisible=Math.max(analysisRowsVisible,groupOrder.indexOf(hit)+1);
  updateImportDraft();renderImportedHits();
}
function renderStanzas():void{
  const target=$('stanzaList');target.replaceChildren();
  stanzas=sanitizeStanzas(stanzas);
  if(!stanzas.some(g=>g.start===selectedGroupStart))selectedGroupStart=stanzas[0].start;
  for(let i=0;i<stanzas.length;i++){
    const s=stanzas[i];const row=document.createElement('div');row.className='stanza-entry';row.style.setProperty('--stanza-color',s.color||STANZA_COLORS[i%STANZA_COLORS.length]);
    row.dataset.groupStart=String(s.start);row.classList.toggle('group-active',s.start===selectedGroupStart);
    const label=document.createElement('input');label.type='text';label.maxLength=65;label.value=s.label;
    label.setAttribute('aria-label',`Emri i grupit ${i+1}`);
    label.addEventListener('change',()=>{s.label=label.value.trim()||`Grupi ${i+1}`;updateImportDraft();renderImportedHits();});
    const time=document.createElement('input');time.type='number';time.min='0';time.step='1';time.value=String(s.start);time.disabled=i===0;
    time.setAttribute('aria-label',`Fillimi i grupit ${i+1} në milisekonda`);
    time.addEventListener('change',()=>{
      const index=stanzas.findIndex(g=>g.start===s.start);
      applyGroupMarkerPosition(index,Number(time.value));
    });
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-minimal';remove.textContent='×';remove.disabled=i===0;
    remove.setAttribute('aria-label',`Fshi ndarjen e grupit ${i+1}`);
    remove.addEventListener('click',()=>{
      // Grupet e fshira nuk duhet të lënë referenca të vdekura në notat e ruajtura.
      for(const hit of importedHits)if(hit.groupStart===s.start)delete hit.groupStart;
      stanzas=stanzas.filter(x=>x!==s);updateImportDraft();renderImportedHits();
    });
    const choose=document.createElement('button');choose.type='button';choose.className='btn btn-minimal group-choose';
    choose.textContent=s.start===selectedGroupStart?'✓ Zgjedhur':'Zgjidh';choose.setAttribute('aria-label',`Zgjidh ${s.label}`);
    choose.addEventListener('click',()=>{selectGroup(s.start);renderStanzas();});
    const color=document.createElement('input');color.type='color';color.className='group-color-picker';color.value=s.color||GROUP_COLORS[i%GROUP_COLORS.length];color.setAttribute('aria-label',`Ngjyra e grupit ${i+1}`);
    color.addEventListener('change',()=>{s.color=color.value;updateImportDraft();renderImportedHits();});
    row.append(label,time,color,choose,remove);target.append(row);
  }
}
/** Importimi ruan skedarin e plotë, ndërsa notat e zbuluara mbeten propozime të korrigjueshme. */
function updateImportDraft():void {
  if(!draft?.originalAudioId)return;
  draft.notes=importedHits.filter(h=>h.noteNumber!==null).map(h=>({
    time:Math.round(h.time),noteNumber:h.noteNumber!,string:(h.noteNumber===14?2:1) as 1|2,
    confidence:h.confidence,withF:h.noteNumber===14?undefined:h.withF!==false,
    ...(Number.isFinite(h.groupStart)?{groupStart:h.groupStart}:{})
  })).sort((a,b)=>a.time-b.time||a.string-b.string);
  draft.stanzas=sanitizeStanzas(stanzas);
  renderSongs();renderManualMode();
}
/** Notat shtohen te pozicioni i zgjedhur në listë, jo te koha e riprodhuesit. */
function selectImportedHit(hit:GuessedHit):void {
  selectedImportedHit=hit;
  selectedGroupStart=stanzas[groupForNote(stanzas,hit)]?.start??0;
  $<HTMLSelectElement>('selectedGroupSelect').value=String(selectedGroupStart);
  document.querySelectorAll('.stanza-entry').forEach(el=>el.classList.toggle('group-active',(el as HTMLElement).dataset.groupStart===String(selectedGroupStart)));
  document.querySelectorAll('.analysis-note-row.is-selected').forEach(row=>row.classList.remove('is-selected'));
  document.querySelectorAll('.analysis-note-row').forEach(row=>{
    if((row as HTMLElement).dataset.noteIndex===String(importedHits.indexOf(hit)))row.classList.add('is-selected');
  });
  $('analysisAddBtn').toggleAttribute('disabled',false);
  $('stanzaAddBtn').toggleAttribute('disabled',false);
  $('selectedNoteHint').textContent=`Nota e zgjedhur: ${hit.noteNumber??'?'} · ${fmt(hit.time)}. Butoni + shton notë poshtë këtij rreshti.`;
}
function insertNoteBelow(hit:GuessedHit):void {
  if(!draft?.originalAudioId)return;
  importedHits.sort((a,b)=>a.time-b.time);
  const index=importedHits.indexOf(hit);
  if(index<0)return;
  const sameGroup=importedHits.filter(h=>groupForNote(stanzas,h)===groupForNote(stanzas,hit)).sort((a,b)=>a.time-b.time);
  const following=sameGroup[sameGroup.indexOf(hit)+1]||importedHits[index+1];
  // Koha vendoset mes dy goditjeve; nëse janë njëkohësisht, ruajmë të njëjtën kohë.
  const durationMs=Number.isFinite(originalPlayer.duration)?Math.round(originalPlayer.duration*1000):3_600_000;
  const nextTime=following?(following.time>hit.time+1?Math.floor((hit.time+following.time)/2):hit.time):Math.min(durationMs,hit.time+200);
  const newHit:GuessedHit={time:nextTime,noteNumber:null,string:1,withF:true,
    groupStart:stanzas[groupForNote(stanzas,hit)]?.start,
    confidence:0,detail:'Shtuar pas notës së zgjedhur'};
  importedHits.splice(index+1,0,newHit);
  selectedImportedHit=newHit;
  analysisRowsVisible=Math.max(analysisRowsVisible,index+2);
  updateImportDraft();renderImportedHits();
  // Fokuso fushën e perdes së notës së re për ta plotësuar menjëherë.
  const selected=document.querySelector<HTMLElement>('.analysis-note-row.is-selected');
  selected?.scrollIntoView({block:'nearest'});
  selected?.querySelector<HTMLInputElement>('.analysis-fret')?.focus({preventScroll:true});
  setStatus('Nota e re u shtua poshtë notës së zgjedhur. Vendos numrin e perdes.');
}
function renderImportedHits():void {
  const editor=$('analysisEdit'),rows=$('analysisRows');rows.replaceChildren();
  editor.hidden=selectedId!=='__draft' || !draft?.originalAudioId;
  const editable=selectedId==='__draft' && !!draft?.originalAudioId;
  if(!importedHits.includes(selectedImportedHit as GuessedHit))selectedImportedHit=null;
  $('analysisAddBtn').toggleAttribute('disabled',!editable || !selectedImportedHit);
  $('stanzaAddBtn').toggleAttribute('disabled',!editable || !selectedImportedHit);
  $('groupAutoBtn').toggleAttribute('disabled',!editable || importedHits.length<3);
  if(!editable){$('stanzaList').replaceChildren();$('selectedNoteHint').textContent='Prek një notë për ta zgjedhur.';return;}
  $('selectedNoteHint').textContent=selectedImportedHit?`Nota e zgjedhur: ${selectedImportedHit.noteNumber??'?'} · ${fmt(selectedImportedHit.time)}`:'Prek një rresht note që ta zgjedhësh, pastaj shto notën poshtë saj.';
  const unknown=importedHits.filter(h=>h.noteNumber===null).length;
  $('analysisCount').textContent=`${importedHits.length} goditje · ${unknown} për t’u plotësuar`;
  importedHits.sort((a,b)=>a.time-b.time);
  renderStanzas();
  // Shfaq notat brenda grupit ku i ka vendosur përdoruesi, edhe kur audioja është më herët.
  const grouped=stanzas.flatMap((_,groupIndex)=>importedHits
    .filter(hit=>groupForNote(stanzas,hit)===groupIndex).sort((a,b)=>a.time-b.time));
  const visible=grouped.slice(0,analysisRowsVisible);
  let previousStanza=-1;
  visible.forEach((hit)=>{
    const assignedGroup=groupForNote(stanzas,hit);
    if(assignedGroup!==previousStanza){
      const group=stanzas[assignedGroup];
      const title=document.createElement('div');title.className='stanza-divider';title.style.setProperty('--stanza-color',group.color||STANZA_COLORS[assignedGroup%STANZA_COLORS.length]);
      title.textContent=`${group.label} · ${fmt(group.start)}`;
      title.classList.toggle('group-active',group.start===selectedGroupStart);
      title.addEventListener('click',()=>{selectGroup(group.start);renderImportedHits();});
      rows.append(title);previousStanza=assignedGroup;
    }
    const row=document.createElement('div');row.className='analysis-note-row';
    row.style.setProperty('--group-color',colorForHit(hit));
    if(groupAtTime(stanzas,hit.time)!==assignedGroup){
      row.classList.add('group-moved');
      row.title=`Nota është në ${stanzas[assignedGroup].label}, me kohën origjinale ${fmt(hit.time)}.`;
    }
    row.dataset.noteIndex=String(importedHits.indexOf(hit));
    if(hit===selectedImportedHit)row.classList.add('is-selected');
    row.addEventListener('pointerdown',()=>selectImportedHit(hit));
    row.addEventListener('focusin',()=>selectImportedHit(hit));
    if(hit.noteNumber===null)row.classList.add('unknown');
    const ms=document.createElement('input');ms.type='number';ms.min='0';ms.step='1';
    ms.max=String(Math.round((originalPlayer.duration||150)*1000));ms.value=String(hit.time);
    ms.setAttribute('aria-label','Koha në milisekonda');
    const fret=document.createElement('input');fret.type='number';fret.min='1';fret.max='15';fret.step='1';
    fret.placeholder='Perdja';fret.classList.add('analysis-fret');fret.setAttribute('aria-label','Perdja 1–13; 14 F; 15 i hapur poshtë');
    fret.value=hit.noteNumber===null?'':String(hit.noteNumber);
    const fLabel=document.createElement('label');fLabel.className='f-companion';
    const fCheck=document.createElement('input');fCheck.type='checkbox';fCheck.checked=hit.noteNumber!==14&&hit.withF!==false;fCheck.disabled=hit.noteNumber===14;
    fCheck.setAttribute('aria-label','Teli F shoqërues për këtë notë');
    fCheck.addEventListener('change',()=>{hit.withF=fCheck.checked;updateImportDraft();});
    fLabel.append(fCheck,document.createTextNode(' F'));
    const status=document.createElement('span');status.className='analysis-confidence';
    status.textContent=hit.noteNumber===null?'?':hit.confidence<.65?'Kontrollo':'✓';status.title=hit.detail;
    const seek=document.createElement('button');seek.type='button';seek.className='btn btn-minimal';seek.textContent='▶';seek.title='Dëgjo nga kjo goditje';
    seek.addEventListener('click',()=>{originalPlayer.currentTime=hit.time/1000;void originalPlayer.play().catch(e=>setStatus(String(e)));});
    const plus=document.createElement('button');plus.type='button';plus.className='btn btn-minimal';plus.textContent='+';plus.title='Shto notë direkt poshtë kësaj note';
    plus.addEventListener('click',()=>insertNoteBelow(hit));
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-minimal';remove.textContent='×';remove.title='Fshi goditjen';
    remove.addEventListener('click',()=>{if(selectedImportedHit===hit)selectedImportedHit=null;importedHits=importedHits.filter(x=>x!==hit);updateImportDraft();renderImportedHits();});
    const up=document.createElement('button');up.type='button';up.className='btn btn-minimal move-group';
    up.textContent='↑';up.disabled=assignedGroup===0;up.title='Kalo notën te grupi sipër';up.setAttribute('aria-label',up.title);
    up.addEventListener('click',()=>moveHitGroup(hit,-1));
    const down=document.createElement('button');down.type='button';down.className='btn btn-minimal move-group';
    down.textContent='↓';down.disabled=assignedGroup===stanzas.length-1;down.title='Kalo notën te grupi poshtë';down.setAttribute('aria-label',down.title);
    down.addEventListener('click',()=>moveHitGroup(hit,1));
    const split=document.createElement('button');split.type='button';split.className='btn btn-minimal stanza-split';split.textContent='Grup';split.title='Krijo grup të ri me këtë notë si fillim';
    split.addEventListener('click',()=>createGroupAtHit(hit));
    ms.addEventListener('change',()=>{hit.time=Math.max(0,Math.min(Math.round((originalPlayer.duration||150)*1000),Math.round(Number(ms.value)||0)));updateImportDraft();renderImportedHits();});
    fret.addEventListener('change',()=>{
      const value=fret.value.trim(),n=value===''?null:Number(value);
      if(n!==null&&(!Number.isInteger(n)||n<1||n>15)){setStatus('Zgjidh perden 1–13, 14 (F), ose 15 (i hapur).');fret.value=hit.noteNumber===null?'':String(hit.noteNumber);return;}
      hit.noteNumber=n;hit.string=n===14?2:1;hit.confidence=n===null?0:1;
      hit.detail=n===null?'Pa notë':'Korrigjuar manualisht';updateImportDraft();renderImportedHits();
    });
    row.append(ms,fret,fLabel,status,seek,plus,remove,up,down,split);rows.append(row);
  });
  $('analysisMoreBtn').hidden=analysisRowsVisible>=grouped.length;
}
async function importAudioFile(file:File):Promise<void>{
  if(analyzing)return;
  if(file.size>25_000_000){setStatus('Audioja është mbi 25 MB. Përdor regjistrim më të shkurtër.');return;}
  if(!file.type.startsWith('audio/') && !/\.(wav|m4a|mp3|ogg)$/i.test(file.name)){setStatus('Zgjidh skedar audio WAV, M4A ose MP3.');return;}
  stopPlayback();manualPending=null;manualMode=true;selectedGroupStart=0;tabCurrentMs=0;tabViewStartMs=0;tabFollowPlayback=true;importFile=file;importedHits=[];selectedImportedHit=null;stanzas=[{start:0,label:'Grupi 1',color:GROUP_COLORS[0]}];editingSongId=null;analysisRowsVisible=60;
  draft=newSong(file.name.replace(/\.[^.]+$/,''),[]);draft.originalAudioId='__draft';draft.stanzas=stanzas;selectedId='__draft';
  renderSongs();renderImportedHits();showOriginalBlob(file,'__draft');
  $('analyzeBtn').removeAttribute('disabled');$('analysisProgress').setAttribute('value','0');
  $('analysisStatus').textContent='Audioja është gati. Luaj dhe prek tablaturën te çdo notë. Onset Detection është opsionale.';
  renderManualMode();
  setStatus('Audioja është ngarkuar. Shënimi manual është aktiv: Luaj, prek tablaturën dhe zgjidh perden.');
}
async function analyzeImported():Promise<void>{
  if(!importFile||analyzing)return;
  if(importedHits.length && !confirm('Ta analizojmë përsëri? Korrigjimet manuale të paruajtura do të zëvendësohen.'))return;
  cancelManualNote();analyzing=true;$('analyzeBtn').setAttribute('disabled','');$('audioImportFile').setAttribute('disabled','');
  try{
    const ctx=await audio.unlock();
    const decoded=await ctx.decodeAudioData((await importFile.arrayBuffer()).slice(0));
    const report=await analyzeAudio(decoded,(n,intensity)=>audio.loadNote(n,intensity),(s,pct)=>{
      $('analysisStatus').textContent=s;$<HTMLProgressElement>('analysisProgress').value=pct;
    });
    importedHits=report.hits.map(h=>({...h,withF:true}));selectedImportedHit=null;analysisRowsVisible=60;
    stanzas=autoStanzas(importedHits);
    updateImportDraft();renderImportedHits();
    setStatus(`U gjetën ${report.detectedOnsets} goditje të mundshme. ${report.uncertainCount} janë të pasigurta. U propozuan ${stanzas.length} grupe sipas pauzave; kontrolloji para Ruaj.`);
  }catch(e){$('analysisStatus').textContent='Analiza nuk përfundoi.';setStatus('Gabim në analizë: '+String(e));}
  finally{analyzing=false;$('analyzeBtn').toggleAttribute('disabled',!importFile);$('audioImportFile').removeAttribute('disabled');}
}
let deferredInstall:Event|null=null;
function installAndroid():void {
  const promptEvent=deferredInstall as (Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>})|null;
  if(!promptEvent){setStatus('Në Android: Chrome → ⋮ → Shto në ekranin kryesor / Instalo aplikacionin.');return;}
  void promptEvent.prompt().then(()=>promptEvent.userChoice).then(()=>{deferredInstall=null;$('installBtn').hidden=true;}).catch(()=>{});
}

function init():void {
  installTabInteraction();
  $('manualModeBtn').addEventListener('click',()=>{
    if(!editableTab()){
      const song=currentSong();
      if(importedSong(song)&&selectedId!=='__draft'){
        void editSavedAudio().then(()=>{manualMode=true;renderManualMode();setStatus('Shënimi manual është aktiv te kënga e ruajtur.');});
      }else setStatus('Importo këngë audio që të shënosh notat me dorë.');
      return;
    }
    setManualMode(!manualMode);
  });
  $('manualFretSelect').addEventListener('change',()=>{
    const n=Number($<HTMLSelectElement>('manualFretSelect').value);
    const f=$<HTMLInputElement>('manualFCompanion');const wasDisabled=f.disabled;
    f.disabled=n===14;if(n===14)f.checked=false;
    else if(n>0&&wasDisabled)f.checked=true;
  });
  $('manualSetBtn').addEventListener('click',()=>commitManualNote(false));
  $('manualContinueBtn').addEventListener('click',()=>commitManualNote(true));
  $('manualCancelBtn').addEventListener('click',cancelManualNote);
  $('manualClearBtn').addEventListener('click',()=>{
    if(!editableTab()||!importedHits.length)return;
    if(!confirm('Të fshihen të gjitha notat e kësaj prove? Audioja origjinale dhe grupet mbeten.'))return;
    cancelManualNote();importedHits=[];selectedImportedHit=null;updateImportDraft();renderImportedHits();renderManualMode();
    setStatus('U pastruan notat e provës. Ndryshimi ruhet vetëm kur shtyp Ruaj.');
  });
  renderManualMode();
  renderInstrument();renderKeys();renderSongs();renderMicHits();
  audio.setVolume(Number($<HTMLInputElement>('volume').value)/100);
  $('songSelect').addEventListener('change',e=>{stopPlayback();manualPending=null;manualMode=false;renderManualMode();selectedGroupStart=0;tabViewStartMs=0;tabCurrentMs=0;tabFollowPlayback=true;selectedId=(e.target as HTMLSelectElement).value;renderSongs();renderImportedHits();void prepareOriginalForSelection();});
  $('recordBtn').addEventListener('click',recordKeyboard);
  $('micBtn').addEventListener('click',()=>void toggleMic());
  $('playBtn').addEventListener('click',()=>void toggleTabPlay());
  $('groupPlayBtn').addEventListener('click',()=>void playSelectedGroup());
  $('selectedGroupSelect').addEventListener('change',e=>selectGroup(Number((e.target as HTMLSelectElement).value)));
  $('playbackSpeed').addEventListener('change',e=>{
    if(audio.playing)seekToMs(playbackPositionMs()); // Ndalo planifikimin e vjetër para ndryshimit të shpejtësisë.
    playbackSpeed=Number((e.target as HTMLSelectElement).value)===0.5?0.5:1;
    configurePlaybackSpeed();
    setStatus(`Shpejtësia: ${playbackSpeed.toFixed(2)}×`);
  });
  $('stopBtn').addEventListener('click',()=>{stopPlayback();if(micActive)stopMic();if(keyboardRecordStart!==null)recordKeyboard();seekToMs(0);setStatus('Ndaluar në fillim.');});
  $('saveBtn').addEventListener('click',()=>void saveDraft());
  $('deleteBtn').addEventListener('click',()=>void deleteSong());
  $('exportBtn').addEventListener('click',()=>{const song=currentSong();if(song)exportSong(song);});
  $('importBtn').addEventListener('click',()=>$<HTMLInputElement>('importFile').click());
  $('importFile').addEventListener('change',()=>{const input=$<HTMLInputElement>('importFile');if(input.files?.[0])void importSongFile(input.files[0]);input.value='';});
  $('audioImportFile').addEventListener('change',()=>{const input=$<HTMLInputElement>('audioImportFile');if(input.files?.[0])void importAudioFile(input.files[0]);input.value='';});
  $('analyzeBtn').addEventListener('click',()=>void analyzeImported());
  $('analysisEditSavedBtn').addEventListener('click',()=>void editSavedAudio());
  $('stanzaAddBtn').addEventListener('click',()=>{
    if(!draft?.originalAudioId||!selectedImportedHit)return;
    createGroupAtHit(selectedImportedHit);
  });
  $('groupAutoBtn').addEventListener('click',()=>{
    if(!draft?.originalAudioId || !importedHits.length)return;
    if(stanzas.length>1 && !confirm('Të zëvendësohen ndarjet e grupeve me ato të zbuluara nga pauzat?'))return;
    // Rigrupimi automatik e rivendos anëtarësinë sipas kohës; zgjedhjet manuale zëvendësohen.
    importedHits.forEach(h=>delete h.groupStart);
    stanzas=autoStanzas(importedHits);selectedGroupStart=0;updateImportDraft();renderImportedHits();
    setStatus(`U ndanë ${stanzas.length} grupe sipas pauzave. Mund t’i korrigjosh vetë.`);
  });
  $('analysisAddBtn').addEventListener('click',()=>{
    if(!draft?.originalAudioId||!selectedImportedHit){setStatus('Prek së pari një notë në listë.');return;}
    insertNoteBelow(selectedImportedHit);
  });
  $('analysisMoreBtn').addEventListener('click',()=>{analysisRowsVisible+=60;renderImportedHits();});
  originalPlayer.addEventListener('loadedmetadata',()=>{
    if(seekPendingUntilMetadata!==null){
      originalPlayer.currentTime=Math.min(originalPlayer.duration,seekPendingUntilMetadata/1000);seekPendingUntilMetadata=null;
    }
    redrawTab();syncTabTransport();
  });
  originalPlayer.addEventListener('play',()=>{
    const song=currentSong();if(!importedSong(song))return;
    audio.stop();cancelAnimationFrame(playFrame);const token=++playToken;
    $('playBtn').textContent=currentPlayMode==='group'?'▶ Luaj':'▶ Po luhet';$('studioState').textContent=currentPlayMode==='group'?'GRUPI':'ORIGJINAL';
    const tick=()=>{
      if(token!==playToken||originalPlayer.paused)return;
      const ms=originalPlayer.currentTime*1000;
      if(currentPlayMode==='group'&&activeGroupEndMs!==null&&ms>=activeGroupEndMs-12){completeGroupPlayback();return;}
      drawTab(song,ms);
      $('timeLabel').textContent=`${fmt(ms)} / ${fmt((originalPlayer.duration||0)*1000)}`;
      const now=song!.notes.filter(n=>Math.abs(n.time-ms)<70);
      if(now.length)showActive(now);
      playFrame=requestAnimationFrame(tick);
    };tick();
    setStatus('Po luhet regjistrimi origjinal. 220 Hz nuk shtohet artificialisht.');
  });
  originalPlayer.addEventListener('pause',()=>{cancelAnimationFrame(playFrame);if(importedSong(currentSong())){$('playBtn').textContent='▶ Luaj';$('studioState').textContent='PAUZË';syncTabTransport();}});
  originalPlayer.addEventListener('ended',()=>{stopPlayback();setStatus('Kënga origjinale përfundoi.');});
  originalPlayer.addEventListener('timeupdate',()=>{
    const song=currentSong();if(!importedSong(song))return;
    const ms=originalPlayer.currentTime*1000;
    if(currentPlayMode==='group'&&activeGroupEndMs!==null&&ms>=activeGroupEndMs-12){completeGroupPlayback();return;}
    drawTab(song,ms);
    $('timeLabel').textContent=`${fmt(ms)} / ${fmt((originalPlayer.duration||0)*1000)}`;
    const active=song!.notes.filter(n=>Math.abs(n.time-ms)<65);
    if(active.length)showActive(active);
  });
  $('installBtn').addEventListener('click',installAndroid);
  window.addEventListener('beforeinstallprompt',(e:Event)=>{e.preventDefault();deferredInstall=e;$('installBtn').hidden=false;});
  if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('./sw.js').catch(()=>{});});
  $('volume').addEventListener('input',e=>{const value=Number((e.target as HTMLInputElement).value);audio.setVolume(value/100);$('volumeOut').textContent=`${value}%`;});
  $('soundMode').addEventListener('change',e=>{audio.mode=(e.target as HTMLSelectElement).value==='full'?'full':'short';});
  $('strengthMode').addEventListener('change',e=>{audio.strength=(e.target as HTMLSelectElement).value==='lehte'?'lehte':'fort';});
  $('lowCut').addEventListener('change',()=>mic.setFilters(filterOptions()));
  $('sensitivity').addEventListener('input',()=>{mic.setSensitivity(filterOptions().sensitivity);$('sensitivityOut').textContent=$<HTMLInputElement>('sensitivity').value;});
  window.addEventListener('keydown',e=>{
    if(e.repeat||e.altKey||e.metaKey||e.ctrlKey||['INPUT','TEXTAREA','SELECT'].includes((document.activeElement?.tagName||'')))return;
    const index=KEYS.indexOf(e.key.toLowerCase());if(index>=0){e.preventDefault();void hit(index+1,1);}
    if(e.code==='Space'){e.preventDefault();void toggleTabPlay();}
  });
  window.addEventListener('resize',()=>renderTimeline());
  window.addEventListener('pagehide',()=>{if(micActive)mic.stop();audio.stop();originalPlayer.pause();});
  $('status').textContent='Gati për të luajtur.';
  // Marrja e regjistrimeve nuk nis zërin pa një veprim të përdoruesit.
  void audio.prepare();
}
init();
window.dispatchEvent(new Event('ciftelia-studio-ready'));
