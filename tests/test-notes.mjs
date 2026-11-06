import assert from 'node:assert/strict';
import {HZ,hzToNote,KEYS,TOLERANCE,MIN_MIC_HZ,withOpenF} from '../js/constants.js';
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
assert.equal(KEYS.join(''),'qwertyuiopasdfg');
assert.equal(TOLERANCE,15);
assert.equal(MIN_MIC_HZ,205);
for (const hz of [1,100,200,204.99]) assert.equal(hzToNote(hz),null);
for (const hz of [205,219,220,235]) assert.equal(hzToNote(hz)?.noteNumber,14);
assert.equal(hzToNote(236),null);
// Në çdo notë të melodisë shto F vetëm një herë, pa ndryshuar kohën e goditjes.
const base=[{string:1,noteNumber:4,time:0},{string:1,noteNumber:5,time:150},{string:2,noteNumber:14,time:150},{string:1,noteNumber:14,time:300}];
const decorated=withOpenF(base);
assert.equal(decorated.length,5);
assert.deepEqual(decorated.filter(e=>e.noteNumber===14).map(e=>e.time),[0,150,300]);
assert.deepEqual(base.map(e=>e.noteNumber),[4,5,14,14]);
const lower=[{string:1,noteNumber:15,time:0}];
const paired=withOpenF(lower);
assert.deepEqual(paired.map(e=>[e.noteNumber,e.string,e.time]),[[15,1,0],[14,2,0]]);
assert.equal(hzToNote(293)?.noteNumber,15);
assert.equal(hzToNote(278)?.noteNumber,15);
assert.equal(hzToNote(308)?.noteNumber,15);
assert.equal(hzToNote(277),null);
assert.equal(hzToNote(309),null);
console.log(`OK: ${matches}/15 nota aktive, G 293 Hz + F 220 Hz; ±15 Hz.`);
