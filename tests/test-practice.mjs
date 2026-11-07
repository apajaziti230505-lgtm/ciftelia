import assert from 'node:assert/strict';
import {currentPluck,nextMelodyNote} from '../js/practice.js';
const notes=[{time:0,noteNumber:1},{time:0,noteNumber:14},{time:200,noteNumber:2},{time:500,noteNumber:3}];
assert.equal(currentPluck(notes,0).length,2);
assert.equal(currentPluck(notes,100).length,2);
assert.equal(currentPluck(notes,199).length,1); // next note near its onset
assert.equal(currentPluck(notes,200)[0].noteNumber,2);
assert.equal(currentPluck(notes,430).length,0);
assert.equal(currentPluck(notes,900).length,0);
assert.equal(currentPluck(notes,-10).length,0);
assert.equal(nextMelodyNote(notes,0)?.noteNumber,2);
assert.equal(nextMelodyNote(notes,200)?.noteNumber,3);
assert.equal(nextMelodyNote(notes,900),undefined);
console.log('OK V18: clear on silence/stop, next note, simultaneous F.');
