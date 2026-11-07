import assert from 'node:assert/strict';
import {manualTapTime,manualNote} from '../js/manual.js';
// Clicked position is authoritative even when the audio is playing.
assert.equal(manualTapTime(true,1257,273,2000,128,.145,180000),3000);
// When paused, tapping near x=273 on a view starting at 2s yields 3s.
assert.equal(manualTapTime(false,0,273,2000,128,.145,180000),3000);
assert.equal(manualTapTime(false,0,50,0,128,.145,180000),0);
assert.equal(manualTapTime(true,999999,99999,0,128,.145,180000),180000);
const low=manualNote(5,1257,true,200);assert.deepEqual(low,{time:1257,noteNumber:5,string:1,confidence:1,withF:true,groupStart:200,detail:'Vendosur manualisht'});
const upper=manualNote(14,1300,true,0);assert.equal(upper.withF,false);assert.equal(upper.string,2);
assert.throws(()=>manualNote(17,100));assert.throws(()=>manualNote(3,-10));
console.log('OK V16: pointer time always wins, correct strings and 220 Hz accompaniment.');
