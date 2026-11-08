import assert from 'node:assert/strict';
for(const dir of ['../js/','../js/v27/']){
  const {moveNoteSelection}=await import(`${dir}note-selection.js`);
  const {EditHistory}=await import(`${dir}edit-history.js`);
  const notes=[{time:100,string:1,noteNumber:4,withF:false},
    {time:300,string:1,noteNumber:7,upperNoteNumber:8,velocity:.6},
    {time:450,string:2,noteNumber:3,groupStart:0},
    {time:900,string:1,noteNumber:8,withF:true},
    {time:1300,string:1,noteNumber:9}];
  const original=structuredClone(notes);
  const moved=moveNoteSelection(notes,[0,2,3],650);
  assert.equal(moved.delta,650);assert.deepEqual(moved.times,[750,300,1100,1550,1300]);
  assert.equal(moved.times[2]-moved.times[0],notes[2].time-notes[0].time);
  assert.equal(moved.times[3]-moved.times[2],notes[3].time-notes[2].time);
  const left=moveNoteSelection(notes,[0,2,3],-5000);
  assert.equal(left.delta,-100);assert.deepEqual(left.times,[0,300,350,800,1300]);
  const right=moveNoteSelection(notes,[0,3,4],5000,2000);
  assert.equal(right.delta,700);assert.deepEqual(right.times,[800,300,450,1600,2000]);
  assert.deepEqual(moveNoteSelection(notes,[0,0,2],50).times,[150,300,500,900,1300]);
  assert.deepEqual(moveNoteSelection(notes,[],500),{delta:0,times:notes.map(n=>n.time)});
  assert.equal(moveNoteSelection(notes,[0,2],40.6).delta,41);
  const chord=[{time:100,string:1,noteNumber:5},{time:100,string:2,noteNumber:14},{time:700,string:1,noteNumber:8}];
  assert.deepEqual(moveNoteSelection(chord,[0,1],600).times,[700,700,700]);
  assert.equal(moveNoteSelection([{time:3_599_950}],[0],500).delta,49);
  assert.throws(()=>moveNoteSelection(notes,[-1],5));assert.throws(()=>moveNoteSelection(notes,[20],5));
  assert.throws(()=>moveNoteSelection(notes,[1],NaN));assert.throws(()=>moveNoteSelection([{time:NaN}],[0],10));
  assert.throws(()=>moveNoteSelection(notes,[0,4],10,500));
  assert.deepEqual(notes,original,'selection movement never mutates input notes or accompaniment metadata');
  const before={song:{id:'batch',name:'Provë',createdAt:'',notes:original,stanzas:[{start:0,label:'Grupi 1'}]},selectedGroupStart:0,time:0};
  const after=structuredClone(before);after.song.notes=after.song.notes.map((n,i)=>({...n,time:moved.times[i]}));
  const history=new EditHistory();history.record(before,after,'Zhvendosja e 3 notave');
  assert.equal(history.undoCount,1);assert.deepEqual(history.undo(after).snapshot,before);
  assert.deepEqual(history.redo(before).snapshot,after);
  assert.equal(after.song.notes[0].withF,false);assert.equal(after.song.notes[1].upperNoteNumber,8);
  assert.equal(after.song.notes[1].time,before.song.notes[1].time,'an unselected note stays in place');
  console.log(`OK ${dir}: multi-note shifts preserve rhythm, unrelated notes, chord timing, bounds and one-step undo/redo`);
}
