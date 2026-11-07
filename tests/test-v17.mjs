import assert from 'node:assert/strict';
import {manualAnywhereTime} from '../js/manual.js';
import {timelineGeometry,timelineX} from '../js/timeline.js';
const geometry=timelineGeometry(1200);
const viewStart=4000, duration=90000;
for(const t of [4000,4111,4500,6123,8000]){
  const x=timelineX(t,viewStart,geometry.left,geometry.scale);
  assert.equal(manualAnywhereTime(x,viewStart,geometry.left,geometry.scale,geometry.width,geometry.right,duration),t,`Click at ${t}ms`);
}
assert.equal(manualAnywhereTime(-100,viewStart,geometry.left,geometry.scale,geometry.width,geometry.right,duration),viewStart);
assert.equal(manualAnywhereTime(90000,viewStart,geometry.left,geometry.scale,geometry.width,geometry.right,duration),Math.round(viewStart+geometry.visibleMs));
assert.equal(manualAnywhereTime(NaN,viewStart,geometry.left,geometry.scale,geometry.width,geometry.right,duration),viewStart);
// The click's y-coordinate is deliberately absent from the time mapping.
console.log('OK V17: çdo zonë horizontale jep sekondën e njëjtë dhe kufijtë janë të sigurt.');
