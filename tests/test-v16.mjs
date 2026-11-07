import assert from 'node:assert/strict';
import {manualTapTime} from '../js/manual.js';
import {timelineTime, timelineX} from '../js/timeline.js';
const left=128,scale=.145,view=9000;
for(const time of [9000,9100,9875,10999,13000]) {
  const x=timelineX(time,view,left,scale);
  assert.equal(manualTapTime(true,950000,x,view,left,scale,180000),time);
  assert.equal(Math.round(timelineTime(x,view,left,scale)),time);
}
assert.equal(manualTapTime(true,30000,273,0,left,scale,180000),1000);
assert.equal(manualTapTime(false,0,-100,0,left,scale,180000),0);
console.log('OK V16: sekonda të sakta, klikimi dominon mbi pozicionin e audios.');
