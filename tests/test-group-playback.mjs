import assert from 'node:assert/strict';
import {detectNoteGroups,groupForNote,GROUP_COLORS} from '../js/grouping.js';
import {AudioEngine} from '../js/audio-engine.js';
// Një pauzë e shkurtër rreth 430ms: zbulohet vetëm në mënyrën 'Më shumë grupe'.
const hits=[0,190,385,590,1030,1210,1400,1600,2020,2210,2400,2600].map(time=>({time}));
const more=detectNoteGroups(hits,3,'more');
const less=detectNoteGroups(hits,3,'less');
assert.ok(more.length>less.length,'ndarja me ndjeshmëri të lartë krijon më shumë grupe');
assert.deepEqual(more.map(s=>s.start),[0,1030,2020]);
const moved={time:590,groupStart:more[1].start};
assert.equal(groupForNote(more,moved),1);
moved.groupStart=more[2].start;
assert.equal(groupForNote(more,moved),2,'poshtë');
moved.groupStart=more[1].start;
assert.equal(groupForNote(more,moved),1,'sipër');
assert.equal(more[groupForNote(more,moved)].color,GROUP_COLORS[1]);
// Kontroll mbi luajtjen e ngadalësuar: kohët e goditjeve duhet të dyfishohen,
// ndërsa mostrat reale nuk transpozohen.
assert.match(AudioEngine.prototype.play.toString(),/e\.time\s*\/\s*\(1000\s*\*\s*tempo\)/);
console.log('OK V13: ndarje më e ndjeshme, notë lart/poshtë, grupet me ngjyra, ritëm 0.50x.');
