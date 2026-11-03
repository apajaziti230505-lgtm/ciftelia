// Runs inside the browser's audio rendering thread (AudioWorklet).
// Accurate timestamps use audio frame numbers, not setTimeout or Date.now.
declare const currentFrame:number;
declare const sampleRate:number;
declare function registerProcessor(name:string, processor:any):void;
declare class AudioWorkletProcessor { readonly port:MessagePort; }
class CifteliaOnsets extends AudioWorkletProcessor {
  private fast=0;
  private slow=0;
  private since=1e9;
  private collecting:Float32Array|null=null;
  private position=0;
  private onsetFrame=0;
  private sensitivity=5;
  private armed=true;
  private release=0;
  constructor(){super();this.port.onmessage=(e:MessageEvent)=>{if(typeof e.data?.sensitivity==='number')this.sensitivity=e.data.sensitivity;};}
  process(inputs:Float32Array[][]):boolean {
    const ch=inputs[0]?.[0];if(!ch)return true;
    for(let i=0;i<ch.length;i++){
      const a=Math.abs(ch[i]);
      this.fast+=.035*(a-this.fast);
      this.slow+=.00050*(a-this.slow);
      this.since++;
      if(this.collecting){
        this.collecting[this.position++]=ch[i];
        if(this.position===this.collecting.length){
          const out=this.collecting;
          this.port.postMessage({type:'onset',at:this.onsetFrame/sampleRate,sampleRate,samples:out},[out.buffer]);
          this.collecting=null;this.position=0;
        }
      }
      const threshold=Math.max(.0035,(.013-.0007*this.sensitivity));
      const ratio=2.9-.115*this.sensitivity;
      if(!this.armed){
        if(this.fast<Math.max(threshold*.75,this.slow*1.28)) this.release++;
        else this.release=0;
        if(this.release>sampleRate*.009){this.armed=true;this.release=0;}
      }
      if(this.armed && !this.collecting && this.since>sampleRate*.085 && this.fast>threshold && this.fast>this.slow*ratio){
        this.onsetFrame=currentFrame+i;
        this.collecting=new Float32Array(4608);
        this.collecting[this.position++]=ch[i];
        this.since=0;this.armed=false;
      }
    }
    return true;
  }
}
registerProcessor('ciftelia-onsets',CifteliaOnsets);
export {};
