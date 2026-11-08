import {AudioEngine} from './audio-engine.js';
import {MicrophoneRecorder,DetectedHit,FilterOptions} from './microphone.js';
import {KEYS,HZ,DEMO,Song,NoteEvent,Stanza,labelFor,fmt,withOpenF,upperFret,noteFrequency} from './constants.js';
import {allSongs,loadSongs,newSong,saveSongs,exportSong,upsertSong,prefersNotePlayback} from './songs.js';
import {analyzeAudio,GuessedHit} from './analysis.js';
import {putOriginal,getOriginal,deleteOriginal} from './local-audio.js';
import {GROUP_COLORS,detectNoteGroups,groupAtTime,groupForNote,GroupSensitivity} from './grouping.js';
import {timelineGeometry,timelineX,timelineTime,clampTimelineStart,clampGroupBoundary,findGroupBoundary} from './timeline.js';
import {manualTapTime,manualAnywhereTime,manualEntryNote} from './manual.js';
import {notesAtMoment,noteAttackColor} from './practice.js';
import {CopiedGroup,copySongGroup,pasteSongGroup,replaceSongGroup,deleteSongGroup,parseSongJSON} from './song-editing.js';
import {EditHistory,EditorSnapshot} from './edit-history.js';
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
let groupClipboard:CopiedGroup|null=null;
const editHistories=new Map<string,EditHistory>();
let draftBaseline:Song|null=null;
let groupBusy=false;
let pendingGroupDelete:{songId:string;start:number;label:string;count:number}|null=null;
let jsonBaseSong:Song|null=null;
let jsonBaseSelectedId='';
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
let instantTabNoteMode=false;
let manualPending:{time:number;string:1|2}|null=null;
let syntheticStartMs=0;
let seekPendingUntilMetadata:number|null=null;
let lastDisplayKey='';
let playbackSource:'original'|'notes'='original';
const liveAttacks:NoteEvent[]=[];
let tabNoteDrag:{pointerId:number;hit:GuessedHit;startX:number;startTime:number;previewMs:number;moved:boolean}|null=null;


const catalogSongs:Song[]=[];const catalogAudioURLs=new Map<string,string>();
const STANZA_COLORS=GROUP_COLORS;
function importedSong(song:Song|null):boolean{return !!song?.originalAudioId;}
function usingOriginal(song:Song|null):boolean {
  return importedSong(song) && playbackSource==='original' && audio.upperEnabled;
}
function accompaniment():{withF:boolean;upperNoteNumber:number} {
  return {withF:true,upperNoteNumber:14};
}
function fillUpperOptions(select:HTMLSelectElement,allowOff=false):void {
  select.add(new Option('F · automatikisht','14'));
  for(let n=1;n<=13;n++)select.add(new Option(`Lart · perdja ${n}`,String(n)));
  if(allowOff)select.add(new Option('Pa telin lart','off'));
  select.value='14';
}
function selectSongPlayback(song:Song|null):void {
  const localCatalogEdit=!!song&&catalogSongs.some(s=>s.id===song.id)&&savedSongs.some(s=>s.id===song.id);
  playbackSource=prefersNotePlayback(song,localCatalogEdit)?'notes':'original';
}
function useNotePlayback():void {
  const position=playbackPositionMs();stopPlayback();playbackSource='notes';
  if(draft)draft.preferNotes=true;
  seekToMs(position);
}
function initNoteControls():void {
  audio.upperEnabled=true;audio.upperNoteNumber=14;
  fillUpperOptions($<HTMLSelectElement>('manualUpperNote'),true);
  fillUpperOptions($<HTMLSelectElement>('tabUpperNote'),true);
  $('tabUpperNote').addEventListener('change',()=>{
    const hit=selectedImportedHit;if(!hit||hit.string===2)return;
    const value=$<HTMLSelectElement>('tabUpperNote').value;
    hit.withF=value!=='off';if(hit.withF)hit.upperNoteNumber=upperFret(Number(value));
    useNotePlayback();updateImportDraft();renderImportedHits();
    setStatus('Teli lart u ndryshua për këtë notë. Shtyp Ruaj.');
  });
}
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
    if(!blob){
 const remote=catalogAudioURLs.get(song!.originalAudioId!);
 if(remote){try{const rr=await fetch(remote,{method:'HEAD'});if(token!==audioSelectToken)return;if(rr.ok){originalSourceId=song!.originalAudioId!;originalPlayer.src=remote;originalPlayer.hidden=false;originalPlayer.load();return;}}catch{}
 setStatus('Kënga e provës ka notat. Shtyp Lidh MP3 për audion origjinale.');return;}
 setStatus('Nuk gjendet audioja e kësaj kënge në këtë pajisje. JSON ruan notat, jo skedarin audio.');return;
 }
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
  return allSongs(savedSongs,catalogSongs).find(s=>s.id===selectedId)||null;
}
function historyFor(song:Song|null=currentSong()):EditHistory|null {
  if(!song)return null;
  let history=editHistories.get(song.id);
  if(!history)history=new EditHistory();
  editHistories.delete(song.id);editHistories.set(song.id,history);
  while(editHistories.size>8)editHistories.delete(editHistories.keys().next().value!);
  return history;
}
function editorSnapshot(song:Song|null=currentSong()):EditorSnapshot|null {
  if(!song)return null;
  const groups=activeSongGroups(song);
  const group=groups.find(g=>g.start===selectedGroupStart)??groups[groupAtTime(groups,tabCurrentMs)];
  return {song:structuredClone(song),selectedGroupStart:group.start,time:Math.max(0,Math.round(playbackPositionMs()))};
}
function commitEditorChange(before:EditorSnapshot|null,label:string):void {
  const after=editorSnapshot();
  if(before&&after&&before.song.id===after.song.id)historyFor(after.song)!.record(before,after,label);
  draftBaseline=draft?structuredClone(draft):null;
  refreshHistoryControls();
}
function historyBlocked():boolean {
  return groupBusy||micActive||keyboardRecordStart!==null||analyzing||!!manualPending||
    $<HTMLDialogElement>('jsonEditorDialog').open||$<HTMLDialogElement>('groupDeleteDialog').open;
}
function refreshHistoryControls():void {
  const history=historyFor(),blocked=historyBlocked();
  $('groupUndoBtn').toggleAttribute('disabled',blocked||!history?.undoCount);
  $('groupRedoBtn').toggleAttribute('disabled',blocked||!history?.redoCount);
  $('groupUndoBtn').textContent=`↶ Zhbëj${history?.undoCount?` (${history.undoCount})`:''}`;
  $('groupRedoBtn').textContent=`↷ Ribëj${history?.redoCount?` (${history.redoCount})`:''}`;
  $('groupUndoBtn').title=history?.undoLabel?`Ctrl+Z · Zhbëj: ${history.undoLabel}`:'Ctrl+Z · Kthe një hap prapa';
  $('groupRedoBtn').title=history?.redoLabel?`Ctrl+Y · Ribëj: ${history.redoLabel}`:'Ctrl+Y · Rikthe një veprim të zhbërë';
  $('groupHistoryStatus').textContent=history?.undoLabel?`Veprimi i fundit: ${history.undoLabel}`
    :history?.redoLabel?`Mund të ribësh: ${history.redoLabel}`:'Ctrl+Z: zhbëj · Ctrl+Y: ribëj';
}
function refreshGroupCopyControls():void {
  const song=currentSong(),groups=activeSongGroups(song),index=groups.findIndex(g=>g.start===selectedGroupStart);
  const count=song?.notes.filter(n=>groupForNote(groups,n)===index).length??0;
  $('groupActiveLabel').textContent=`${groups[index]?.label??'Grupi'} · ${count} nota`;
  $('groupCopyBtn').toggleAttribute('disabled',!count||groupBusy);
  $('groupDuplicateBtn').toggleAttribute('disabled',!count||groupBusy);
  $('groupDeleteBtn').toggleAttribute('disabled',groupBusy||!song||(!song.notes.length&&groups.length===1));
  $('groupDeleteBtn').title=`Fshi ${groups[index]?.label??'grupin e zgjedhur'} · ${count} nota`;
  const target=$<HTMLSelectElement>('groupPasteTarget'),previous=target.value;
  target.replaceChildren(new Option('Zgjidh grupin pritës…',''),...groups.map((g,i)=>new Option(`${g.label} · ${song?.notes.filter(n=>groupForNote(groups,n)===i).length??0} nota`,String(g.start))),new Option('＋ Në fund të këngës','__end'));
  target.options[0].disabled=true;target.value=Array.from(target.options).some(o=>o.value===previous)?previous:'';
  target.disabled=groupBusy||!song||!groupClipboard;
  const mode=$<HTMLSelectElement>('groupPasteMode');
  if(target.value==='__end')mode.value='insert';
  mode.disabled=groupBusy||!groupClipboard||!target.value||target.value==='__end';
  $('groupPasteBtn').toggleAttribute('disabled',groupBusy||!song||!groupClipboard||!target.value);
  $('groupPasteBtn').textContent=mode.value==='replace'?'Zëvendëso notat':'＋ Ngjit kopjen';
  const destination=groups.find(g=>String(g.start)===target.value);
  const effect=target.value==='__end'?'Kopja shtohet në fund të këngës.':destination
    ?mode.value==='replace'?`Zëvendëson notat e ${destination.label}; mund ta zhbësh.`:`Shton një grup të ri para ${destination.label}; grupi ekzistues ruhet.`
    :'Zgjidh ku dëshiron ta ngjitësh.';
  $('groupClipboardStatus').textContent=groupClipboard
    ?`Kopjuar: ${groupClipboard.label} · ${groupClipboard.notes.length} nota. ${effect}`
    :'Kopjo për ta ngjitur diku tjetër, ose Dyfisho për një kopje menjëherë pas këtij grupi.';
  refreshHistoryControls();
}
function setEditableSong(song:Song):void {
  draft={...song,notes:song.notes.map(n=>({...n}))};
  stanzas=sanitizeStanzas(song.stanzas);draft.stanzas=stanzas;
  importedHits=song.notes.map(n=>({...n,string:n.noteNumber===14?2:n.string,confidence:n.confidence??1,
    withF:n.withF!==false,upperNoteNumber:upperFret(n.upperNoteNumber),detail:'Redaktuar'}));
  selectedId='__draft';selectedImportedHit=null;manualPending=null;manualMode=true;instantTabNoteMode=false;analysisRowsVisible=60;
  draftBaseline=structuredClone(draft);
  renderSongs();renderImportedHits();renderManualMode();
}
function copySelectedGroup():void {
  const song=currentSong();if(!song)return;
  try{groupClipboard=copySongGroup(song,selectedGroupStart,tabSongEnd(song));$<HTMLSelectElement>('groupPasteTarget').value='';$<HTMLSelectElement>('groupPasteMode').value='insert';refreshGroupCopyControls();
    setStatus(`U kopjua ${groupClipboard.label}. Zgjidh ku ta ngjitësh.`);
  }catch(e){setStatus(String((e as Error).message||e));}
}
async function applyGroupOperation(result:{song:Song;groupStart:number},label:string):Promise<boolean> {
  if(groupBusy)return false;
  const song=currentSong(),before=editorSnapshot();if(!song||!before)return false;
  groupBusy=true;refreshGroupCopyControls();
  try{
    if(!editableTab())await editSavedAudio();
    if(selectedId!=='__draft'||draft?.id!==song.id)return false;
    stopPlayback();selectedGroupStart=result.groupStart;setEditableSong(result.song);
    useNotePlayback();seekToMs(result.groupStart);focusTimelineAt(result.groupStart);
    $<HTMLSelectElement>('groupPasteTarget').value=String(result.groupStart);
    commitEditorChange(before,label);return true;
  }finally{groupBusy=false;refreshGroupCopyControls();}
}
function groupEditAllowed():boolean {
  if(micActive||keyboardRecordStart!==null||manualPending||analyzing||groupBusy){
    setStatus('Përfundo shënimin ose regjistrimin përpara ndryshimit të grupit.');return false;
  }
  return true;
}
async function pasteCopiedGroup():Promise<void> {
  if(!groupEditAllowed())return;
  const song=currentSong(),target=$<HTMLSelectElement>('groupPasteTarget').value;
  if(!song||!groupClipboard)return;
  if(!target){setStatus('Zgjidh grupin ku dëshiron ta ngjitësh.');return;}
  try{
    const mode=$<HTMLSelectElement>('groupPasteMode').value;
    const destination=activeSongGroups(song).find(g=>String(g.start)===target);
    const at=target==='__end'?Math.ceil(tabSongEnd(song)):Number(target);
    const result=mode==='replace'&&target!=='__end'?replaceSongGroup(song,groupClipboard,at,Math.ceil(tabSongEnd(song)))
      :pasteSongGroup(song,groupClipboard,at);
    const label=mode==='replace'&&destination?`Zëvendësimi i ${destination.label}`:`Ngjitja e ${groupClipboard.label}`;
    if(await applyGroupOperation(result,label))setStatus(`${label} u krye. Zhbëj e kthen; Ruaj i mban ndryshimet.`);
  }catch(e){setStatus(String((e as Error).message||e));}
}
async function duplicateSelectedGroup():Promise<void> {
  if(!groupEditAllowed())return;
  const song=currentSong();if(!song)return;
  try{
    const groups=activeSongGroups(song),index=groups.findIndex(g=>g.start===selectedGroupStart);
    const copied=copySongGroup(song,selectedGroupStart,tabSongEnd(song));
    const at=Math.ceil(groups[index+1]?.start??tabSongEnd(song));
    const result=pasteSongGroup(song,copied,at);
    if(await applyGroupOperation(result,`Dyfishimi i ${copied.label}`))setStatus(`${copied.label} u dyfishua. Grupi origjinal ruhet.`);
  }catch(e){setStatus(String((e as Error).message||e));}
}
function requestGroupDelete():void {
  if(!groupEditAllowed())return;
  const song=currentSong();if(!song)return;
  const groups=activeSongGroups(song),index=groups.findIndex(g=>g.start===selectedGroupStart),group=groups[index];if(!group)return;
  const count=song.notes.filter(n=>groupForNote(groups,n)===index).length;
  pendingGroupDelete={songId:song.id,start:group.start,label:group.label,count};
  $('groupDeleteName').textContent=group.label;
  $('groupDeleteSummary').textContent=`Do të hiqen ${count} nota nga ky grup. Kohët e notave të tjera ruhen. Mund ta kthesh me Zhbëj.`;
  stopPlayback();$<HTMLDialogElement>('groupDeleteDialog').showModal();refreshHistoryControls();
}
async function confirmGroupDelete():Promise<void> {
  const pending=pendingGroupDelete;pendingGroupDelete=null;$<HTMLDialogElement>('groupDeleteDialog').close();
  if(!pending||!groupEditAllowed())return;
  const song=currentSong();if(!song||song.id!==pending.songId)return;
  try{
    const result=deleteSongGroup(song,pending.start);
    if(await applyGroupOperation(result,`Fshirja e ${pending.label}`))setStatus(`${pending.label} u fshi (${pending.count} nota). Zhbëj e rikthen.`);
  }catch(e){setStatus(String((e as Error).message||e));}
}
function undoEditorChange(redo=false):void {
  if(historyBlocked())return;
  const current=editorSnapshot(),history=historyFor();if(!current||!history)return;
  const result=redo?history.redo(current):history.undo(current);if(!result)return;
  const wasDraft=selectedId==='__draft',restored=result.snapshot;
  stopPlayback();
  if(!wasDraft){editingSongId=current.song.id;importFile=null;}
  restored.song.id=current.song.id;
  if(current.song.originalAudioId)restored.song.originalAudioId=current.song.originalAudioId;
  selectedGroupStart=restored.selectedGroupStart;setEditableSong(restored.song);
  selectSongPlayback(draft);seekToMs(restored.time);focusTimelineAt(restored.time);refreshGroupCopyControls();
  setStatus(`${redo?'U ribë':'U zhbë'}: ${result.label}. Shtyp Ruaj për t'i mbajtur ndryshimet.`);
}
function openJSONEditor():void {
  const song=currentSong();if(!song)return;
  if(micActive||keyboardRecordStart!==null){setStatus('Ndalo regjistrimin përpara redaktimit të JSON-it.');return;}
  if(manualPending){setStatus('Vendos ose anulo notën e hapur përpara redaktimit të JSON-it.');return;}
  stopPlayback();jsonBaseSong=structuredClone(song);jsonBaseSelectedId=selectedId;
  $<HTMLTextAreaElement>('jsonEditorText').value=JSON.stringify(song,null,2);
  $('jsonEditorStatus').textContent='Ndrysho emrin, notat ose grupet; pastaj zbatoji në tablaturë.';
  $('jsonEditorStatus').classList.remove('is-error');
  $<HTMLDialogElement>('jsonEditorDialog').showModal();
}
function validateJSONEditor(format=false):Song|null {
  if(!jsonBaseSong)return null;
  try{
    const song=parseSongJSON($<HTMLTextAreaElement>('jsonEditorText').value,jsonBaseSong);
    if(format)$<HTMLTextAreaElement>('jsonEditorText').value=JSON.stringify(song,null,2);
    $('jsonEditorStatus').textContent=`JSON i vlefshëm: ${song.notes.length} nota · ${song.stanzas?.length??1} grupe.`;
    $('jsonEditorStatus').classList.remove('is-error');return song;
  }catch(e){$('jsonEditorStatus').textContent=String((e as Error).message||e);$('jsonEditorStatus').classList.add('is-error');return null;}
}
function applyJSONEditor():void {
  const song=validateJSONEditor();if(!song)return;
  const before=editorSnapshot();stopPlayback();
  if(jsonBaseSelectedId!=='__draft'){editingSongId=jsonBaseSong!.id;importFile=null;}
  setEditableSong(song);$<HTMLDialogElement>('jsonEditorDialog').close();
  void prepareOriginalForSelection();useNotePlayback();commitEditorChange(before,'Redaktimi i JSON-it');
  setStatus('JSON-i u zbatua në tablaturë. Shtyp Ruaj për ta mbajtur në këtë shfletues ose Eksporto JSON për skedarin.');
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
  const top=$<HTMLSelectElement>('practiceGroupSelect');
  top.replaceChildren(...groups.map((g,i)=>new Option(g.label,String(g.start))));
  top.value=String(selectedGroupStart);
  $('practiceGroupBtn').toggleAttribute('disabled',!song || (!song.notes.length&&!importedSong(song)));
  $('groupPlayBtn').toggleAttribute('disabled',!song || (!song.notes.length&&!importedSong(song)));
}
function selectGroup(start:number):void{
  const groups=activeSongGroups(currentSong());
  const group=groups.find(g=>g.start===start);
  if(!group)return;
  selectedGroupStart=group.start;
  $<HTMLSelectElement>('selectedGroupSelect').value=String(group.start);
  $<HTMLSelectElement>('practiceGroupSelect').value=String(group.start);
  document.querySelectorAll('.stanza-entry').forEach(el=>el.classList.toggle('group-active',(el as HTMLElement).dataset.groupStart===String(group.start)));
  focusTimelineAt(group.start);
  if(groupClipboard)$<HTMLSelectElement>('groupPasteTarget').value=String(group.start);
  refreshGroupCopyControls();
  setStatus(`U zgjodh ${group.label}. Vija me ngjyrë shfaqet në tablaturë.`);
}
function renderSongs():void {
  const selected=selectedId;
  const select=$<HTMLSelectElement>('songSelect');select.replaceChildren();
  if(draft){const opt=new Option(`● PROVË — ${draft.name}`,'__draft');select.add(opt);}
  for(const song of allSongs(savedSongs,catalogSongs)){if(draft?.id===song.id)continue;select.add(new Option((catalogSongs.some(s=>s.id===song.id)?'♫ ':'')+song.name,song.id));}
  select.value=selected;
  if(select.selectedIndex<0)select.selectedIndex=0;
  selectedId=select.value;
  const selectedSong=currentSong();
  if(selectedId!=='__draft'&&!audio.playing&&originalPlayer.paused)selectSongPlayback(selectedSong);
  const isCatalogSong=!!selectedSong&&catalogSongs.some(s=>s.id===selectedSong.id);
    const isUserSong=!!selectedSong&&savedSongs.some(s=>s.id===selectedSong.id);
  const isOverride=isUserSong&&(isCatalogSong||DEMO.some(s=>s.id===selectedSong!.id));
  $('deleteBtn').textContent=selectedId==='__draft'?'Fshi provën':isOverride?'Rikthe origjinalin':'Fshi';
    $('catalogAudioBtn').hidden=!isCatalogSong;
  $('saveBtn').toggleAttribute('disabled',!draft);
  $('analysisEditSavedBtn').toggleAttribute('disabled',!selectedSong || (!selectedSong.notes.length&&!selectedSong.originalAudioId) || selectedId==='__draft');
  $('deleteBtn').toggleAttribute('disabled',!isUserSong && selectedId!=='__draft');
  $('exportBtn').toggleAttribute('disabled',!selectedSong);
  $('jsonEditBtn').toggleAttribute('disabled',!selectedSong);
  $('songMeta').textContent=`${selectedSong?.notes.length??0} nota · ${selectedSong?fmt((selectedSong.notes.at(-1)?.time??0)+300):'00:00.00'}`;
  if(isOverride)$('songMeta').textContent+=' · Ndryshime lokale';
  refreshGroupPicker(selectedSong);refreshGroupCopyControls();
  clearPlayedNote();
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
      const number=n;
      const name=string===1?`Perdja ${n}, teli poshtë, ${labelFor(n)}`:`Teli lart, perdja ${n}`;
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
function showActive(events:NoteEvent[],groupColor='#e8b45a',history:readonly NoteEvent[]=events):void {
  const visualEvents=withOpenF(events,audio.upperEnabled);
  const expandedHistory=withOpenF(history,audio.upperEnabled);
  const key=visualEvents.map(e=>`${e.string}/${e.noteNumber}/${e.time}`).join('|')+'@'+groupColor;
  if(key===lastDisplayKey)return;
  lastDisplayKey=key;
  highlights.replaceChildren();
  const shown=new Set<string>();
  for(const ev of visualEvents){
    const id=`${ev.string}-${ev.noteNumber}`;
    if(shown.has(id))continue;
    shown.add(id);
    const cx=ev.noteNumber>=14?1175:(fretXs[ev.noteNumber-1]+fretXs[ev.noteNumber])/2;
    const cy=ev.string===1?240:219;
    const color=noteAttackColor(expandedHistory,ev,ev.string===2?'#63d9c9':groupColor);
    const label=ev.noteNumber===14?'F':ev.noteNumber===15?'G':String(ev.noteNumber);
    highlights.append(sEl('circle',{cx,cy,r:23,fill:color,opacity:.33,filter:'url(#glow)'}));
    highlights.append(sEl('circle',{cx,cy,r:14.5,fill:color,stroke:'#fff4e0','stroke-width':2.4}));
    highlights.append(sEl('text',{x:cx,y:cy+5.4,'text-anchor':'middle','font-size':15,'font-weight':850,fill:'#122133','pointer-events':'none'},label));
  }
}
/** Active markings represent the attack, not a latch that persists until another note. */
function updatePlaybackNotes(song:Song,ms:number):void {
  const history=withOpenF(song.notes,audio.upperEnabled);
  const active=notesAtMoment(history,ms);
  const lead=active.find(n=>n.string===1)??active[0];
  const groups=activeSongGroups(song);
  const color=lead ? groups[groupForNote(groups,lead)]?.color || GROUP_COLORS[0] : GROUP_COLORS[0];
  showActive(active,color,history);
}
function clearPlayedNote():void {
  showActive([]);
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
  if(!audio.upperEnabled&&(string===2||noteNumber===14)){setStatus('Teli lart është i heshtur: është zgjedhur vetëm teli poshtë.');return;}
  const config=accompaniment();
  const event:NoteEvent={string,noteNumber,time:performance.now(),...config};
  void audio.hit(noteNumber,string,config.withF,config.upperNoteNumber).catch(e=>setStatus(String(e.message||e)));
  liveAttacks.push(event);if(liveAttacks.length>200)liveAttacks.splice(0,100);
  showActive([event],'#e8b45a',liveAttacks);
  if(keyboardRecordStart!==null){
    const now=performance.now();if(keyboardEvents.length===0)keyboardRecordStart=now;
    keyboardEvents.push({...event,time:Math.round(now-keyboardRecordStart),velocity:audio.strength==='lehte'?.35:.92});
    $('recordCounter').textContent=`${keyboardEvents.length} nota`;
  }
  const upper=audio.upperEnabled&&string===1&&config.withF
    ?` + ${config.upperNoteNumber===14?'F hapur':`teli lart, perdja ${config.upperNoteNumber}`}`:'';
  setStatus(`${noteNumber===14?'F':noteNumber===15?'G':`Perdja ${noteNumber}`} · ${Math.round(noteFrequency(noteNumber,string))} Hz · Teli ${string===1?'poshtë':'lart'}${upper}`);
}
function createDraftFromNotes(notes:NoteEvent[],name:string):void {
  draft=newSong(name,notes);editingSongId=null;
  importedHits=notes.map(n=>({...n,confidence:n.confidence??1,detail:'Vendosur'}));
  stanzas=sanitizeStanzas(draft.stanzas);draft.stanzas=stanzas;draftBaseline=structuredClone(draft);
  selectedId='__draft';renderSongs();renderImportedHits();
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
  const notes:NoteEvent[]=micHits.filter(h=>h.noteNumber!==null).map(h=>({string:(h.noteNumber===14?2:1) as 1|2,noteNumber:h.noteNumber!,time:h.time,measuredHz:h.hz??undefined,confidence:h.clarity,withF:h.withF,upperNoteNumber:h.upperNoteNumber}));
  if(draft && selectedId==='__draft'){const before=editorSnapshot(draftBaseline??draft);draft.notes=notes;importedHits=notes.map(n=>({...n,confidence:n.confidence??1,detail:'Nga mikrofoni'}));commitEditorChange(before,'Korrigjimi i mikrofonit');renderSongs();renderImportedHits();}
}
function stopMic():void {
  mic.stop();micActive=false;
  $('micBtn').textContent='🎙 Nis mikrofonin';$('micBtn').classList.remove('recording');
  const notes:NoteEvent[]=micHits.filter(h=>h.noteNumber!==null).map(h=>({string:(h.noteNumber===14?2:1) as 1|2,noteNumber:h.noteNumber!,time:h.time,measuredHz:h.hz??undefined,confidence:h.clarity,withF:h.withF,upperNoteNumber:h.upperNoteNumber}));
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
  Object.assign(hit,accompaniment());
  micHits.push(hit); // keep editable list separate from worklet-owned array
  $('micCurrent').textContent=hit.noteNumber?`${labelFor(hit.noteNumber)} · ${HZ[hit.noteNumber-1]} Hz`:'? · notë e paqartë';
  $('micMeasured').textContent=hit.hz?`${hit.hz.toFixed(1)} Hz`:'— Hz';
  $('micInterval').textContent=micHits.length>1?`${hit.time-micHits[micHits.length-2].time} ms`:'0 ms';
  $('micCount').textContent=`${micHits.filter(h=>h.noteNumber!==null).length} / ${micHits.length}`;
  if(hit.noteNumber)showActive([hit as NoteEvent],'#e8b45a',micHits.filter(h=>h.noteNumber!==null) as NoteEvent[]);
  renderMicHits();
};
function stopPlayback():void {
  playToken++;cancelAnimationFrame(playFrame);audio.stop();originalPlayer.pause();
  activeGroupEndMs=null;currentPlayMode='all';clearPlayedNote();
  $('playBtn').textContent='▶ Luaj';$('groupPlayBtn').textContent='▶ Luaj grupin';$('studioState').textContent='GATI';
  syncTabTransport();
}
function selectedGroupRange(song:Song):{start:number;end:number;name:string;index:number}{
  const groups=activeSongGroups(song);
  const i=Math.max(0,groups.findIndex(g=>g.start===selectedGroupStart));
  const start=groups[i].start;
  const audioEnd=usingOriginal(song)&&Number.isFinite(originalPlayer.duration)?Math.round(originalPlayer.duration*1000):tabSongEnd(song);
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
  if(usingOriginal(song)){
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
  const first=Math.min(...notes.map(n=>n.time));syntheticStartMs=first;
  const clip:Song={...song,notes:notes.map(n=>({...n,time:n.time-first}))};
  const token=++playToken;
  try{
    await audio.play(clip,playbackSpeed);
    if(token!==playToken)return;
    $('groupPlayBtn').textContent='▶ Po luhet grupi';$('studioState').textContent='GRUPI';
    const loop=()=>{
      if(token!==playToken)return;
      const ms=first+audio.elapsedMs*playbackSpeed;
      drawTab(song,ms);$('timeLabel').textContent=`${fmt(ms)} / ${fmt(range.end)}`;
      updatePlaybackNotes(song,ms);
      if(ms>=range.end||audio.done()){completeGroupPlayback();return;}
      playFrame=requestAnimationFrame(loop);
    };loop();
  }catch(e){stopPlayback();setStatus('Gabim gjatë luajtjes së grupit: '+String(e));}
}
/** All tab controls share the exact original audio clock and position. */
function playbackPositionMs():number {
  return usingOriginal(currentSong()) && Number.isFinite(originalPlayer.currentTime)
    ? originalPlayer.currentTime*1000
    : audio.playing ? syntheticStartMs + audio.elapsedMs*playbackSpeed : tabCurrentMs;
}
function activeSeekEndMs():number {
  const song=currentSong();
  if(usingOriginal(song) && Number.isFinite(originalPlayer.duration) && originalPlayer.duration>0)
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
  const playing=usingOriginal(song) ? !originalPlayer.paused : audio.playing;
  $('playBtn').textContent=playing?'⏸ Pauzë':'▶ Luaj';
  $('practicePauseBtn').textContent=playing?'⏸ Pauzë':'▶ Vazhdo';
  $<HTMLSelectElement>('practiceSpeedSelect').value=String(playbackSpeed);
}
/** Pause before seeking so the player cannot overwrite the clicked position. */
function seekToMs(target:number):void {
  const song=currentSong();if(!song)return;
  const end=activeSeekEndMs();
  const ms=Math.max(0,Math.min(end,Number.isFinite(target)?Math.round(target):0));
  if(usingOriginal(song)){
    originalPlayer.pause();
    try {
      if(originalPlayer.readyState>0){originalPlayer.currentTime=ms/1000;seekPendingUntilMetadata=null;}
      else seekPendingUntilMetadata=ms;
    }catch{seekPendingUntilMetadata=ms;}
  }else{
    playToken++;cancelAnimationFrame(playFrame);audio.stop();
  }
  activeGroupEndMs=null;currentPlayMode='all';clearPlayedNote();
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
    $('studioState').textContent='NOTAT';setStatus(audio.upperEnabled?'Po luhen notat me shoqërimin e zgjedhur.':'Po luhet vetëm teli poshtë, sipas notave.');
    const frame=()=>{
      if(token!==playToken||!audio.playing)return;
      const ms=Math.min(activeSeekEndMs(),syntheticStartMs+audio.elapsedMs*playbackSpeed);
      drawTab(song,ms);$('timeLabel').textContent=`${fmt(ms)} / ${fmt(activeSeekEndMs())}`;
      updatePlaybackNotes(song,ms);
      if(audio.done()){audio.stop();clearPlayedNote();syncTabTransport();return;}
      playFrame=requestAnimationFrame(frame);
    };frame();
  }catch(e){setStatus(`Luajtja nuk nisi: ${String(e)}`);syncTabTransport();}
}
/** Same Play/Pause button resumes from the chosen second; never resets unexpectedly. */
async function toggleTabPlay():Promise<void>{
  if(micActive){setStatus('Ndalo mikrofonin përpara luajtjes.');return;}
  if(manualPending){setStatus('Vendos ose anulo notën e hapur para luajtjes.');return;}
  const song=currentSong();if(!song)return;
  if(usingOriginal(song)){
    if(!originalPlayer.src){setStatus('Audioja origjinale nuk është gati.');return;}
    if(!originalPlayer.paused){originalPlayer.pause();clearPlayedNote();tabCurrentMs=originalPlayer.currentTime*1000;redrawTab();return;}
    if(Number.isFinite(originalPlayer.duration) && originalPlayer.currentTime>=originalPlayer.duration-.02){seekToMs(0);}
    configurePlaybackSpeed();
    try{await originalPlayer.play();}catch(e){setStatus('Luajtja nuk nisi: '+String(e));}
  }else{
    if(audio.playing){const at=playbackPositionMs();playToken++;cancelAnimationFrame(playFrame);audio.stop();clearPlayedNote();tabCurrentMs=at;redrawTab();return;}
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
  const token=++playToken;syntheticStartMs=0;
  currentPlayMode='all';configurePlaybackSpeed();tabCurrentMs=0;tabViewStartMs=0;tabFollowPlayback=true;
  if(usingOriginal(song)){
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
      updatePlaybackNotes(song,ms);
      drawTab(song,ms);
      $('timeLabel').textContent=`${fmt(ms)} / ${fmt(song.notes.at(-1)!.time+600)}`;
      if(audio.done()){stopPlayback();setStatus('Kënga përfundoi.');return;}
      playFrame=requestAnimationFrame(loop);
    };loop();
  }catch(e){$('playBtn').textContent='▶ Luaj';$('studioState').textContent='GABIM';setStatus(`Audio: ${e instanceof Error?e.message:String(e)}`);}
}
async function saveDraft():Promise<void> {
  if(manualPending){setStatus('Vendos ose anulo notën e hapur para ruajtjes.');return;}
  if(!draft){setStatus('Nuk ka këngë provë për ruajtje.');return;}
  const title=prompt('Emri i këngës:',draft.name);
  if(title===null)return;
  if(!title.trim()){setStatus('Vendos një emër për këngën.');return;}
  const saved={...draft,id:editingSongId||newSong(title,[]).id,name:title.trim(),stanzas:sanitizeStanzas(stanzas)};
  if(draft.originalAudioId==='__draft' && importFile){
    try {await putOriginal(saved.id,importFile);saved.originalAudioId=saved.id;}
    catch(e){setStatus(`Audioja nuk u ruajt në këtë pajisje: ${String(e)}. Liro hapësirë dhe provo përsëri.`);return;}
  }
  const next=upsertSong(savedSongs,saved);
  if(!saveSongs(next)){if(draft.originalAudioId==='__draft' && importFile)void deleteOriginal(saved.id).catch(()=>{});setStatus('Ruajtja dështoi: hapësira e shfletuesit është plot. Eksporto JSON.');return;}
  const oldId=draft.id,beforeSave=editorSnapshot();
  const history=historyFor();
  if(beforeSave&&title.trim()!==draft.name)history!.record(beforeSave,{...beforeSave,song:{...beforeSave.song,name:title.trim()}},'Emërtimi i këngës');
  if(history&&oldId!==saved.id){editHistories.delete(oldId);editHistories.set(saved.id,history);}
  stopPlayback();savedSongs=next;draft=null;draftBaseline=null;editingSongId=null;selectedId=saved.id;importedHits=[];importFile=null;renderImportedHits();renderSongs();void prepareOriginalForSelection();setStatus(`Kënga “${saved.name}” u ruajt në këtë shfletues.`);
}
async function deleteSong():Promise<void> {
  if(selectedId==='__draft'){
    if(confirm('Ta fshijmë këngën provë?')){if(draft)editHistories.delete(draft.id);draftBaseline=null;draft=null;editingSongId=null;importFile=null;importedHits=[];renderImportedHits();selectedId=DEMO[0].id;renderSongs();void prepareOriginalForSelection();setStatus('Prova u fshi.');}
    return;
  }
  const song=currentSong();if(!song||!savedSongs.some(s=>s.id===song.id))return;
  const isOverride=DEMO.some(s=>s.id===song.id)||catalogSongs.some(s=>s.id===song.id);
  if(!confirm(isOverride?'Të hiqen ndryshimet lokale dhe të rikthehet kënga origjinale?':`Ta fshijmë këngën “${song.name}”?`))return;
  const next=savedSongs.filter(s=>s.id!==song.id);if(!saveSongs(next)){setStatus('Fshirja nuk u ruajt.');return;}savedSongs=next;
  editHistories.delete(song.id);draftBaseline=null;
  if(song.originalAudioId===song.id)try{await deleteOriginal(song.originalAudioId);}catch{}
  selectedId=isOverride?song.id:DEMO[0].id;renderSongs();void prepareOriginalForSelection();setStatus(isOverride?'U rikthye kënga origjinale.':'Kënga u fshi nga ky shfletues.');
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
function editableTab():boolean{return selectedId==='__draft' && !!draft;}
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
  updateImportDraft('Lëvizja e kufirit të grupit');renderImportedHits();
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
  if(song && tabFollowPlayback && (audio.playing || (!originalPlayer.paused && usingOriginal(song)))){
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
    const events=withOpenF(song.notes,audio.upperEnabled);
    for(const e of events){
      const drawTime=tabNoteDrag && selectedImportedHit && e.time===tabNoteDrag.startTime && e.noteNumber===tabNoteDrag.hit.noteNumber && e.string===tabNoteDrag.hit.string ? tabNoteDrag.previewMs : e.time;
      const x=timelineX(drawTime,tabViewStartMs,left,scale);
      if(x<left-11||x>w-right+11)continue;
      const y=e.string===1?120:60;
      const gi=groupForNote(groups,e);
      const groupColor=noteAttackColor(events,e,groups[gi]?.color||STANZA_COLORS[gi%STANZA_COLORS.length]);
      c.beginPath();c.arc(x,y,11,0,Math.PI*2);c.fillStyle=Math.abs(e.time-tabCurrentMs)<60?groupColor:'#203f4f';c.fill();
      c.strokeStyle=groupColor;c.lineWidth=2;c.stroke();
      if(selectedImportedHit && e.time===selectedImportedHit.time && e.noteNumber===selectedImportedHit.noteNumber && e.string===selectedImportedHit.string){
        c.beginPath();c.arc(x,y,15,0,Math.PI*2);c.strokeStyle='#f8f9fa';c.lineWidth=2;c.stroke();
      }
      c.fillStyle=Math.abs(e.time-tabCurrentMs)<60?'#141e2b':'#f6e6ca';c.font='bold 12px system-ui';c.textAlign='center';c.fillText(e.noteNumber<=13?String(e.noteNumber):labelFor(e.noteNumber),x,y+4);c.textAlign='start';
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
/** Editing a note on the canvas never moves its neighbors. */
function editSelectedTabNote(delta:number):void {
  const hit=selectedImportedHit;
  if(!editableTab()||!hit||!importedHits.includes(hit))return;
  hit.time=Math.max(0,Math.min(activeSeekEndMs(),Math.round(hit.time+delta)));
  hit.detail='Koha u korrigjua në tablaturë';
  updateImportDraft();renderImportedHits();redrawTab();
  setStatus(`Nota ${hit.noteNumber??'?'} u vendos te ${preciseTime(hit.time)} s. Shtyp Ruaj.`);
}
function deleteSelectedTabNote():void {
  const hit=selectedImportedHit;
  if(!editableTab()||!hit||!importedHits.includes(hit))return;
  importedHits=importedHits.filter(n=>n!==hit);
  selectedImportedHit=null;updateImportDraft();renderImportedHits();redrawTab();
  setStatus('Nota e zgjedhur u fshi. Shtyp Ruaj që ndryshimi të mbetet.');
}
function refreshTabNoteEditor():void {
  const hit=selectedImportedHit;
  const canEdit=editableTab() && !!hit && importedHits.includes(hit);
  $('tabNoteEditBar').hidden=!canEdit;
  const upper=$<HTMLSelectElement>('tabUpperNote');upper.disabled=!canEdit||hit?.string===2;
  upper.value=hit?.withF===false?'off':String(upperFret(hit?.upperNoteNumber));
  if(canEdit)$('tabNoteSelected').textContent=`Perdja ${hit!.noteNumber??'?'} · ${preciseTime(hit!.time)} s`;
}
function findExistingCanvasHit(x:number,y:number,geom:ReturnType<typeof timelineGeometry>):GuessedHit|null {
  if(!editableTab()||x<geom.left||x>geom.width-geom.right)return null;
  const line=y>=38&&y<89?2:y>=92&&y<=146?1:0;
  if(!line)return null;
  let nearest:GuessedHit|null=null,distance=17;
  for(const hit of importedHits){
    if(hit.noteNumber===null)continue;
    const shownOnLine=hit.string===line||(line===2&&hit.string===1&&hit.withF!==false&&hit.noteNumber!==14);
    if(!shownOnLine)continue;
    const px=timelineX(hit.time,tabViewStartMs,geom.left,geom.scale);
    const d=Math.abs(px-x);
    if(d<distance){nearest=hit;distance=d;}
  }
  return nearest;
}
function renderTimeline():void {
  drawTab(songForDisplay(),tabCurrentMs);
  const song=songForDisplay();
  $('timeLabel').textContent=`${fmt(tabCurrentMs)} / ${fmt(tabSongEnd(song))}`;
}
/** A click must use its own position, even if music was playing elsewhere. */
function captureManualTime(x:number,geom:ReturnType<typeof timelineGeometry>):number {
  return manualAnywhereTime(x,tabViewStartMs,geom.left,geom.scale,geom.width,geom.right,activeSeekEndMs());
}
function renderManualMode():void{
  const btn=$<HTMLButtonElement>('manualModeBtn');
  btn.classList.toggle('is-on',manualMode);
  btn.setAttribute('aria-pressed',String(manualMode));
  btn.textContent=manualMode?'✍ Shënim manual: AKTIV':'✍ Shëno manualisht';
  const quickBtn=$<HTMLButtonElement>('instantTabNoteBtn');
  quickBtn.classList.toggle('is-on',instantTabNoteMode);
  quickBtn.setAttribute('aria-pressed',String(instantTabNoteMode));
  quickBtn.textContent=instantTabNoteMode?'📍 Kliko kudo: AKTIV':'📍 Kliko kudo → Notë';
  document.querySelector('.tab-canvas-wrap')?.classList.toggle('instant-note-active',instantTabNoteMode);
  $('manualEntryPanel').hidden=!manualPending;
  $('manualClearBtn').toggleAttribute('disabled',!editableTab()||!importedHits.length);
  refreshHistoryControls();
  $('tabHelp').textContent=instantTabNoteMode ? 'Kliko kudo mbi tablaturë — edhe te numrat e sekondave ose hapësira bosh. Muzika ndalet në atë sekondë dhe shfaqet ?. Për ta tërhequr vijën e grupit, përdor trekëndëshin e saj.' : manualMode
    ?'Kliko te sekonda ku dëshiron notën: kënga ndalet në atë pozicion. Zgjidh perden dhe përdor Vendos & Vazhdo. Koha mund të rregullohet në 0.001 sekonda.'
    :'Tërhiq vijën e grupit për të korrigjuar kufirin. Përdor ✍ Shëno manualisht për të vendosur notat ndërsa dëgjon muzikën.';
}
function cancelManualNote():void{
  manualPending=null;renderManualMode();redrawTab();
}
function beginManualNote(x:number,y:number,geom:ReturnType<typeof timelineGeometry>):void{
  if(!editableTab()){
    setStatus('Për shënim manual, importo një audio ose hap Redakto këngën.');return;
  }
  if(manualPending){setStatus('Përfundo ose anulo notën e mëparshme.');return;}
  const time=captureManualTime(x,geom);
  const string:1|2=1;
  seekToMs(time);
  manualPending={time,string};
  const select=$<HTMLSelectElement>('manualFretSelect');
  select.value='';
  $<HTMLSelectElement>('manualUpperNote').value='14';
  $<HTMLSelectElement>('manualUpperNote').disabled=false;
  $('manualTimeLabel').textContent=`${preciseTime(time)} s`;
  $<HTMLInputElement>('manualTimeSeconds').value=preciseTime(time);
  renderManualMode();
  tabFollowPlayback=false;
  // Preserve the exact horizontal point that was tapped: do not auto-pan.
  redrawTab();
  setStatus(`Shënim në ${fmt(time)}. Zgjidh perden dhe shtyp Vendos ose Vendos & Vazhdo.`);
  $<HTMLElement>('manualEntryPanel').scrollIntoView({block:'nearest',behavior:'smooth'});
  select.focus({preventScroll:true});
}
function commitManualNote(resume:boolean):void{
  if(!manualPending||!editableTab())return;
  const noteNumber=Number($<HTMLSelectElement>('manualFretSelect').value);
  if(!Number.isInteger(noteNumber)||!(noteNumber>=1&&noteNumber<=13||noteNumber===15)){
    setStatus('Zgjidh perden poshtë 1–13 ose G hapur.');return;
  }
  const entered=Number($<HTMLInputElement>('manualTimeSeconds').value);
  if(!Number.isFinite(entered)||entered<0||entered*1000>activeSeekEndMs()){
    setStatus('Shkruaj sekonda të vlefshme për notën.');return;
  }
  const time=Math.round(entered*1000);
  // The saved note follows the precise user-selected second, not the old playback clock.
  seekToMs(time);
  const groupStart=stanzas[groupAtTime(stanzas,time)]?.start??0;
  const h:GuessedHit=manualEntryNote(noteNumber,time,$<HTMLSelectElement>('manualUpperNote').value,groupStart);
  importedHits.push(h);
  selectedImportedHit=h;
  const count=stanzas.flatMap((_,i)=>importedHits.filter(v=>groupForNote(stanzas,v)===i)).indexOf(h);
  analysisRowsVisible=Math.max(analysisRowsVisible,count+1);
  manualPending=null;
  updateImportDraft();renderImportedHits();renderManualMode();selectImportedHit(h);redrawTab();
  if(h.withF===false||(h.upperNoteNumber!==undefined&&h.upperNoteNumber!==14))useNotePlayback();
  setStatus(`Nota ${noteNumber===15?'G':noteNumber} u vendos te ${fmt(time)}. ${resume?'Vazhdo dëgjimin.':'Mund të korrigjosh kohën në listë.'}`);
  if(resume){
    if(importedSong(currentSong())&&originalPlayer.src){stopPlayback();playbackSource='original';seekToMs(time);}
    configurePlaybackSpeed();void toggleTabPlay();
  }
}
function setManualMode(on:boolean):void{
  if(!on){cancelManualNote();instantTabNoteMode=false;}
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
    // Tap an existing marker to select it. Drag horizontally or use the precise buttons.
    if(!manualPending){
      const note=findExistingCanvasHit(x,y,geom);
      if(note){
        seekToMs(note.time);selectImportedHit(note);
        tabNoteDrag={pointerId:event.pointerId,hit:note,startX:x,startTime:note.time,previewMs:note.time,moved:false};
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();return;
      }
    }
    // Alternative direct mode: any visible pixel, including rulers, empty bands
    // and the left labels, selects the exact horizontal second. Marker triangles
    // remain reserved for intentionally dragging group boundaries.
    if(instantTabNoteMode){
      if(!editableTab()){setStatus('Importo një audio ose hap Redakto këngën për të shtuar notë.');return;}
      const safeX=Math.max(geom.left,Math.min(geom.width-geom.right,x));
      const boundary=y>=16&&y<38 ? findGroupBoundary(tabCurrentGroups(song),safeX,tabViewStartMs,geom.left,geom.scale,13) : -1;
      if(boundary<1){
        const chosenY=y<37?119:y; // ruler means the melodic (lower) string
        beginManualNote(safeX,chosenY,geom);
        event.preventDefault();return;
      }
    }
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
    if(tabNoteDrag && event.pointerId===tabNoteDrag.pointerId){
      const geom=visibleTab(),rect=canvas.getBoundingClientRect();
      const dx=event.clientX-rect.left-tabNoteDrag.startX;
      if(Math.abs(dx)>5)tabNoteDrag.moved=true;
      if(tabNoteDrag.moved){
        tabNoteDrag.previewMs=Math.max(0,Math.min(activeSeekEndMs(),Math.round(tabNoteDrag.startTime+dx/geom.scale)));
        redrawTab();
      }
      event.preventDefault();return;
    }
    if(!tabDrag||event.pointerId!==tabDrag.pointerId)return;
    const geom=visibleTab(),rect=canvas.getBoundingClientRect();
    const proposed=timelineTime(event.clientX-rect.left,tabViewStartMs,geom.left,geom.scale);
    const value=clampGroupBoundary(stanzas,tabDrag.index,proposed,tabSongEnd(draft));
    if(value!==null)tabDrag.previewMs=value;
    redrawTab();event.preventDefault();
  });
  canvas.addEventListener('pointerup',(event:PointerEvent)=>{
    if(tabNoteDrag && event.pointerId===tabNoteDrag.pointerId){
      const drag=tabNoteDrag;tabNoteDrag=null;
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(drag.moved){drag.hit.time=drag.previewMs;updateImportDraft();renderImportedHits();}
      else refreshTabNoteEditor();
      redrawTab();event.preventDefault();return;
    }
    if(!tabDrag||event.pointerId!==tabDrag.pointerId)return;
    const drag=tabDrag;tabDrag=null;
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor='crosshair';
    applyGroupMarkerPosition(drag.index,drag.previewMs);
    event.preventDefault();
  });
  canvas.addEventListener('pointercancel',()=>{tabDrag=null;tabNoteDrag=null;canvas.style.cursor='crosshair';redrawTab();});
  canvas.addEventListener('keydown',(event:KeyboardEvent)=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();
      if(event.altKey && selectedImportedHit)editSelectedTabNote(event.key==='ArrowLeft'?-50:50);
      else if(event.shiftKey)moveSelectedMarker(event.key==='ArrowLeft'?-50:50);
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
      return {string:n.string as 1|2,noteNumber:n.noteNumber as number,time:n.time as number,withF:n.withF!==false,upperNoteNumber:upperFret(n.upperNoteNumber),
        ...(Number.isInteger(n.groupStart) && (n.groupStart as number)>=0?{groupStart:n.groupStart}:{} )};
    });
    const name=typeof obj.name==='string'?obj.name:'Këngë e importuar';
    stopPlayback();createDraftFromNotes(notes,name);
    const markers=(data as {stanzas?:Stanza[]}).stanzas;stanzas=sanitizeStanzas(Array.isArray(markers)?markers:undefined);if(draft){draft.stanzas=stanzas;draftBaseline=structuredClone(draft);}
    renderSongs();renderImportedHits();
    setStatus('Kënga u importua si PROVË. Shtyp Luaj dhe pastaj Ruaj nëse dëshiron.');
  }catch(e){setStatus(`Importimi dështoi: ${e instanceof Error?e.message:String(e)}`)}
}
/** Edit a saved transcription in a draft; the original stored recording remains untouched. */
async function editSavedAudio():Promise<void>{
  const song=currentSong();
  if(!song || selectedId==='__draft')return;
  if(draft&&draft.id!==song.id){
    const old=allSongs(savedSongs,catalogSongs).find(s=>s.id===draft!.id);
    if(!old||JSON.stringify(old)!==JSON.stringify(draft))editHistories.delete(draft.id);
  }
  stopPlayback(); editingSongId=song.id; importFile=null;selectedImportedHit=null; $('analyzeBtn').setAttribute('disabled','');
  draft={...song,notes:song.notes.map(n=>({...n}))};
  stanzas=sanitizeStanzas(song.stanzas);
  importedHits=song.notes.map(n=>({...n,string:n.noteNumber===14?2:n.string,confidence:n.confidence??1,withF:n.withF!==false,upperNoteNumber:upperFret(n.upperNoteNumber),detail:'Ruajtur'}));
  analysisRowsVisible=60; selectedId='__draft';manualPending=null;manualMode=true;instantTabNoteMode=false;
  draftBaseline=structuredClone(draft);
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
  return noteAttackColor(importedHits.filter(h=>h.noteNumber!==null) as NoteEvent[],hit as NoteEvent,stanzas[i]?.color||STANZA_COLORS[i%STANZA_COLORS.length]);
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
  if(!draft || !importedHits.includes(hit))return;
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
    label.addEventListener('change',()=>{s.label=label.value.trim()||`Grupi ${i+1}`;updateImportDraft('Emërtimi i grupit');renderImportedHits();});
    const time=document.createElement('input');time.type='number';time.min='0';time.step='1';time.value=String(s.start);time.disabled=i===0;
    time.setAttribute('aria-label',`Fillimi i grupit ${i+1} në milisekonda`);
    time.addEventListener('change',()=>{
      const index=stanzas.findIndex(g=>g.start===s.start);
      applyGroupMarkerPosition(index,Number(time.value));
    });
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-minimal';remove.textContent='⇤';remove.disabled=i===0;
    remove.setAttribute('aria-label',`Bashko grupin ${i+1} me grupin para`);remove.title='Bashko grupet; notat ruhen';
    remove.addEventListener('click',()=>{
      // Grupet e fshira nuk duhet të lënë referenca të vdekura në notat e ruajtura.
      for(const hit of importedHits)if(hit.groupStart===s.start)delete hit.groupStart;
      stanzas=stanzas.filter(x=>x!==s);updateImportDraft('Bashkimi i grupeve');renderImportedHits();
    });
    const choose=document.createElement('button');choose.type='button';choose.className='btn btn-minimal group-choose';
    choose.textContent=s.start===selectedGroupStart?'✓ Zgjedhur':'Zgjidh';choose.setAttribute('aria-label',`Zgjidh ${s.label}`);
    choose.addEventListener('click',()=>{selectGroup(s.start);renderStanzas();});
    const color=document.createElement('input');color.type='color';color.className='group-color-picker';color.value=s.color||GROUP_COLORS[i%GROUP_COLORS.length];color.setAttribute('aria-label',`Ngjyra e grupit ${i+1}`);
    color.addEventListener('change',()=>{s.color=color.value;updateImportDraft('Ngjyra e grupit');renderImportedHits();});
    row.append(label,time,color,choose,remove);target.append(row);
  }
}
/** Importimi ruan skedarin e plotë, ndërsa notat e zbuluara mbeten propozime të korrigjueshme. */
function updateImportDraft(label='Redaktimi i notave'):void {
  if(!draft)return;
  const before=editorSnapshot(draftBaseline??draft);
  draft.notes=importedHits.filter(h=>h.noteNumber!==null).map(h=>({
    time:Math.round(h.time),noteNumber:h.noteNumber!,string:(h.noteNumber===14?2:h.string) as 1|2,
    confidence:h.confidence,velocity:h.velocity,measuredHz:h.measuredHz,withF:h.string===2?undefined:h.withF!==false,upperNoteNumber:upperFret(h.upperNoteNumber),
    ...(Number.isFinite(h.groupStart)?{groupStart:h.groupStart}:{})
  })).sort((a,b)=>a.time-b.time||a.string-b.string);
  draft.stanzas=sanitizeStanzas(stanzas);commitEditorChange(before,label);
  renderSongs();renderManualMode();refreshTabNoteEditor();
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
  refreshTabNoteEditor();redrawTab();
}
function insertNoteBelow(hit:GuessedHit):void {
  if(!draft)return;
  importedHits.sort((a,b)=>a.time-b.time);
  const index=importedHits.indexOf(hit);
  if(index<0)return;
  const sameGroup=importedHits.filter(h=>groupForNote(stanzas,h)===groupForNote(stanzas,hit)).sort((a,b)=>a.time-b.time);
  const following=sameGroup[sameGroup.indexOf(hit)+1]||importedHits[index+1];
  // Koha vendoset mes dy goditjeve; nëse janë njëkohësisht, ruajmë të njëjtën kohë.
  const durationMs=Number.isFinite(originalPlayer.duration)?Math.round(originalPlayer.duration*1000):3_600_000;
  const nextTime=following?(following.time>hit.time+1?Math.floor((hit.time+following.time)/2):hit.time):Math.min(durationMs,hit.time+200);
  const newHit:GuessedHit={time:nextTime,noteNumber:null,string:1,...accompaniment(),
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
  editor.hidden=selectedId!=='__draft' || !draft;
  const editable=editableTab();
  if(!importedHits.includes(selectedImportedHit as GuessedHit))selectedImportedHit=null;
  $('analysisAddBtn').toggleAttribute('disabled',!editable || !selectedImportedHit);
  $('stanzaAddBtn').toggleAttribute('disabled',!editable || !selectedImportedHit);
  $('groupAutoBtn').toggleAttribute('disabled',!editable || importedHits.length<3);
  if(!editable){$('stanzaList').replaceChildren();$('selectedNoteHint').textContent='Prek një notë për ta zgjedhur.';refreshTabNoteEditor();return;}
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
    const fCheck=document.createElement('input');fCheck.type='checkbox';fCheck.checked=hit.string===1&&hit.noteNumber!==14&&hit.withF!==false;fCheck.disabled=hit.string===2||hit.noteNumber===14;
    fCheck.setAttribute('aria-label','Teli lart shoqërues për këtë notë');
    const upper=document.createElement('select');upper.className='upper-pick';
    upper.setAttribute('aria-label','Perdja e telit lart për këtë notë');fillUpperOptions(upper);
    upper.value=String(upperFret(hit.upperNoteNumber));upper.disabled=fCheck.disabled||!fCheck.checked;
    fCheck.addEventListener('change',()=>{hit.withF=fCheck.checked;upper.disabled=!fCheck.checked;useNotePlayback();updateImportDraft();});
    upper.addEventListener('change',()=>{hit.upperNoteNumber=upperFret(Number(upper.value));useNotePlayback();updateImportDraft();});
    fLabel.append(fCheck,upper);
    const status=document.createElement('span');status.className='analysis-confidence';
    status.textContent=hit.noteNumber===null?'?':hit.confidence<.65?'Kontrollo':'✓';status.title=hit.detail;
    const seek=document.createElement('button');seek.type='button';seek.className='btn btn-minimal';seek.textContent='▶';seek.title='Dëgjo nga kjo goditje';
    seek.addEventListener('click',()=>{seekToMs(hit.time);void toggleTabPlay();});
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
      hit.noteNumber=n;hit.string=n===14?2:n===15?1:hit.string;hit.confidence=n===null?0:1;
      hit.detail=n===null?'Pa notë':'Korrigjuar manualisht';updateImportDraft();renderImportedHits();
    });
    row.append(ms,fret,fLabel,status,seek,plus,remove,up,down,split);rows.append(row);
  });
  $('analysisMoreBtn').hidden=analysisRowsVisible>=grouped.length;refreshTabNoteEditor();
}
async function importAudioFile(file:File):Promise<void>{
  if(analyzing)return;
  if(file.size>25_000_000){setStatus('Audioja është mbi 25 MB. Përdor regjistrim më të shkurtër.');return;}
  if(!file.type.startsWith('audio/') && !/\.(wav|m4a|mp3|ogg)$/i.test(file.name)){setStatus('Zgjidh skedar audio WAV, M4A ose MP3.');return;}
  stopPlayback();manualPending=null;manualMode=true;instantTabNoteMode=false;selectedGroupStart=0;tabCurrentMs=0;tabViewStartMs=0;tabFollowPlayback=true;importFile=file;importedHits=[];selectedImportedHit=null;stanzas=[{start:0,label:'Grupi 1',color:GROUP_COLORS[0]}];editingSongId=null;analysisRowsVisible=60;
  draft=newSong(file.name.replace(/\.[^.]+$/,''),[]);draft.originalAudioId='__draft';draft.stanzas=stanzas;draftBaseline=structuredClone(draft);selectedId='__draft';
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
    importedHits=report.hits.map(h=>({...h,...accompaniment()}));selectedImportedHit=null;analysisRowsVisible=60;
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


async function loadPublicCatalog():Promise<void> {
 try {
  const res=await fetch('./songs/catalog.json',{cache:'no-store'});if(!res.ok)return;
  const metas=(await res.json()) as {id:string;name:string;json:string;audio:string}[];if(!Array.isArray(metas))return;
  for(const m of metas){
   if(typeof m.id!=='string'||typeof m.json!=='string'||typeof m.name!=='string')continue;
   const file=await fetch(m.json);if(!file.ok)continue;const song=(await file.json()) as Song;
   if(!Array.isArray(song.notes)||!song.notes.length)continue;
   const id='catalog:'+m.id;catalogSongs.push({...song,id:m.id,name:m.name,originalAudioId:id});
   if(typeof m.audio==='string')catalogAudioURLs.set(id,m.audio);
  }
  renderSongs();
 }catch(e){console.warn('Katalogu nuk u ngarkua',e);}
}
async function connectCatalogAudio(file:File):Promise<void> {
 const song=currentSong();if(!song?.originalAudioId||!catalogSongs.some(s=>s.id===song.id))return;
 if(!/\.(mp3|m4a|wav|ogg)$/i.test(file.name)){setStatus('Zgjidh MP3/M4A/WAV/OGG.');return;}
 try{await putOriginal(song.originalAudioId,file);if(selectedId===song.id)showOriginalBlob(file,song.originalAudioId);setStatus('MP3 u lidh në këtë pajisje. Tani mund të luash këngën dhe grupet.');}
 catch(e){setStatus('Ruajtja e MP3 dështoi: '+String(e));}
}

function init():void {
  $('groupCopyBtn').addEventListener('click',copySelectedGroup);
  $('groupPasteBtn').addEventListener('click',()=>void pasteCopiedGroup());
  $('groupDeleteBtn').addEventListener('click',requestGroupDelete);
  $('groupDuplicateBtn').addEventListener('click',()=>void duplicateSelectedGroup());
  $('groupPasteMode').addEventListener('change',refreshGroupCopyControls);
  $('groupPasteTarget').addEventListener('change',()=>{
    const value=$<HTMLSelectElement>('groupPasteTarget').value;
    if(value&&value!=='__end')selectGroup(Number(value));
    else refreshGroupCopyControls();
  });
  $('groupUndoBtn').addEventListener('click',()=>undoEditorChange());
  $('groupRedoBtn').addEventListener('click',()=>undoEditorChange(true));
  $('groupDeleteCancelBtn').addEventListener('click',()=>$<HTMLDialogElement>('groupDeleteDialog').close());
  $('groupDeleteConfirmBtn').addEventListener('click',()=>void confirmGroupDelete());
  $('groupDeleteDialog').addEventListener('close',()=>{pendingGroupDelete=null;refreshHistoryControls();});
  $('jsonEditorDialog').addEventListener('close',refreshHistoryControls);
  window.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
    const focused=document.activeElement as HTMLElement|null;
    if(focused?.closest('input,textarea,select,[contenteditable=true]')||historyBlocked())return;
    const key=e.key.toLowerCase();
    if(key==='z'){e.preventDefault();undoEditorChange(e.shiftKey);}
    else if(key==='y'&&!e.shiftKey){e.preventDefault();undoEditorChange(true);}
  });
  $('jsonEditBtn').addEventListener('click',openJSONEditor);
  $('jsonValidateBtn').addEventListener('click',()=>validateJSONEditor());
  $('jsonFormatBtn').addEventListener('click',()=>validateJSONEditor(true));
  $('jsonApplyBtn').addEventListener('click',applyJSONEditor);
  $('jsonCancelBtn').addEventListener('click',()=>$<HTMLDialogElement>('jsonEditorDialog').close());
  initNoteControls();
  installTabInteraction();
  $('practiceAllBtn').addEventListener('click',()=>void playCurrent());
  $('practiceGroupBtn').addEventListener('click',()=>void playSelectedGroup());
  $('practicePauseBtn').addEventListener('click',()=>void toggleTabPlay());
  $('practiceStopBtn').addEventListener('click',()=>$<HTMLButtonElement>('stopBtn').click());
  $('practiceGroupSelect').addEventListener('change',e=>selectGroup(Number((e.target as HTMLSelectElement).value)));
  $('practiceSpeedSelect').addEventListener('change',e=>{
    const shared=$<HTMLSelectElement>('playbackSpeed');shared.value=(e.target as HTMLSelectElement).value;
    shared.dispatchEvent(new Event('change',{bubbles:true}));
  });
  $('tabNoteLeftBtn').addEventListener('click',()=>editSelectedTabNote(-50));
  $('tabNoteRightBtn').addEventListener('click',()=>editSelectedTabNote(50));
  $('tabNoteDeleteBtn').addEventListener('click',deleteSelectedTabNote);
  $('instantTabNoteBtn').addEventListener('click',()=>{
    if(!instantTabNoteMode && !editableTab()){
      const song=currentSong();
      if(song && selectedId!=='__draft'){
        void editSavedAudio().then(()=>{instantTabNoteMode=true;manualMode=true;renderManualMode();setStatus('Kliko kudo mbi tablaturë për të vendosur notën te sekonda e zgjedhur.');});
      }else setStatus('Importo një këngë audio për të përdorur Kliko kudo → Notë.');
      return;
    }
    instantTabNoteMode=!instantTabNoteMode;
    if(instantTabNoteMode)manualMode=true;
    renderManualMode();
    setStatus(instantTabNoteMode?'Kliko kudo në tablaturë për të ndalur te sekonda dhe për të shkruar perden.':'Mënyra Kliko kudo u çaktivizua.');
  });
  $('manualModeBtn').addEventListener('click',()=>{
    if(!editableTab()){
      const song=currentSong();
      if(song&&selectedId!=='__draft'){
        void editSavedAudio().then(()=>{manualMode=true;renderManualMode();setStatus('Shënimi manual është aktiv te kënga e ruajtur.');});
      }else setStatus('Importo këngë audio që të shënosh notat me dorë.');
      return;
    }
    setManualMode(!manualMode);
  });
  $('manualTimeSeconds').addEventListener('input',()=>{
    if(!manualPending)return;
    const value=$<HTMLInputElement>('manualTimeSeconds').value,seconds=Number(value);
    if(!value.trim()||!Number.isFinite(seconds)||seconds<0||seconds*1000>activeSeekEndMs())return;
    manualPending.time=Math.round(seconds*1000);
    $('manualTimeLabel').textContent=`${preciseTime(manualPending.time)} s`;
    redrawTab();
  });
  $('manualSetBtn').addEventListener('click',()=>commitManualNote(false));
  $('manualContinueBtn').addEventListener('click',()=>commitManualNote(true));
  $('manualCancelBtn').addEventListener('click',cancelManualNote);
  $('manualClearBtn').addEventListener('click',()=>{
    if(!editableTab()||!importedHits.length)return;
    if(!confirm('Të fshihen të gjitha notat e kësaj prove? Audioja origjinale dhe grupet mbeten.'))return;
    cancelManualNote();importedHits=[];selectedImportedHit=null;updateImportDraft('Pastrimi i notave');renderImportedHits();renderManualMode();
    setStatus('U pastruan notat e provës. Ndryshimi ruhet vetëm kur shtyp Ruaj.');
  });
  renderManualMode();
  renderInstrument();renderKeys();renderSongs();renderMicHits();
  audio.setVolume(Number($<HTMLInputElement>('volume').value)/100);
  $('catalogAudioBtn').addEventListener('click',()=>$<HTMLInputElement>('catalogAudioFile').click());
  $('catalogAudioFile').addEventListener('change',()=>{const el=$<HTMLInputElement>('catalogAudioFile');if(el.files?.[0])void connectCatalogAudio(el.files[0]);el.value='';});
  $('songSelect').addEventListener('change',e=>{stopPlayback();manualPending=null;manualMode=false;instantTabNoteMode=false;renderManualMode();selectedGroupStart=0;tabViewStartMs=0;tabCurrentMs=0;tabFollowPlayback=true;selectedId=(e.target as HTMLSelectElement).value;$<HTMLSelectElement>('groupPasteTarget').value='';renderSongs();renderImportedHits();void prepareOriginalForSelection();});
  $('recordBtn').addEventListener('click',recordKeyboard);
  $('micBtn').addEventListener('click',()=>void toggleMic());
  $('playBtn').addEventListener('click',()=>void toggleTabPlay());
  $('groupPlayBtn').addEventListener('click',()=>void playSelectedGroup());
  $('selectedGroupSelect').addEventListener('change',e=>selectGroup(Number((e.target as HTMLSelectElement).value)));
  $('playbackSpeed').addEventListener('change',e=>{
    if(audio.playing)seekToMs(playbackPositionMs()); // Ndalo planifikimin e vjetër para ndryshimit të shpejtësisë.
    const requestedSpeed=Number((e.target as HTMLSelectElement).value);
    playbackSpeed=([1,0.5,0.25].includes(requestedSpeed)?requestedSpeed:1);
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
    if(!draft||!selectedImportedHit)return;
    createGroupAtHit(selectedImportedHit);
  });
  $('groupAutoBtn').addEventListener('click',()=>{
    if(!draft || !importedHits.length)return;
    if(stanzas.length>1 && !confirm('Të zëvendësohen ndarjet e grupeve me ato të zbuluara nga pauzat?'))return;
    // Rigrupimi automatik e rivendos anëtarësinë sipas kohës; zgjedhjet manuale zëvendësohen.
    importedHits.forEach(h=>delete h.groupStart);
    stanzas=autoStanzas(importedHits);selectedGroupStart=0;updateImportDraft('Ndarja automatike e grupeve');renderImportedHits();
    setStatus(`U ndanë ${stanzas.length} grupe sipas pauzave. Mund t’i korrigjosh vetë.`);
  });
  $('analysisAddBtn').addEventListener('click',()=>{
    if(!draft||!selectedImportedHit){setStatus('Prek së pari një notë në listë.');return;}
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
    const song=currentSong();if(!usingOriginal(song)){originalPlayer.pause();return;}
    audio.stop();cancelAnimationFrame(playFrame);const token=++playToken;
    $('playBtn').textContent=currentPlayMode==='group'?'▶ Luaj':'▶ Po luhet';$('studioState').textContent=currentPlayMode==='group'?'GRUPI':'ORIGJINAL';
    const tick=()=>{
      if(token!==playToken||originalPlayer.paused)return;
      const ms=originalPlayer.currentTime*1000;
      if(currentPlayMode==='group'&&activeGroupEndMs!==null&&ms>=activeGroupEndMs-12){completeGroupPlayback();return;}
      drawTab(song,ms);
      $('timeLabel').textContent=`${fmt(ms)} / ${fmt((originalPlayer.duration||0)*1000)}`;
      updatePlaybackNotes(song!,ms);
      playFrame=requestAnimationFrame(tick);
    };tick();
    setStatus('Po luhet regjistrimi origjinal. 220 Hz nuk shtohet artificialisht.');
  });
  originalPlayer.addEventListener('pause',()=>{if(!usingOriginal(currentSong()))return;cancelAnimationFrame(playFrame);clearPlayedNote();if(usingOriginal(currentSong())){$('playBtn').textContent='▶ Luaj';$('studioState').textContent='PAUZË';syncTabTransport();}});
  originalPlayer.addEventListener('ended',()=>{if(!usingOriginal(currentSong()))return;stopPlayback();setStatus('Kënga origjinale përfundoi.');});
  originalPlayer.addEventListener('timeupdate',()=>{
    const song=currentSong();if(!usingOriginal(song))return;
    const ms=originalPlayer.currentTime*1000;
    if(currentPlayMode==='group'&&activeGroupEndMs!==null&&ms>=activeGroupEndMs-12){completeGroupPlayback();return;}
    drawTab(song,ms);
    $('timeLabel').textContent=`${fmt(ms)} / ${fmt((originalPlayer.duration||0)*1000)}`;
    if(!originalPlayer.paused)updatePlaybackNotes(song!,ms);
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
    if($<HTMLDialogElement>('jsonEditorDialog').open||$<HTMLDialogElement>('groupDeleteDialog').open)return;
    if(e.repeat||e.altKey||e.metaKey||e.ctrlKey||['INPUT','TEXTAREA','SELECT'].includes((document.activeElement?.tagName||'')))return;
    const index=KEYS.indexOf(e.key.toLowerCase());if(index>=0){e.preventDefault();void hit(index+1,index===13?2:1);}
    if(e.code==='Space'){e.preventDefault();void toggleTabPlay();}
  });
  window.addEventListener('resize',()=>renderTimeline());
  window.addEventListener('pagehide',()=>{if(micActive)mic.stop();audio.stop();originalPlayer.pause();});
  $('status').textContent='Gati për të luajtur.';
  // Marrja e regjistrimeve nuk nis zërin pa një veprim të përdoruesit.
  void audio.prepare();
    void loadPublicCatalog();
}
init();
window.dispatchEvent(new Event('ciftelia-studio-ready'));
