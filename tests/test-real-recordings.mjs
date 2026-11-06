import fs from 'node:fs';
import {matchPitch} from '../js/pitch.js';
import {HZ} from '../js/constants.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../Ciftelia_15_Nota_WAV_Real/',import.meta.url));
function wavPCM24(path){
 const b=fs.readFileSync(path);
 let i=12, offset=-1,length=0;
 while(i+8<=b.length){const chunk=b.toString('ascii',i,i+4); const size=b.readUInt32LE(i+4);if(chunk==='data'){offset=i+8;length=size;break;} i+=8+size+(size%2);}
 if(offset<0)throw Error('No data chunk');
 const count=length/3; const out=new Float32Array(count);
 for(let j=0;j<count;j++){let v=b.readUInt8(offset+3*j)|(b.readUInt8(offset+3*j+1)<<8)|(b.readUInt8(offset+3*j+2)<<16);if(v&0x800000)v-=0x1000000;out[j]=v/8388608;}
 return out;
}
let correct=0,unknown=0;const report=[];
for(let n=1;n<=15;n++)for(const strength of ['lehte','fort']){
 const wave=wavPCM24(`${root}/nota${n}_${strength}.wav`);
 const analysis=wave.slice(Math.round(.115*48000),Math.round(.115*48000)+4608);
 const res=matchPitch(analysis,48000);
 if(res.noteNumber===n)correct++;if(!res.noteNumber)unknown++;
 report.push([n,strength,res.noteNumber,res.hz?.toFixed(1)??'?',res.clarity?.toFixed(2)]);
}
console.log('Real audio detection',correct+'/30','unknown',unknown);
console.log(report.map(x=>x.join('\t')).join('\n'));
