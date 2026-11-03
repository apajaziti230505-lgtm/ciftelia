import {NoteEvent,Song} from './constants.js';
export class AudioEngine {
  private context:AudioContext|null=null;
  private buffers=new Map<string,AudioBuffer>();
  private downloads=new Map<string,Promise<ArrayBuffer>>();
  private sources=new Set<AudioBufferSourceNode>();
  private master:GainNode|null=null;
  private playbackStart=0;
  private finish=0;
  private active=false;
  private warmupStarted=false;
  volume=0.8;
  mode:'full'|'short'='short';
  get ctx():AudioContext|null {return this.context;}
  get playing():boolean {return this.active;}
  get elapsedMs():number {return this.context && this.active ? Math.max(0,(this.context.currentTime-this.playbackStart)*1000):0;}
  get endMs():number {return Math.max(0,(this.finish-this.playbackStart)*1000);}
  // Kërkohet me HTTPS ose localhost për mikrofonin; WAV mund të ngarkohet në të dyja.
  async prepare():Promise<void> {
    const variants=['','_shkurt'];
    const tasks:Promise<unknown>[]=[];
    for(let n=1;n<=14;n++) for(const v of variants){
      const key=`nota${n}${v}`;
      if(!this.downloads.has(key)) this.downloads.set(key,fetch(`assets/audio/${key}.wav`).then(r=>{if(!r.ok)throw new Error(`${key}.wav: HTTP ${r.status}`);return r.arrayBuffer();}));
      tasks.push(this.downloads.get(key)!.catch(()=>undefined));
    }
    await Promise.all(tasks);
  }
  async unlock():Promise<AudioContext> {
    if(!this.context){
      this.context=new (window.AudioContext || (window as any).webkitAudioContext)({latencyHint:'interactive'});
      this.master=this.context.createGain(); this.master.gain.value=this.volume;
      this.master.connect(this.context.destination);
    }
    // Duhet të thirret direkt në veprimin e përdoruesit për Safari.
    if(this.context.state!=='running') await this.context.resume();
    return this.context;
  }
  setVolume(v:number):void {this.volume=Math.max(0,Math.min(1,v));if(this.master)this.master.gain.value=this.volume;}
  async loadNote(noteNumber:number):Promise<AudioBuffer> {
    const ctx=await this.unlock();
    const order=this.mode==='short'?[`nota${noteNumber}_shkurt`,`nota${noteNumber}`]:[`nota${noteNumber}`,`nota${noteNumber}_shkurt`];
    for(const key of order){
      if(this.buffers.has(key)) return this.buffers.get(key)!;
      try {
        let task=this.downloads.get(key);
        if(!task){task=fetch(`assets/audio/${key}.wav`).then(r=>{if(!r.ok)throw Error(`${r.status}`);return r.arrayBuffer()});this.downloads.set(key,task);}
        const arr=await task;
        const decoded=await ctx.decodeAudioData(arr.slice(0));
        this.buffers.set(key,decoded);return decoded;
      }catch(e){console.warn(`Nuk u ngarkua ${key}`,e);}
    }
    throw new Error(`Mungon tingulli nota${noteNumber}.wav. Kontrollo assets/audio.`);
  }
  async preload():Promise<void> { await Promise.all([...Array(14)].map((_,i)=>this.loadNote(i+1))); }
  private makeSource(buffer:AudioBuffer,at:number):void {
    const ctx=this.context!,src=ctx.createBufferSource();src.buffer=buffer;
    const gain=ctx.createGain();gain.gain.setValueAtTime(0.97,at);gain.gain.exponentialRampToValueAtTime(0.001,at+Math.min(0.45,buffer.duration));
    src.connect(gain).connect(this.master!);
    this.sources.add(src);src.onended=()=>{this.sources.delete(src);src.disconnect();gain.disconnect();};
    src.start(at);src.stop(at+Math.min(buffer.duration,0.55));
  }
  async hit(noteNumber:number):Promise<void> {
    // Nxjerr zë edhe kur nota përsëritet shpejt.
    await this.unlock(); const buff=await this.loadNote(noteNumber);
    this.makeSource(buff,this.context!.currentTime+0.006);
    if(!this.warmupStarted){this.warmupStarted=true;void this.preload().catch(()=>{});}
  }
  stop():void {
    this.active=false;
    for(const s of this.sources){try{s.stop()}catch{}}
    this.sources.clear();
  }
  async play(song:Song):Promise<number> {
    await this.unlock();
    this.stop();
    if(!song.notes.length) throw new Error('Kjo këngë nuk ka nota.');
    const unique=[...new Set(song.notes.map(n=>n.noteNumber))];
    await Promise.all(unique.map(n=>this.loadNote(n)));
    const ctx=this.context!;
    this.playbackStart=ctx.currentTime+0.080;
    for(const ev of song.notes){
      const key=this.mode==='short'?`nota${ev.noteNumber}_shkurt`:`nota${ev.noteNumber}`;
      const b=this.buffers.get(key) || this.buffers.get(`nota${ev.noteNumber}`) || this.buffers.get(`nota${ev.noteNumber}_shkurt`);
      if(b)this.makeSource(b,this.playbackStart+ev.time/1000);
    }
    this.active=true;
    this.finish=this.playbackStart+Math.max(...song.notes.map(n=>n.time))/1000+0.6;
    return Math.round((this.finish-this.playbackStart)*1000);
  }
  done():boolean { if(this.active && this.context && this.context.currentTime>=this.finish){this.active=false;return true;}return false; }
}
