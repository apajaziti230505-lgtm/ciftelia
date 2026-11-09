import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {AudioEngine} from '../js/audio-engine.js';
import {withOpenF} from '../js/constants.js';
const root=new URL('../',import.meta.url);
let decoded=0, voices=[];
class AudioParam {
  value=0;
  setValueAtTime(v){this.value=v;}
  linearRampToValueAtTime(v){this.value=v;}
  cancelScheduledValues(){}
}
class Node {
 connect(other){return other;}disconnect(){}
}
class MockGain extends Node{gain=new AudioParam;}
class MockDynamics extends Node{threshold=new AudioParam;knee=new AudioParam;ratio=new AudioParam;attack=new AudioParam;release=new AudioParam;}
class MockSource extends Node{buffer=null;onended=null;start(at){this.at=at;voices.push(this);}stop(){} }
class FakeAudioContext {
  currentTime=1;state='running';destination={};
  createGain(){return new MockGain();}
  createDynamicsCompressor(){return new MockDynamics();}
  createBufferSource(){return new MockSource();}
  resume(){return Promise.resolve();}
  decodeAudioData(buffer){assert.ok(buffer.byteLength>200,'nonempty audio');decoded++;return Promise.resolve({duration:2.7});}
}
globalThis.window={AudioContext:FakeAudioContext};
globalThis.fetch=async url=>{
 const filename=new URL(url,root);
 try {const buf=await fs.readFile(filename);return {ok:true,status:200,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)};}
 catch{return {ok:false,status:404,arrayBuffer:async()=>{throw Error('not found');}};}
};
const engine=new AudioEngine();
await engine.unlock();
engine.strength='lehte';
await engine.hit(15);
assert.equal(voices.length,2,'lower 293 Hz + upper 220 Hz');
engine.strength='fort';await engine.hit(1);
assert.equal(voices.length,4,'fret 1 + upper string');
await engine.hit(14);
assert.equal(voices.length,5,'upper 220 Hz alone');
const song={id:'test',name:'test',createdAt:'',notes:[{string:1,noteNumber:15,time:0,velocity:.3},{string:1,noteNumber:2,time:150,velocity:.9}]};
assert.deepEqual(withOpenF(song.notes).filter(x=>x.noteNumber===14).map(x=>x.time),[0,150]);
const duration=await engine.play(song);
assert.ok(duration>=150);
assert.equal(voices.length,9,'two melody + two accompanying real samples');
assert.ok(decoded>=5);
for(const strength of ['lehte','fort'])for(let n=1;n<=15;n++)await engine.loadNote(n,strength);
assert.equal(decoded,30,'all 30 active recordings are available without legacy audio copies');
console.log('OK: real 293+220 strings, soft/strong, four scheduled song events, decoded samples',decoded);
