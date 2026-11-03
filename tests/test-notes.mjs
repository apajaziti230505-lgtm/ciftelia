import assert from 'node:assert/strict';
import {HZ,hzToNote,KEYS,TOLERANCE} from '../js/constants.js';
import {matchPitch} from '../js/pitch.js';
const sr=48000;
let matches=0;
for(let i=0;i<HZ.length;i++){
  const hz=HZ[i];
  assert.equal(hzToNote(hz)?.noteNumber,i+1);
  assert.equal(hzToNote(hz-14)?.noteNumber,i+1);
  assert.equal(hzToNote(hz+14)?.noteNumber,i+1);
  const samples=Float32Array.from({length:4608},(_,t)=>.22*Math.sin(2*Math.PI*hz*t/sr)+.11*Math.sin(4*Math.PI*hz*t/sr)+.07*Math.sin(6*Math.PI*hz*t/sr));
  const found=matchPitch(samples,sr);
  assert.equal(found.noteNumber,i+1,`Pitch estimate failed at ${hz}Hz`);
  matches++;
}
assert.equal(KEYS.join(''),'qwertyuiopasdf');
assert.equal(TOLERANCE,15);
console.log(`OK: ${matches}/14 nota, ±14 Hz rreth frekuencave referencë, QWERTYUIOPASDF.`);
