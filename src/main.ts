import {AudioEngine} from './audio-engine.js';
import {MicrophoneRecorder,DetectedHit,FilterOptions} from './microphone.js';
import {KEYS,HZ,DEMO,Song,NoteEvent,Stanza,labelFor,fmt,withOpenF} from './constants.js';
import {allSongs,loadSongs,newSong,saveSongs,exportSong} from './songs.js';
import {analyzeAudio,GuessedHit} from './analysis.js';
import {putOriginal,getOriginal,deleteOriginal} from './local-audio.js';
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
let stanzas:Stanza[]=[{start:0,label:'Strofa 1'}];
function importedSong(song:Song|null):boolean{return !!song?.originalAudioId;}
function clearOriginalUrl():void { if(originalObjectUrl)URL.revokeObjectURL(originalObjectUrl);originalObjectUrl=null;originalSourceId=null;originalPlayer.removeAttribute('src');originalPlayer.load(); }
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
function stopPlayback():void {playToken++;cancelAnimationFrame(playFrame);audio.stop();originalPlayer.pause();showActive([]);$('playBtn').textContent='▶ Luaj';$('studioState').textContent='GATI';}
async function playCurrent():Promise<void> {
  if(micActive){setStatus('Ndalo mikrofonin para luajtjes.');return;}
  if(keyboardRecordStart!==null)recordKeyboard();
  stopPlayback();
  const song=currentSong();if(!song){setStatus('Zgjidh këngën.');return;}
  if(!song.notes.length && !importedSong(song)){setStatus('Kënga nuk ka nota të njohura. Korrigjo notat ? te regjistrimi.');return;}
  const token=++playToken;
  if(importedSong(song)){
    if(!originalPlayer.src){setStatus('Mungon audioja origjinale në këtë pajisje. Zgjidh këngën sërish.');return;}
    try {await originalPlayer.play();}
    catch(e){setStatus('Shfletuesi nuk nisi audion: '+String(e));$('playBtn').textContent='▶ Luaj';}
    return;
  }
  $('playBtn').textContent='… Po ngarkohet';$('studioState').textContent='NGARKIM';
  try {
    await audio.play(song);
    if(token!==playToken)return;
    $('playBtn').textContent='▶ Po luhet';$('studioState').textContent='DUKE LUAJTUR';
    setStatus(`Po luhet ${song.name} · ${song.notes.length} nota`);
    const loop=()=>{
      if(token!==playToken)return;
      const ms=audio.elapsedMs;
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
function drawTab(song:Song|null,elapsed=0):void {
  const rect=canvas.getBoundingClientRect();const w=Math.max(320,rect.width),h=175;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);
  c.clearRect(0,0,w,h);c.fillStyle='#101c2c';c.fillRect(0,0,w,h);
  const x0=Math.min(160,w*.3),pxPerMs=.18;
  c.strokeStyle='#37465a';c.lineWidth=1;
  for(const y of [60,120]){c.beginPath();c.moveTo(16,y);c.lineTo(w-16,y);c.stroke();}
  c.fillStyle='#95a4b5';c.font='12px system-ui';c.fillText('TELI 2 · LART',14,45);c.fillText('TELI 1 · POSHTË',14,106);
  if(song?.stanzas?.length){
    const selected=[...song.stanzas].filter(s=>s.start<=elapsed).at(-1)??song.stanzas[0];
    c.fillStyle='#e7bc78';c.font='bold 11px system-ui';c.fillText(selected.label.slice(0,48),x0+9,15);
    for(const stanza of song.stanzas.slice(1)){
      const sx=x0+(stanza.start-elapsed)*pxPerMs;
      if(sx>=16&&sx<=w-16){c.strokeStyle='#8291a2';c.setLineDash([4,5]);c.beginPath();c.moveTo(sx,23);c.lineTo(sx,154);c.stroke();c.setLineDash([]);}
    }
  }
  c.strokeStyle='#fac35f';c.lineWidth=2;c.beginPath();c.moveTo(x0,20);c.lineTo(x0,160);c.stroke();
  if(song){
    for(const e of withOpenF(song.notes)){
      const x=x0+(e.time-elapsed)*pxPerMs;
      if(x<8||x>w-8)continue;
      const y=e.string===1?120:60;
      c.beginPath();c.arc(x,y,11,0,Math.PI*2);
      c.fillStyle=Math.abs(e.time-elapsed)<60?'#f2b657':'#203f4f';c.fill();
      c.strokeStyle='#f2b657';c.lineWidth=1;c.stroke();
      c.fillStyle=Math.abs(e.time-elapsed)<60?'#141e2b':'#f6e6ca';c.font='bold 12px system-ui';c.textAlign='center';c.fillText(labelFor(e.noteNumber),x,y+4);c.textAlign='start';
    }
  }else{c.font='14px system-ui';c.fillStyle='#8d9bac';c.fillText('Regjistro ose zgjidh një këngë.',x0+18,90);}
}
function renderTimeline(){drawTab(songForDisplay(),0);$('timeLabel').textContent=`00:00.00 / ${fmt((songForDisplay()?.notes.at(-1)?.time||0)+600)}`;}

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
      return {string:n.string as 1|2,noteNumber:n.noteNumber as number,time:n.time as number,withF:n.withF!==false};
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
  stopPlayback(); editingSongId=song.id; importFile=null; $('analyzeBtn').setAttribute('disabled','');
  draft={...song,notes:song.notes.map(n=>({...n}))};
  stanzas=sanitizeStanzas(song.stanzas);
  importedHits=song.notes.map(n=>({time:n.time,noteNumber:n.noteNumber,string:n.string,confidence:n.confidence??1,withF:n.withF!==false,detail:'Ruajtur'}));
  analysisRowsVisible=60; selectedId='__draft';
  renderSongs();renderImportedHits();await prepareOriginalForSelection();
  setStatus('Po redakton këngën e ruajtur. Ndryshimet ruhen vetëm kur shtyp Ruaj.');
}
function sanitizeStanzas(value:Stanza[]|undefined):Stanza[]{
  const valid=(value??[]).filter(s=>Number.isFinite(s.start)&&s.start>=0&&typeof s.label==='string'&&s.label.trim())
    .map(s=>({start:Math.round(s.start),label:s.label.slice(0,65)})).sort((a,b)=>a.start-b.start);
  return [{start:0,label:valid.find(s=>s.start===0)?.label || 'Strofa 1'},...valid.filter(s=>s.start>0)].slice(0,60);
}
function autoStanzas(hits:GuessedHit[]):Stanza[]{
  const out:Stanza[]=[{start:0,label:'Strofa 1'}];
  const sorted=[...hits].sort((a,b)=>a.time-b.time);
  let lastStart=0,lastIndex=0;
  for(let i=1;i<sorted.length;i++){
    if(sorted[i].time-sorted[i-1].time>=1650&&i-lastIndex>=4&&sorted[i].time-lastStart>=3800){
      out.push({start:sorted[i].time,label:`Strofa ${out.length+1}`});
      lastStart=sorted[i].time;lastIndex=i;
    }
  }
  return out;
}
function renderStanzas():void{
  const target=$('stanzaList');target.replaceChildren();
  stanzas=sanitizeStanzas(stanzas);
  for(let i=0;i<stanzas.length;i++){
    const s=stanzas[i];const row=document.createElement('div');row.className='stanza-entry';
    const label=document.createElement('input');label.type='text';label.maxLength=65;label.value=s.label;
    label.setAttribute('aria-label',`Emri i strofës ${i+1}`);
    label.addEventListener('change',()=>{s.label=label.value.trim()||`Strofa ${i+1}`;updateImportDraft();renderImportedHits();});
    const time=document.createElement('input');time.type='number';time.min='0';time.step='1';time.value=String(s.start);time.disabled=i===0;
    time.setAttribute('aria-label',`Fillimi i strofës ${i+1} në milisekonda`);
    time.addEventListener('change',()=>{s.start=Math.max(0,Math.round(Number(time.value)||0));updateImportDraft();renderImportedHits();});
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-minimal';remove.textContent='×';remove.disabled=i===0;
    remove.setAttribute('aria-label',`Fshi ndarjen e strofës ${i+1}`);
    remove.addEventListener('click',()=>{stanzas=stanzas.filter(x=>x!==s);updateImportDraft();renderImportedHits();});
    row.append(label,time,remove);target.append(row);
  }
}
/** Importimi ruan skedarin e plotë, ndërsa notat e zbuluara mbeten propozime të korrigjueshme. */
function updateImportDraft():void {
  if(!draft?.originalAudioId)return;
  draft.notes=importedHits.filter(h=>h.noteNumber!==null).map(h=>({
    time:Math.round(h.time),noteNumber:h.noteNumber!,string:(h.noteNumber===14?2:1) as 1|2,
    confidence:h.confidence,withF:h.noteNumber===14?undefined:h.withF!==false
  })).sort((a,b)=>a.time-b.time||a.string-b.string);
  draft.stanzas=sanitizeStanzas(stanzas);
  renderSongs();
}
function renderImportedHits():void {
  const editor=$('analysisEdit'),rows=$('analysisRows');rows.replaceChildren();
  editor.hidden=selectedId!=='__draft' || !draft?.originalAudioId;
  const editable=selectedId==='__draft' && !!draft?.originalAudioId;
  $('analysisAddBtn').toggleAttribute('disabled',!editable);
  $('stanzaAddBtn').toggleAttribute('disabled',!editable);
  if(!editable){$('stanzaList').replaceChildren();return;}
  const unknown=importedHits.filter(h=>h.noteNumber===null).length;
  $('analysisCount').textContent=`${importedHits.length} goditje · ${unknown} për t’u plotësuar`;
  importedHits.sort((a,b)=>a.time-b.time||a.string-b.string);
  renderStanzas();
  let previousStanza=-1;
  importedHits.slice(0,analysisRowsVisible).forEach((hit)=>{
    let index=0;for(let i=0;i<stanzas.length;i++)if(stanzas[i].start<=hit.time)index=i;
    if(index!==previousStanza){
      const title=document.createElement('div');title.className='stanza-divider';title.textContent=`${stanzas[index].label} · ${fmt(stanzas[index].start)}`;
      rows.append(title);previousStanza=index;
    }
    const row=document.createElement('div');row.className='analysis-note-row';
    if(hit.noteNumber===null)row.classList.add('unknown');
    const ms=document.createElement('input');ms.type='number';ms.min='0';ms.step='1';
    ms.max=String(Math.round((originalPlayer.duration||150)*1000));ms.value=String(hit.time);
    ms.setAttribute('aria-label','Koha në milisekonda');
    const fret=document.createElement('input');fret.type='number';fret.min='1';fret.max='15';fret.step='1';
    fret.placeholder='Perdja';fret.setAttribute('aria-label','Perdja 1–13; 14 F; 15 i hapur poshtë');
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
    const plus=document.createElement('button');plus.type='button';plus.className='btn btn-minimal';plus.textContent='+';plus.title='Shto goditje pas kësaj';
    plus.addEventListener('click',()=>{
      const following=importedHits.filter(h=>h.time>hit.time).sort((a,b)=>a.time-b.time)[0];
      const nextTime=following?Math.round((hit.time+following.time)/2):hit.time+200;
      importedHits.push({time:nextTime,noteNumber:null,string:1,withF:true,confidence:0,detail:'Shtuar manualisht'});
      analysisRowsVisible=Math.max(analysisRowsVisible,importedHits.length);updateImportDraft();renderImportedHits();
    });
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-minimal';remove.textContent='×';remove.title='Fshi goditjen';
    remove.addEventListener('click',()=>{importedHits=importedHits.filter(x=>x!==hit);updateImportDraft();renderImportedHits();});
    const split=document.createElement('button');split.type='button';split.className='btn btn-minimal stanza-split';split.textContent='Strofë';split.title='Fillo strofë të re këtu';
    split.addEventListener('click',()=>{
      if(hit.time===0||stanzas.some(s=>s.start===hit.time))return;
      stanzas.push({start:hit.time,label:`Strofa ${stanzas.length+1}`});updateImportDraft();renderImportedHits();
    });
    ms.addEventListener('change',()=>{hit.time=Math.max(0,Math.min(Math.round((originalPlayer.duration||150)*1000),Math.round(Number(ms.value)||0)));updateImportDraft();renderImportedHits();});
    fret.addEventListener('change',()=>{
      const value=fret.value.trim(),n=value===''?null:Number(value);
      if(n!==null&&(!Number.isInteger(n)||n<1||n>15)){setStatus('Zgjidh perden 1–13, 14 (F), ose 15 (i hapur).');fret.value=hit.noteNumber===null?'':String(hit.noteNumber);return;}
      hit.noteNumber=n;hit.string=n===14?2:1;hit.confidence=n===null?0:1;
      hit.detail=n===null?'Pa notë':'Korrigjuar manualisht';updateImportDraft();renderImportedHits();
    });
    row.append(ms,fret,fLabel,status,seek,plus,remove,split);rows.append(row);
  });
  $('analysisMoreBtn').hidden=analysisRowsVisible>=importedHits.length;
}
async function importAudioFile(file:File):Promise<void>{
  if(analyzing)return;
  if(file.size>25_000_000){setStatus('Audioja është mbi 25 MB. Përdor regjistrim më të shkurtër.');return;}
  if(!file.type.startsWith('audio/') && !/\.(wav|m4a|mp3|ogg)$/i.test(file.name)){setStatus('Zgjidh skedar audio WAV, M4A ose MP3.');return;}
  stopPlayback();importFile=file;importedHits=[];stanzas=[{start:0,label:'Strofa 1'}];editingSongId=null;analysisRowsVisible=60;
  draft=newSong(file.name.replace(/\.[^.]+$/,''),[]);draft.originalAudioId='__draft';draft.stanzas=stanzas;selectedId='__draft';
  renderSongs();renderImportedHits();showOriginalBlob(file,'__draft');
  $('analyzeBtn').removeAttribute('disabled');$('analysisProgress').setAttribute('value','0');
  $('analysisStatus').textContent='Onset Detection: po kërkohen fillimet e goditjeve…';
  setStatus('Audioja është ngarkuar; analiza nis automatikisht. Mund të korrigjosh çdo notë.');
  void analyzeImported();
}
async function analyzeImported():Promise<void>{
  if(!importFile||analyzing)return;
  if(importedHits.length && !confirm('Ta analizojmë përsëri? Korrigjimet manuale të paruajtura do të zëvendësohen.'))return;
  analyzing=true;$('analyzeBtn').setAttribute('disabled','');$('audioImportFile').setAttribute('disabled','');
  try{
    const ctx=await audio.unlock();
    const decoded=await ctx.decodeAudioData((await importFile.arrayBuffer()).slice(0));
    const report=await analyzeAudio(decoded,(n,intensity)=>audio.loadNote(n,intensity),(s,pct)=>{
      $('analysisStatus').textContent=s;$<HTMLProgressElement>('analysisProgress').value=pct;
    });
    importedHits=report.hits.map(h=>({...h,withF:true}));analysisRowsVisible=60;
    stanzas=autoStanzas(importedHits);
    updateImportDraft();renderImportedHits();
    setStatus(`U gjetën ${report.detectedOnsets} goditje të mundshme. ${report.uncertainCount} janë të pasigurta. Kontrollo para Ruaj.`);
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
  renderInstrument();renderKeys();renderSongs();renderMicHits();
  audio.setVolume(Number($<HTMLInputElement>('volume').value)/100);
  $('songSelect').addEventListener('change',e=>{stopPlayback();selectedId=(e.target as HTMLSelectElement).value;renderSongs();renderImportedHits();void prepareOriginalForSelection();});
  $('recordBtn').addEventListener('click',recordKeyboard);
  $('micBtn').addEventListener('click',()=>void toggleMic());
  $('playBtn').addEventListener('click',()=>void playCurrent());
  $('stopBtn').addEventListener('click',()=>{stopPlayback();if(micActive)stopMic();if(keyboardRecordStart!==null)recordKeyboard();setStatus('Ndaluar.');});
  $('saveBtn').addEventListener('click',()=>void saveDraft());
  $('deleteBtn').addEventListener('click',()=>void deleteSong());
  $('exportBtn').addEventListener('click',()=>{const song=currentSong();if(song)exportSong(song);});
  $('importBtn').addEventListener('click',()=>$<HTMLInputElement>('importFile').click());
  $('importFile').addEventListener('change',()=>{const input=$<HTMLInputElement>('importFile');if(input.files?.[0])void importSongFile(input.files[0]);input.value='';});
  $('audioImportFile').addEventListener('change',()=>{const input=$<HTMLInputElement>('audioImportFile');if(input.files?.[0])void importAudioFile(input.files[0]);input.value='';});
  $('analyzeBtn').addEventListener('click',()=>void analyzeImported());
  $('analysisEditSavedBtn').addEventListener('click',()=>void editSavedAudio());
  $('stanzaAddBtn').addEventListener('click',()=>{
    if(!draft?.originalAudioId)return;
    const current=Math.max(0,Math.round(originalPlayer.currentTime*1000));
    if(current===0||stanzas.some(s=>s.start===current)){setStatus('Zhvendose audion në fillim të strofës së re.');return;}
    stanzas.push({start:current,label:`Strofa ${stanzas.length+1}`});updateImportDraft();renderImportedHits();
  });
  $('analysisAddBtn').addEventListener('click',()=>{
    if(!draft?.originalAudioId)return;
    importedHits.push({time:Math.max(0,Math.round(originalPlayer.currentTime*1000)),noteNumber:null,string:1,withF:true,confidence:0,detail:'Shtuar manualisht'});
    analysisRowsVisible=Math.max(analysisRowsVisible,importedHits.length);updateImportDraft();renderImportedHits();
  });
  $('analysisMoreBtn').addEventListener('click',()=>{analysisRowsVisible+=60;renderImportedHits();});
  originalPlayer.addEventListener('play',()=>{
    const song=currentSong();if(!importedSong(song))return;
    audio.stop();cancelAnimationFrame(playFrame);const token=++playToken;
    $('playBtn').textContent='▶ Po luhet';$('studioState').textContent='ORIGJINAL';
    const tick=()=>{
      if(token!==playToken||originalPlayer.paused)return;
      const ms=originalPlayer.currentTime*1000;
      drawTab(song,ms);
      $('timeLabel').textContent=`${fmt(ms)} / ${fmt((originalPlayer.duration||0)*1000)}`;
      const now=song!.notes.filter(n=>Math.abs(n.time-ms)<70);
      if(now.length)showActive(now);
      playFrame=requestAnimationFrame(tick);
    };tick();
    setStatus('Po luhet regjistrimi origjinal. 220 Hz nuk shtohet artificialisht.');
  });
  originalPlayer.addEventListener('pause',()=>{cancelAnimationFrame(playFrame);if(importedSong(currentSong())){$('playBtn').textContent='▶ Luaj';$('studioState').textContent='PAUZË';}});
  originalPlayer.addEventListener('ended',()=>{stopPlayback();setStatus('Kënga origjinale përfundoi.');});
  originalPlayer.addEventListener('timeupdate',()=>{
    const song=currentSong();if(!importedSong(song))return;
    const ms=originalPlayer.currentTime*1000;drawTab(song,ms);
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
    if(e.code==='Space'){e.preventDefault();void playCurrent();}
  });
  window.addEventListener('resize',()=>renderTimeline());
  window.addEventListener('pagehide',()=>{if(micActive)mic.stop();audio.stop();originalPlayer.pause();});
  $('status').textContent='Gati për të luajtur.';
  // Marrja e regjistrimeve nuk nis zërin pa një veprim të përdoruesit.
  void audio.prepare();
}
init();
