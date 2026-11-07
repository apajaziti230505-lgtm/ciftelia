import assert from 'node:assert/strict';
import { detectOnsets } from '../js/analysis.js';

const fs = 16000;
const actual = [0.25, 0.63, 1.12, 1.58, 2.13];
const samples = new Float32Array(3 * fs);
for (const time of actual) {
  for (let i = Math.round(time*fs); i < samples.length && i < Math.round((time+.24)*fs); i++) {
    const dt = i/fs-time;
    samples[i] += .6 * Math.sin(2*Math.PI*330*dt) * Math.exp(-16*dt) * (1-Math.exp(-400*dt));
  }
}
const found = detectOnsets(samples).map(index=>index/fs);
assert.equal(found.length, actual.length, `Expected 5 onsets, got ${found.join(', ')}`);
for (let i=0;i<actual.length;i++) assert.ok(Math.abs(found[i]-actual[i]) <= .05, `${found[i]} too far from ${actual[i]}`);
assert.equal(detectOnsets(new Float32Array(16000)).length,0,'Silence must not produce notes');
console.log('OK: 5/5 synthesized plucks detected; silence produces no false notes.');
