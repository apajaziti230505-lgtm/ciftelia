import assert from 'node:assert/strict';

for(const directory of ['../js/','../js/v25/']){
  const {EditHistory}=await import(`${directory}edit-history.js`);
  const {copySongGroup,pasteSongGroup,replaceSongGroup,deleteSongGroup}=await import(`${directory}song-editing.js`);
  const song={id:'saved-song',name:'Provë',createdAt:'',originalAudioId:'catalog:recording',
    notes:[{string:1,noteNumber:4,time:100,upperNoteNumber:5,withF:true},
      {string:1,noteNumber:7,time:450,withF:false,groupStart:400},
      {string:1,noteNumber:8,time:850,withF:true,groupStart:800}],
    stanzas:[{start:0,label:'Grupi 1',color:'#e8b45a'},{start:400,label:'Grupi 2',color:'#42bdae'},{start:800,label:'Grupi 3',color:'#b894f6'}]};
  const state=(song,selectedGroupStart=0,time=0)=>({song:structuredClone(song),selectedGroupStart,time});
  const history=new EditHistory();
  assert.equal(history.undo(state(song)),null);assert.equal(history.redo(state(song)),null);
  const clip=copySongGroup(song,0,1200);
  const original=state(song);
  const duplicated=state(pasteSongGroup(song,clip,400).song,400,400);
  assert.ok(history.record(original,duplicated,'Dyfishimi i grupit'));
  const removed=state(deleteSongGroup(duplicated.song,400).song,800,800);
  assert.ok(history.record(duplicated,removed,'Fshirja e grupit'));
  const replacement=state(replaceSongGroup(removed.song,clip,800,1600).song,800,800);
  assert.ok(history.record(removed,replacement,'Zëvendësimi i grupit'));
  assert.equal(history.undoCount,3);assert.equal(history.undoLabel,'Zëvendësimi i grupit');
  let present=replacement;
  for(const expected of [removed,duplicated,original]){
    const result=history.undo(present);assert.ok(result);assert.deepEqual(result.snapshot,expected);
    present=result.snapshot;
  }
  assert.equal(history.undoCount,0);assert.equal(history.redoCount,3);assert.equal(history.redoLabel,'Dyfishimi i grupit');
  for(const expected of [duplicated,removed,replacement]){
    const result=history.redo(present);assert.ok(result);assert.deepEqual(result.snapshot,expected);present=result.snapshot;
  }
  assert.equal(history.redoCount,0);assert.equal(history.undoCount,3);
  const undo=history.undo(present);present=undo.snapshot;
  assert.equal(history.redoCount,1);
  assert.equal(history.record(present,{...present,time:999},'Vetëm lëvizja e pamjes'),false,'view changes do not clear redo');
  assert.equal(history.redoCount,1);
  const renamed=structuredClone(present);renamed.song.stanzas[0].label='Emër i ri';
  assert.ok(history.record(present,renamed,'Emërtimi i grupit'));assert.equal(history.redoCount,0,'a new edit replaces the redo branch');
  assert.deepEqual(history.undo(renamed).snapshot,present);

  const independent=new EditHistory();
  const before=state(song),after=state(song);after.song.notes[0].time=200;
  independent.record(before,after,'Zhvendosja');
  before.song.notes[0].upperNoteNumber=13;before.song.stanzas[0].color='#ffffff';
  const restored=independent.undo(after).snapshot;
  assert.equal(restored.song.notes[0].upperNoteNumber,5);assert.equal(restored.song.stanzas[0].color,'#e8b45a','stored snapshots do not share group objects');
  restored.song.notes[0].noteNumber=12;
  const redone=independent.redo(state(song)).snapshot;
  assert.equal(redone.song.notes[0].time,200);assert.equal(redone.song.notes[0].noteNumber,4);
  assert.equal(redone.song.originalAudioId,'catalog:recording');assert.equal(redone.song.notes[1].withF,false);
  assert.throws(()=>independent.record(state(song),state({...song,id:'another-song'}),'Gabim'),/këngë/);

  const many=new EditHistory();let current=state(song);
  for(let i=1;i<=55;i++){const next=structuredClone(current);next.song.notes[0].time=i*10;many.record(current,next,`Hapi ${i}`);current=next;}
  assert.equal(many.undoCount,50);
  for(let i=0;i<50;i++)current=many.undo(current).snapshot;
  assert.equal(current.song.notes[0].time,50,'oldest states are bounded while the newest 50 remain');
  assert.equal(many.undo(current),null);assert.equal(many.redoCount,50);
  for(let i=0;i<50;i++)current=many.redo(current).snapshot;
  assert.equal(current.song.notes[0].time,550);
  const bounded=new EditHistory(50,100);
  bounded.record(original,duplicated,'Shto');bounded.record(duplicated,removed,'Fshi');
  assert.equal(bounded.undoCount,1,'byte budget still keeps the most recent recovery point');
  assert.deepEqual(bounded.undo(removed).snapshot,duplicated);
  assert.throws(()=>new EditHistory(0));
  console.log(`OK ${directory}: multiple undo/redo, group recovery, immutable snapshots, branching and bounded memory`);
}
