import assert from 'node:assert/strict';

for(const directory of ['../js/']){
  const {withOpenF,HZ,upperPlaybackRate,noteFrequency}=await import(`${directory}constants.js`);
  const {notesAtMoment,noteAttackColor}=await import(`${directory}practice.js`);
  const {manualNote}=await import(`${directory}manual.js`);
  const {newSong,saveSongs,loadSongs}=await import(`${directory}songs.js`);
  const {AudioEngine}=await import(`${directory}audio-engine.js`);
  const lower=(n,time,extra={})=>({string:1,noteNumber:n,time,...extra});
  const upper=(n,time)=>({string:2,noteNumber:n,time});
  const notes=[lower(8,100),lower(8,200,{upperNoteNumber:5}),lower(8,300,{withF:false}),upper(3,450)];
  const copy=structuredClone(notes);
  const expanded=withOpenF(notes);
  assert.deepEqual(expanded.filter(n=>n.string===2).map(n=>[n.noteNumber,n.time]),[[14,100],[5,200],[3,450]]);
  assert.deepEqual(notes,copy,'expansion never rewrites saved notes');
  assert.deepEqual(withOpenF(notes,false),notes.slice(0,3),'lower-only removes fretted and open upper notes');
  assert.equal(withOpenF([lower(2,100),upper(7,100)]).length,2,'explicit upper note overrides automatic F');
  assert.deepEqual(withOpenF([upper(7,100)]),[upper(7,100)],'upper fret never gets another companion');
  assert.equal(withOpenF([lower(2,100,{upperNoteNumber:99})])[1].noteNumber,14,'invalid companion falls back to F');
  for(let n=1;n<=13;n++){
    assert.equal(upperPlaybackRate(n),HZ[n-1]/HZ[14]);
    assert.ok(Math.abs(noteFrequency(n,2)-220*HZ[n-1]/HZ[14])<1e-9);
  }
  assert.equal(upperPlaybackRate(14),1);
  const repeated=[lower(8,100),lower(8,200),lower(8,300),lower(7,400),lower(8,500)];
  assert.deepEqual(repeated.map(n=>noteAttackColor(repeated,n,'#e8b45a')),
    ['#e8b45a','#ff8e88','#e8b45a','#e8b45a','#e8b45a']);
  assert.deepEqual(notesAtMoment(repeated,210),[repeated[1]],'a fast repetition replaces the previous highlight');
  assert.equal(noteAttackColor(withOpenF(repeated),withOpenF(repeated)[3],'#63d9c9'),'#b5a3ff','upper attacks alternate too');
  const manual=manualNote(6,1200,true,0,1,4);
  assert.equal(manual.upperNoteNumber,4);
  assert.equal(manualNote(6,1200,true,0,2).string,2,'upper canvas supports all frets');
  assert.equal(manualNote(6,1200,true,0,2).withF,false);
  const state=new Map();
  globalThis.localStorage={getItem:key=>state.get(key)??null,setItem:(key,value)=>state.set(key,value)};
  const saved=newSong('Telat',[manual,lower(8,1500,{withF:false})]);
  assert.ok(saveSongs([saved]));
  assert.equal(loadSongs()[0].notes[0].upperNoteNumber,4);
  assert.equal(loadSongs()[0].notes[1].withF,false);
  assert.deepEqual(withOpenF(JSON.parse(JSON.stringify(saved)).notes).map(n=>[n.string,n.noteNumber]),[[1,6],[2,4],[1,8]]);

  let voices=[];
  class Param{value=0;setValueAtTime(){}linearRampToValueAtTime(){}cancelScheduledValues(){}}
  class Node{connect(other){return other;}disconnect(){}}
  class Gain extends Node{gain=new Param();}
  class Source extends Node{playbackRate=new Param();start(at){this.at=at;voices.push(this);}stop(at){this.end=at;}}
  class Context{
    currentTime=10;state='running';destination={};
    createGain(){return new Gain();}
    createDynamicsCompressor(){return Object.assign(new Node(),{threshold:new Param(),knee:new Param(),ratio:new Param(),attack:new Param(),release:new Param()});}
    createBufferSource(){return new Source();}
    resume(){return Promise.resolve();}
  }
  globalThis.window={AudioContext:Context};
  const engine=new AudioEngine();
  engine.loadNote=async n=>({duration:3,n});
  await engine.hit(6);
  assert.deepEqual(voices.map(v=>v.buffer.n),[6,14],'live playing accompanies with F by default');
  voices=[];await engine.hit(6,1,true,4);
  assert.equal(voices[1].buffer.n,14,'upper fret uses open upper string sample');
  assert.equal(voices[1].playbackRate.value,upperPlaybackRate(4));
  assert.ok(voices[1].end-voices[1].at<=3/upperPlaybackRate(4)+.011,'shifted sample duration is respected');
  voices=[];await engine.hit(6,1,false);
  assert.deepEqual(voices.map(v=>v.buffer.n),[6],'live opt-out');
  voices=[];await engine.hit(8,2);
  assert.equal(voices.length,1);assert.equal(voices[0].buffer.n,14);assert.equal(voices[0].playbackRate.value,upperPlaybackRate(8));
  engine.upperEnabled=false;voices=[];
  await engine.hit(14);await engine.hit(4,2);assert.equal(voices.length,0,'muted upper cannot be played directly');
  await engine.play({id:'test',name:'test',createdAt:'',notes},.25);
  assert.deepEqual(voices.map(v=>v.buffer.n),[8,8,8],'lower-only playback uses no upper samples');
  assert.ok(Math.abs((voices[1].at-voices[0].at)-.4)<1e-9,'slow motion preserves attack intervals');
  engine.stop();engine.upperEnabled=true;voices=[];
  await engine.play({id:'test',name:'test',createdAt:'',notes});
  assert.equal(voices.length,6,'automatic, custom, disabled and explicit upper events all schedule correctly');
  assert.ok(voices.some(v=>v.playbackRate.value===upperPlaybackRate(5)));
  let release;
  engine.loadNote=()=>new Promise(resolve=>{release=()=>resolve({duration:3,n:8});});
  engine.upperEnabled=false;voices=[];
  const pending=engine.play({id:'test',name:'test',createdAt:'',notes:[lower(8,0)]});
  await Promise.resolve();await Promise.resolve();
  engine.stop();release();await pending;
  assert.equal(voices.length,0,'stopping while loading cannot start stale playback');
  console.log(`OK ${directory}: default/custom/off accompaniment, lower-only, repeat colors, storage and cancellation`);
}
