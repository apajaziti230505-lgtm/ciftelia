// @ts-nocheck
/* Çiftelia Studio – audio origjinale -> goditje -> tablaturë e korrigjueshme.
   Runs offline in the browser; estimates are never presented as certain. */
const holder = document.createElement('section');
holder.className = 'panel';
holder.id = 'transcriber';
holder.innerHTML =
  '<div class="panel-heading"><div><h2>Analizo një këngë</h2><p>Audio origjinale + nota dhe kohë të korrigjueshme</p></div></div>'+
  '<div class="tr-tools"><input id="tr-file" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg" aria-label="Importo audio">'+
  '<button id="tr-analyze" type="button" class="btn btn-primary" disabled>Analizo notat</button>'+
  '<select id="tr-library" aria-label="Këngët e analizuara"><option value="">Këngët e ruajtura</option></select></div>'+
  '<audio id="tr-player" controls preload="metadata" aria-label="Kënga origjinale" hidden></audio>'+
  '<div class="tr-progress"><progress id="tr-progress" max="100" value="0"></progress><span id="tr-info" role="status">Ngarko një MP3, M4A ose WAV. Maksimumi 150 s / 25 MB.</span></div>'+
  '<canvas id="tr-canvas" height="124" aria-label="Tablatura e këngës origjinale"></canvas>'+
  '<div class="tr-tools"><button id="tr-add" class="btn" type="button" disabled>+ Shto notë te koha aktuale</button>'+
  '<button id="tr-save" class="btn" type="button" disabled>Ruaj këngën + tablaturën</button>'+
  '<button id="tr-delete" class="btn btn-danger" type="button" disabled>Fshi këngën</button>'+
  '<button id="tr-export" class="btn btn-minimal" type="button" disabled>Eksporto tablaturën JSON</button></div>'+
  '<p class="tr-tip">220 Hz nuk shtohet automatikisht. Notat me ? janë të pasigurta. Zgjidh perden dhe ndrysho kohën në milisekonda. Audioja dhe tablatura ruhen vetëm në këtë pajisje, jo në GitHub.</p>'+
  '<div id="tr-rows" class="tr-rows"></div><button id="tr-more" type="button" class="btn btn-minimal" hidden>Shfaq më shumë</button>';
document.querySelector('.tab-section').insertAdjacentElement('afterend',holder);
const trCSS = document.createElement('style');
trCSS.textContent = '#transcriber{margin-top:16px}#transcriber .tr-tools{display:flex;flex-wrap:wrap;gap:9px;margin:12px 0;align-items:center}#transcriber input[type=file],#transcriber select,#transcriber input[type=number]{background:#172c42;color:#e9f1f5;border:1px solid #4c6175;padding:9px;border-radius:9px;max-width:100%;min-width:0}#transcriber .tr-progress{display:flex;align-items:center;gap:12px;color:#a8c1d1;font-size:12px;flex-wrap:wrap}#transcriber progress{width:150px;accent-color:#edb76b}#tr-player{width:100%;margin:8px 0}#tr-player[hidden]{display:none}#tr-canvas{display:block;width:100%;border:1px solid #31465c;border-radius:10px;background:#102032;margin:12px 0}#transcriber .tr-tip{color:#abbec9;font-size:11px;line-height:1.5}#transcriber .tr-rows{display:grid;gap:6px;max-height:420px;overflow:auto}#transcriber .tr-row{display:grid;grid-template-columns:105px minmax(100px,1fr) 100px 105px 70px 34px;gap:6px;align-items:center;border:1px solid #344a62;background:#12243b;padding:7px;border-radius:9px}#transcriber .tr-row.tr-uncertain{border-color:#b99850}#transcriber .tr-row button{padding:8px;min-height:32px}#transcriber .tr-row span{font-size:11px;color:#d9c3a4}#tr-more{margin-top:9px}@media(max-width:700px){#transcriber .tr-row{grid-template-columns:1fr 1fr 1fr;gap:5px}#transcriber .tr-row button{min-height:30px;font-size:11px}#tr-player{height:52px}}';
document.head.append(trCSS);
const el = id => document.getElementById(id);
const player=el('tr-player'),fileInput=el('tr-file'), progress=el('tr-progress'), info=el('tr-info');
const choices=Array.from({length:15},(_,i)=>i+1);
let file=null,decoded=null,events=[],activeId=null,fileUrl=null,displayLimit=70,busy=false;
const context = new (window.AudioContext || window.webkitAudioContext)({latencyHint:'interactive'});
const FFT=2048,SMALL=512,FS=16000,HOP=160;
const window2048=Float32Array.from({length:FFT},(_,i)=>(1-Math.cos(2*Math.PI*i/(FFT-1)))/2);
const window512=Float32Array.from({length:SMALL},(_,i)=>(1-Math.cos(2*Math.PI*i/(SMALL-1)))/2);
function message(s,p){info.textContent=s;if(Number.isFinite(p))progress.value=p;}
function join(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function normalized(a){const mag=Math.sqrt(join(a,a)+1e-12);return a.map(x=>x/mag);}
function downsample(b){
 const n=Math.round(b.duration*FS),out=new Float32Array(n),rate=b.sampleRate/FS;
 const a=b.getChannelData(0),c=b.numberOfChannels>1?b.getChannelData(1):a;
 for(let i=0;i<n;i++){const j=i*rate,k=Math.floor(j),f=j-k;out[i]=((a[k]||0)*(1-f)+(a[k+1]||0)*f+(c[k]||0)*(1-f)+(c[k+1]||0)*f)/2;}
 return out;
}
function fft(samples,start,n,w){
 const re=new Float32Array(n),im=new Float32Array(n);
 for(let i=0;i<n;i++)re[i]=(samples[start+i]||0)*w[i];
 let j=0;for(let i=1;i<n;i++){let bit=n>>1;while(j&bit){j^=bit;bit>>=1;}j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;}}
 for(let l=2;l<=n;l*=2){const angle=-2*Math.PI/l,ca=Math.cos(angle),sa=Math.sin(angle);for(let i=0;i<n;i+=l){let wr=1,wi=0;for(let k=0;k<l/2;k++){const a=i+k,b=a+l/2,u=wr*re[b]-wi*im[b],v=wr*im[b]+wi*re[b];re[b]=re[a]-u;im[b]=im[a]-v;re[a]+=u;im[a]+=v;let tr=wr*ca-wi*sa;wi=wr*sa+wi*ca;wr=tr;}}}
 const out=new Float32Array(n/2);for(let i=0;i<n/2;i++)out[i]=Math.hypot(re[i],im[i]);return out;
}
function feature(signal,start){
 const result=new Float32Array(420);let count=0;
 for(const offset of [0,200]){
   const pos=Math.max(0,Math.round(start)+offset);
   if(pos+FFT>=signal.length)continue;
   const sp=fft(signal,pos,FFT,window2048);
   const f=new Float32Array(420);for(let k=0;k<420;k++)f[k]=Math.sqrt(sp[k+21]);
   const normalizedFeature=normalized(f);for(let k=0;k<420;k++)result[k]+=normalizedFeature[k];count++;
 }
 return count?normalized(result):result;
}
function onsets(signal){
 const count=Math.floor((signal.length-SMALL)/HOP),env=new Float32Array(count),flux=new Float32Array(count);
 let prev=null,peak=0;
 for(let i=0;i<count;i++){const at=i*HOP;let sum=0;for(let k=0;k<HOP;k++)sum+=signal[at+k]**2;env[i]=Math.sqrt(sum/HOP);peak=Math.max(peak,env[i]);
  if(i%2===0){const cur=fft(signal,at,SMALL,window512);if(prev){let rise=0,total=.001;for(let k=12;k<256;k++){rise+=Math.max(0,cur[k]-prev[k]);total+=cur[k];}flux[i]=rise/total;}prev=cur;}
  else flux[i]=flux[i-1]*.85;
 }
 const hits=[];let last=-20;const floor=Math.max(.002,peak*.075);
 for(let i=5;i<count-5;i++){
  if(env[i]<floor||i-last<9)continue;
  const past=(env[i-1]+env[i-2]+env[i-3]+env[i-4])/4;
  const score=.7*flux[i]+.3*Math.max(0,(env[i]-past)/Math.max(env[i],.001));
  if(score<.2||flux[i]<flux[i-2]||flux[i]<flux[i+2])continue;
  let j=i;while(j>0&&j>i-5&&env[j-1]>env[i]*.2&&env[j-1]<env[j]*1.05)j--;
  if(j-last<9)continue;hits.push(j*HOP);last=j;i+=7;if(hits.length>=800)break;
 }
 if(env[0]>floor*2 && (!hits.length||hits[0]>.15*FS))hits.unshift(0);
 return hits;
}
async function referenceBank(){
 const vectors=[];for(let n=1;n<=15;n++){
  const out=new Float32Array(420);let num=0;
  for(const strength of ['fort','lehte']){
   try{const response=await fetch('./assets/audio-real/nota'+n+'_'+strength+'.m4a');
    if(!response.ok)throw Error('HTTP '+response.status);
    const raw=await response.arrayBuffer(),b=await context.decodeAudioData(raw);
    const sig=downsample(b),f=feature(sig,450);
    for(let k=0;k<420;k++)out[k]+=f[k];num++;
   }catch(e){console.warn('Referencë e munguar',n,strength,e);}
  }
  if(num===0)throw Error('Mungon tingulli i notës '+n);
  vectors.push(normalized(out));
  if(n%3===0){message('Referencat '+n+'/15',15+n*2);await new Promise(r=>setTimeout(r,0));}
 }
 return vectors;
}
async function analyze(){
 if(!file||busy)return;busy=true;el('tr-analyze').disabled=true;fileInput.disabled=true;
 try{
  await context.resume();
  const buffer=await context.decodeAudioData((await file.arrayBuffer()).slice(0));
  if(buffer.duration>150)throw Error('Maksimumi 150 sekonda për analizë.');
  message('Po gjej goditjet...',5);
  const signal=downsample(buffer),hits=onsets(signal),templates=await referenceBank();
  if(!hits.length)throw Error('Nuk u gjetën goditje të qarta. Provo regjistrim më të pastër.');
  const f=templates[13],duos=templates.map((v,n)=>normalized(v.map((x,i)=>x+(n===13?0:.62)*f[i])));
  events=[];
  for(let i=0;i<hits.length;i++){
   const at=hits[i],next=hits[i+1]||signal.length;
   const offset=Math.min(at+512,Math.max(0,next-FFT));
   const cur=feature(signal,offset),prev=at>1024?feature(signal,Math.max(0,at-FFT-320)):new Float32Array(420);
   const fresh=normalized(cur.map((v,k)=>Math.max(0,v-.62*prev[k])));
   let best=-1,second=-1,idx=-1;
   for(let n=0;n<15;n++){const v=join(fresh,templates[n]);if(v>best){second=best;best=v;idx=n;}else second=Math.max(second,v);}
   let duoBest=-1,duoIdx=-1;
   for(let n=0;n<15;n++){if(n===13)continue;let v=join(fresh,duos[n]);if(v>duoBest){duoBest=v;duoIdx=n;}}
   const both=duoBest>best+.075&&duoBest>.7,score=both?duoBest:best;
   const sure=score>.72 && (both||best-second>.035);
   const time=Math.round(at*1000/FS);
   events.push({time,number:sure?(both?duoIdx+1:idx+1):null,string:sure&&idx===13&&!both?2:1,confidence:score});
   if(both)events.push({time,number:14,string:2,confidence:score});
   if(i%12===0){message('Analiza '+(i+1)+' / '+hits.length,45+Math.round(55*i/hits.length));await new Promise(r=>setTimeout(r,0));}
  }
  displayLimit=70;render();
  message('U gjetën '+hits.length+' goditje. '+events.filter(e=>e.number===null).length+' janë të paqarta. Korrigjo para ruajtjes.',100);
 }catch(err){message('Analiza nuk përfundoi: '+(err.message||err),0);}
 finally{busy=false;el('tr-analyze').disabled=!file;fileInput.disabled=false;}
}
function urlFor(blob){if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=URL.createObjectURL(blob);player.src=fileUrl;player.hidden=false;player.load();}
function idb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('ciftelia-studio-transcriptions',1);req.onupgradeneeded=()=>req.result.createObjectStore('songs',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function store(mode,obj){const db=await idb();return new Promise((resolve,reject)=>{const tx=db.transaction('songs',mode==='getAll'?'readonly':'readwrite'),s=tx.objectStore('songs'),req=mode==='getAll'?s.getAll():mode==='delete'?s.delete(obj):s.put(obj);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});}
async function library(){
 try{const songs=await store('getAll'),sel=el('tr-library');sel.replaceChildren(new Option('Këngët e ruajtura',''));songs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 for(const song of songs)sel.add(new Option(song.name,song.id));if(activeId)sel.value=activeId;
 }catch(e){message('Ruajtja lokale nuk është e disponueshme: '+e.message);}
}
async function selectSaved(id){
 try{const songs=await store('getAll'),s=songs.find(v=>v.id===id);if(!s)return;
  activeId=s.id;file=s.blob;events=s.notes;displayLimit=70;urlFor(file);
  el('tr-analyze').disabled=false;el('tr-delete').disabled=false;render();message('U hap '+s.name+'. Mund të korrigjosh dhe të ruash përsëri.',100);
 }catch(e){message('Gabim në lexim: '+e.message);}
}
function render(){
 events.sort((a,b)=>a.time-b.time||a.string-b.string);
 const box=el('tr-rows');box.replaceChildren();
 for(const h of events.slice(0,displayLimit)){
  const row=document.createElement('div');row.className='tr-row'+(h.number===null?' tr-uncertain':'');
  const time=document.createElement('input');time.type='number';time.min='0';time.step='1';time.value=h.time;time.title='Koha në milisekonda';
  const note=document.createElement('select');note.add(new Option('? - e pasigurt',''));
  for(const n of choices)note.add(new Option(n===14?'F · 220 Hz':n===15?'G · 293 Hz':'Perdja '+n,String(n)));note.value=h.number||'';
  const string=document.createElement('select');string.add(new Option('Poshtë','1'));string.add(new Option('Lart','2'));string.value=String(h.string);
  const confidence=document.createElement('span');confidence.textContent=h.number===null?'?':h.confidence<.68?'Kontrollo':'Propozim';
  const seek=document.createElement('button');seek.className='btn btn-minimal';seek.textContent='Dëgjo';
  seek.onclick=()=>{player.currentTime=h.time/1000;void player.play().catch(e=>message(String(e)));};
  const del=document.createElement('button');del.className='btn btn-minimal';del.textContent='×';del.title='Hiq notën';
  del.onclick=()=>{events=events.filter(v=>v!==h);render();};
  time.onchange=()=>{h.time=Math.max(0,Math.round(Number(time.value)||0));render();};
  note.onchange=()=>{h.number=note.value?Number(note.value):null;h.string=h.number===14?2:1;h.confidence=1;render();};
  string.onchange=()=>{h.string=h.number===14?2:Number(string.value);draw();};
  row.append(time,note,string,confidence,seek,del);box.append(row);
 }
 el('tr-more').hidden=displayLimit>=events.length;
 el('tr-save').disabled=!file;el('tr-export').disabled=!events.length;
 draw();
}
function draw(){
 const c=el('tr-canvas'),ctx=c.getContext('2d'),w=c.clientWidth||900,dpr=Math.min(devicePixelRatio||1,2);
 c.width=Math.round(w*dpr);c.height=124*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#102032';ctx.fillRect(0,0,w,124);
 for(const y of [43,92]){ctx.strokeStyle='#64748b';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
 ctx.font='11px sans-serif';ctx.fillStyle='#9dafbe';ctx.fillText('LART',7,30);ctx.fillText('POSHTË',7,79);
 const ms=player.currentTime*1000,zero=Math.min(150,w*.3),speed=.19;
 ctx.strokeStyle='#ebaf5e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(zero,12);ctx.lineTo(zero,116);ctx.stroke();
 for(const h of events){const x=zero+(h.time-ms)*speed;if(x<10||x>w-12)continue;const y=h.string===2?43:92;
  ctx.fillStyle=h.number===null?'#9e7b40':Math.abs(h.time-ms)<70?'#f5bb62':'#294456';ctx.beginPath();ctx.arc(x,y,11,0,7);ctx.fill();
  ctx.fillStyle='#f0e3ce';ctx.textAlign='center';ctx.font='11px sans-serif';ctx.fillText(h.number===null?'?':h.number===14?'F':h.number===15?'G':String(h.number),x,y+4);}
 ctx.textAlign='start';
}
function highlight(){
 const layer=document.getElementById('highlights'),ms=player.currentTime*1000;
 if(!layer)return;layer.replaceChildren();
 const hits=events.filter(h=>h.number!==null&&Math.abs(h.time-ms)<65);
 for(const h of hits){let x=1175,y=h.string===2?219:240;
  if(h.number<=13){const first=201,last=1009,den=1-Math.pow(2,-13/12);const xx=n=>first+(last-first)*(1-Math.pow(2,-n/12))/den;x=(xx(h.number-1)+xx(h.number))/2;}
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r','10');circle.setAttribute('fill','#f2b45a');layer.append(circle);}
}
let frame=0;
function loop(){draw();highlight();if(!player.paused)frame=requestAnimationFrame(loop);}
player.addEventListener('play',()=>{document.getElementById('stopBtn')?.click();cancelAnimationFrame(frame);loop();});
player.addEventListener('pause',()=>cancelAnimationFrame(frame));
player.addEventListener('seeked',()=>{draw();highlight();});
fileInput.addEventListener('change',()=>{
 const f=fileInput.files?.[0];if(!f)return;
 if(f.size>25000000){message('Skedari është mbi 25 MB.');return;}
 player.pause();file=f;activeId=null;events=[];displayLimit=70;urlFor(f);render();el('tr-analyze').disabled=false;el('tr-delete').disabled=true;
 el('tr-library').value='';message('U importua '+f.name+'. Shtyp Analizo notat.',0);
});
el('tr-analyze').addEventListener('click',()=>void analyze());
el('tr-library').addEventListener('change',e=>{if(e.target.value)void selectSaved(e.target.value);});
el('tr-add').addEventListener('click',()=>{if(!file)return;events.push({time:Math.round(player.currentTime*1000),number:null,string:1,confidence:0});displayLimit=Math.max(displayLimit,events.length);render();});
el('tr-more').addEventListener('click',()=>{displayLimit+=70;render();});
el('tr-save').addEventListener('click',async()=>{
 if(!file)return;const name=prompt('Emri i këngës:',activeId?el('tr-library').selectedOptions[0]?.text:file.name.replace(/\.[^.]+$/,''));if(!name?.trim())return;
 try{activeId=activeId||('song-'+Date.now()+'-'+Math.round(Math.random()*9999));await store('put',{id:activeId,name:name.trim().slice(0,70),createdAt:new Date().toISOString(),blob:file,notes:events});await library();el('tr-delete').disabled=false;message('U ruajt audioja origjinale dhe tablatura në këtë pajisje.',100);}
 catch(e){message('Ruajtja dështoi: '+(e.message||e));}
});
el('tr-delete').addEventListener('click',async()=>{
 if(!activeId||!confirm('Ta fshijmë këngën e ruajtur?'))return;
 try{await store('delete',activeId);activeId=null;file=null;events=[];player.pause();player.removeAttribute('src');player.hidden=true;render();await library();message('Kënga u fshi.');}
 catch(e){message('Fshirja dështoi: '+e.message);}
});
el('tr-export').addEventListener('click',()=>{
 const blob=new Blob([JSON.stringify({notes:events,format:'ciftelia-tablature-v1',audioNote:'Skedari origjinal ruhet veçmas në pajisje.'},null,2)],{type:'application/json'});
 const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download='ciftelia-tablature.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),500);
});
player.addEventListener('loadedmetadata',()=>{el('tr-add').disabled=false;draw();});
window.addEventListener('resize',draw);draw();void library();
export {};
