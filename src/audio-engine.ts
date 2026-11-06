import {Song, withOpenF} from './constants.js';

type Strength = 'lehte'|'fort';
type Voice = {source:AudioBufferSourceNode; gain:GainNode; at:number; end:number; level:number; string:1|2};

/** Sample-based instrument: 30 authentic attacks from the user's own instrument.
 * All playback is at 1x speed; NO pitch shifting and NO artificial 293 Hz oscillator.
 */
export class AudioEngine {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private buffers=new Map<string,AudioBuffer>();
  private decoding=new Map<string,Promise<AudioBuffer>>();
  private downloads=new Map<string,Promise<ArrayBuffer>>();
  private sources=new Set<AudioBufferSourceNode>();
  private lastByString=new Map<1|2,Voice>();
  private playbackStart=0;
  private finish=0;
  private active=false;
  volume=.8;
  mode:'short'|'full'='short';
  strength:Strength='fort';
  get ctx():AudioContext|null{return this.context;}
  get playing():boolean{return this.active;}
  get elapsedMs():number{return this.context&&this.active?Math.max(0,(this.context.currentTime-this.playbackStart)*1000):0;}
  get endMs():number{return Math.max(0,(this.finish-this.playbackStart)*1000);}

  async unlock():Promise<AudioContext>{
    if(!this.context){
      this.context=new (window.AudioContext || (window as any).webkitAudioContext)({latencyHint:'interactive'});
      const master=this.context.createGain();master.gain.value=this.volume;
      // Gentle peak guard only; not a voice filter, noise gate, or pitch converter.
      const limiter=this.context.createDynamicsCompressor();
      limiter.threshold.value=-3;limiter.knee.value=3;limiter.ratio.value=12;
      limiter.attack.value=.003;limiter.release.value=.14;
      master.connect(limiter).connect(this.context.destination);
      this.master=master;
    }
    if(this.context.state!=='running')await this.context.resume();
    return this.context;
  }
  setVolume(v:number):void{this.volume=Math.max(0,Math.min(1,v));if(this.master)this.master.gain.value=this.volume;}

  private request(key:string,url:string):Promise<ArrayBuffer>{
    let job=this.downloads.get(key);
    if(!job){
      job=fetch(url).then(r=>{if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return r.arrayBuffer();});
      this.downloads.set(key,job);
    }
    return job;
  }
  private async decode(key:string,url:string):Promise<AudioBuffer>{
    const cached=this.buffers.get(key);if(cached)return cached;
    let task=this.decoding.get(key);if(task)return task;
    task=(async()=>{
      const ctx=await this.unlock();
      const arr=await this.request(key,url);
      // Some Safari versions detach the ArrayBuffer passed to decodeAudioData.
      const decoded=await ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(key,decoded);return decoded;
    })();
    this.decoding.set(key,task);
    try{return await task;}catch(e){this.decoding.delete(key);this.downloads.delete(key);throw e;}
  }
  private key(n:number,strength:Strength):string{return `nota${n}_${strength}`;}
  async loadNote(n:number,strength:Strength=this.strength):Promise<AudioBuffer>{
    if(!Number.isInteger(n)||n<1||n>15)throw Error('Numri i notës nuk është i vlefshëm.');
    const key=this.key(n,strength);
    try{return await this.decode(key,`./assets/audio-real/${key}.m4a`);}
    catch(e){
      // Old samples remain as a last-resort compatibility fallback for 1-14.
      if(n===15)throw Error('Mungon regjistrimi real i telit poshtë 293 Hz.');
      const old=`nota${n}${this.mode==='short'?'_shkurt':''}`;
      console.warn('Regjistrimi i ri nuk u ngarkua, po përdoret rezervë:',key,e);
      return this.decode(old,`./assets/audio/${old}.m4a`);
    }
  }
  /** Start downloads without unlocking audio. All 30 recordings can be used offline after being loaded once. */
  async prepare():Promise<void>{
    const keys=Array.from({length:15},(_,i)=>i+1).flatMap(n=>[this.key(n,'fort'),this.key(n,'lehte')]);
    // Limit concurrent network work, especially on mobile.
    let index=0;
    const worker=async()=>{while(index<keys.length){const key=keys[index++];try{await this.request(key,`./assets/audio-real/${key}.m4a`);}catch{}}};
    await Promise.all(Array.from({length:4},worker));
  }
  async preload():Promise<void>{await Promise.all(Array.from({length:15},(_,i)=>this.loadNote(i+1,this.strength)));}

  private schedule(buffer:AudioBuffer,at:number,string:1|2,level:number):number{
    const ctx=this.context!;
    const previous=this.lastByString.get(string);
    if(previous && at<previous.end && at>=previous.at){
      // Actual string is damped by the next pluck; avoids muddy overlaps.
      const release=.07;
      previous.gain.gain.cancelScheduledValues(at);
      previous.gain.gain.setValueAtTime(previous.level,at);
      previous.gain.gain.linearRampToValueAtTime(.0001,at+release);
      try{previous.source.stop(at+release+.01);}catch{}
    }
    const src=ctx.createBufferSource();src.buffer=buffer;
    const gain=ctx.createGain();
    const duration=Math.min(buffer.duration,this.mode==='short'?1.45:buffer.duration);
    const end=at+duration;
    const fade=Math.min(.14,duration*.17);
    gain.gain.setValueAtTime(0,at);
    gain.gain.linearRampToValueAtTime(level,at+.003);
    gain.gain.setValueAtTime(level,Math.max(at+.004,end-fade));
    gain.gain.linearRampToValueAtTime(.0001,end);
    src.connect(gain).connect(this.master!);
    const voice={source:src,gain,at,end,level,string};
    this.lastByString.set(string,voice);
    this.sources.add(src);
    src.onended=()=>{this.sources.delete(src);if(this.lastByString.get(string)===voice)this.lastByString.delete(string);try{src.disconnect();gain.disconnect();}catch{}};
    src.start(at);src.stop(end+.01);
    return duration;
  }
  async hit(noteNumber:number):Promise<void>{
    await this.unlock();
    const noteList=noteNumber===14?[14]:[noteNumber,14];
    const types:Strength[]=noteList.map((_,i)=>i===1?'lehte':this.strength);
    const buffers=await Promise.all(noteList.map((n,i)=>this.loadNote(n,types[i])));
    const at=this.context!.currentTime+.014;
    noteList.forEach((n,i)=>{
      const string:1|2=n===14?2:1;
      const base=n===14?(noteNumber===14?.76:.49):.9;
      const level=base*(types[i]==='lehte'?.82:1);
      this.schedule(buffers[i],at,string,level);
    });
  }
  stop():void{
    this.active=false;
    for(const s of this.sources){try{s.stop();}catch{}}
    this.sources.clear();this.lastByString.clear();
  }
  async play(song:Song):Promise<number>{
    await this.unlock();this.stop();
    if(!song.notes.length)throw Error('Kënga nuk ka nota.');
    const events=withOpenF(song.notes).sort((a,b)=>a.time-b.time || a.string-b.string);
    const strengthFor=(e:typeof events[number]):Strength=>e.velocity!==undefined?(e.velocity<.56?'lehte':'fort'):(e.string===2?'lehte':this.strength);
    const keys=new Map<string,{n:number;strength:Strength}>();
    for(const e of events){const strength=strengthFor(e);keys.set(this.key(e.noteNumber,strength),{n:e.noteNumber,strength});}
    const loaded=new Map<string,AudioBuffer>();
    await Promise.all([...keys.entries()].map(async([key,v])=>loaded.set(key,await this.loadNote(v.n,v.strength))));
    const ctx=this.context!;
    this.playbackStart=ctx.currentTime+.10;
    let finish=this.playbackStart;
    for(const e of events){
      const strength=strengthFor(e);const buffer=loaded.get(this.key(e.noteNumber,strength));if(!buffer)continue;
      const at=this.playbackStart+e.time/1000;
      const base=e.string===2?.48:.9;
      const level=base*(strength==='lehte'?.82:1);
      const duration=this.schedule(buffer,at,e.string,level);
      finish=Math.max(finish,at+duration);
    }
    this.finish=finish;this.active=true;
    return Math.round((finish-this.playbackStart)*1000);
  }
  done():boolean{if(this.active && this.context && this.context.currentTime>=this.finish){this.active=false;return true;}return false;}
}
