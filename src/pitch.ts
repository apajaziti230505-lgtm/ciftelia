import {hzToNote} from './constants.js';
// YIN autocorrelation difference with parabolic interpolation; pitch only after transient.
export function estimatePitch(samples:Float32Array,sampleRate:number):{hz:number;clarity:number}|null {
  if(samples.length<1200) return null;
  const step=Math.max(1,Math.floor(sampleRate/24000));
  const fs=sampleRate/step;
  const start=Math.min(samples.length-1000,Math.round(sampleRate*.008));
  const end=Math.min(samples.length, start+Math.round(sampleRate*.072));
  const n=Math.floor((end-start)/step);
  if(n<500)return null;
  const x=new Float32Array(n);
  let avg=0,energy=0;
  for(let i=0;i<n;i++){x[i]=samples[start+i*step]||0;avg+=x[i];}
  avg/=n;
  for(let i=0;i<n;i++){x[i]-=avg;energy+=x[i]*x[i];}
  if(Math.sqrt(energy/n)<.002) return null;
  const minTau=Math.max(2,Math.floor(fs/1110));
  const maxTau=Math.min(Math.floor(fs/195),Math.floor(n/2)-1);
  const diff=new Float64Array(maxTau+1);
  for(let tau=1;tau<=maxTau;tau++){
    let sum=0;
    for(let i=0;i<n-maxTau;i++) {const d=x[i]-x[i+tau];sum+=d*d;}
    diff[tau]=sum;
  }
  let run=0;const norm=new Float64Array(maxTau+1);
  norm[0]=1;
  for(let tau=1;tau<=maxTau;tau++){run+=diff[tau];norm[tau]=run>0?diff[tau]*tau/run:1;}
  // Prefer earliest significant trough to avoid octave-down errors.
  let best=-1;
  for(let t=minTau;t<maxTau;t++){
    if(norm[t]<.15 && norm[t]<=norm[t-1] && norm[t]<=norm[t+1]) {best=t;break;}
  }
  if(best<0){let min=1;for(let t=minTau;t<=maxTau;t++)if(norm[t]<min){min=norm[t];best=t;}}
  if(best<0 || norm[best]>.42)return null;
  const prev=norm[Math.max(1,best-1)],curr=norm[best],next=norm[Math.min(maxTau,best+1)];
  const d=prev-2*curr+next;
  const offset=Math.abs(d)>1e-12?Math.max(-1,Math.min(1,.5*(prev-next)/d)):0;
  const hz=fs/(best+offset);
  return {hz,clarity:Math.max(0,Math.min(1,1-curr))};
}
export function matchPitch(samples:Float32Array,sampleRate:number):{noteNumber:number|null;hz:number|null;clarity:number} {
  const p=estimatePitch(samples,sampleRate);
  if(!p)return {noteNumber:null,hz:null,clarity:0};
  return {noteNumber:hzToNote(p.hz)?.noteNumber||null,hz:p.hz,clarity:p.clarity};
}
