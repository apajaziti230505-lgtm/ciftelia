import assert from 'node:assert/strict';
import {HZ,hzToNote,KEYS,TOLERANCE,MIN_MIC_HZ} from '../js/constants.js';
import {matchPitch} from '../js/pitch.js';
const sr=48000;
let matches=0;
for(let i=0;i<HZ.length;i++){
  const hz=HZ[i];
  if(hz < MIN_MIC_HZ) {assert.equal(hzToNote(hz),null);continue;}
  assert.equal(hzToNote(hz)?.noteNumber,i+1);
  assert.equal(hzToNote(hz-14)?.noteNumber,hz-14<MIN_MIC_HZ?undefined:i+1);
  assert.equal(hzToNote(hz+14)?.noteNumber,i+1);
  const samples=Float32Array.from({length:4608},(_,t)=>.22*Math.sin(2*Math.PI*hz*t/sr)+.11*Math.sin(4*Math.PI*hz*t/sr)+.07*Math.sin(6*Math.PI*hz*t/sr));
  const found=matchPitch(samples,sr);
  assert.equal(found.noteNumber,i+1,`Pitch estimate failed at ${hz}Hz`);
  matches++;
}
assert.equal(KEYS.join(''),'qwertyuiopasdf');
assert.equal(TOLERANCE,15);
assert.equal(MIN_MIC_HZ,230);
for (const hz of [1,100,200,220,229.99]) assert.equal(hzToNote(hz),null);
console.log(`OK: ${matches}/13 nota aktive me mikrofon, nota F 220 Hz e bllokuar nën pragun 230 Hz, ±15 Hz.`);
