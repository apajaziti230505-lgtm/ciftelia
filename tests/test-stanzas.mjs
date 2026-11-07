import assert from 'node:assert/strict';
import {withOpenF} from '../js/constants.js';
const mixed=withOpenF([
  {string:1,noteNumber:4,time:0},
  {string:1,noteNumber:5,time:220,withF:false},
  {string:1,noteNumber:6,time:440},
  {string:2,noteNumber:14,time:440}
]);
assert.equal(mixed.filter(e=>e.noteNumber===14).length,2,'F default only for 2 of 3 notes');
assert.ok(mixed.some(e=>e.noteNumber===14&&e.time===0));
assert.ok(!mixed.some(e=>e.noteNumber===14&&e.time===220),'F false must suppress accompaniment');
assert.equal(mixed.filter(e=>e.noteNumber===14&&e.time===440).length,1,'do not duplicate F');
console.log('OK: F companion default, opt-out per note, no doubling.');
