import assert from 'node:assert/strict';
import {timelineGeometry,timelineX,timelineTime,clampTimelineStart,clampGroupBoundary,findGroupBoundary} from '../js/timeline.js';
import {groupForNote} from '../js/grouping.js';
import {withOpenF} from '../js/constants.js';

const g=timelineGeometry(420);
assert(g.left>50 && g.visibleMs>1000);
assert.equal(Math.round(timelineTime(timelineX(1400,300,g.left,g.scale),300,g.left,g.scale)),1400);
assert.equal(clampTimelineStart(-500,g.visibleMs,10000),0);
assert(clampTimelineStart(90000,g.visibleMs,10000)<10000);
const groups=[{start:0,color:'#e8b45a'},{start:1400,color:'#42bdae'},{start:2600,color:'#b894f6'}];
assert.equal(findGroupBoundary(groups,timelineX(1400,300,g.left,g.scale),300,g.left,g.scale),1);
assert.equal(findGroupBoundary(groups,timelineX(1400,300,g.left,g.scale)+37,300,g.left,g.scale),-1);
assert.equal(clampGroupBoundary(groups,1,1800,5000),1800);
assert.equal(clampGroupBoundary(groups,1,3000,5000),2520); // cannot cross group 3
assert.equal(clampGroupBoundary(groups,1,30,5000),80);
assert.equal(clampGroupBoundary(groups,0,300,5000),null);
const moved={time:900,noteNumber:4,string:1,groupStart:1400};
assert.equal(groupForNote(groups,moved),1);
const synthesized=withOpenF([moved]);
assert.equal(synthesized.length,2);
assert.equal(synthesized.find(n=>n.noteNumber===14)?.groupStart,1400);
console.log('OK V14: navigim horizontal, kufij të tërheqshëm, grupet nuk kalojnë njëri-tjetrin, F merr ngjyrën e notës.');
