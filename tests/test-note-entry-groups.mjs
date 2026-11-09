import assert from 'node:assert/strict';

for(const directory of ['../js/']){
  const {manualEntryNote}=await import(`${directory}manual.js`);
  const {withOpenF}=await import(`${directory}constants.js`);
  const {copySongGroup,replaceSongGroup,deleteSongGroup,parseSongJSON}=await import(`${directory}song-editing.js`);
  const first=manualEntryNote(8,3516);
  assert.equal(first.string,1);assert.equal(first.withF,true);assert.equal(first.time,3516);
  assert.deepEqual(withOpenF([first]).map(n=>[n.string,n.noteNumber]),[[1,8],[2,14]],'new entries automatically accompany the lower note with F');
  const custom=manualEntryNote(8,3516,'5');
  assert.deepEqual(withOpenF([custom]).map(n=>[n.string,n.noteNumber]),[[1,8],[2,5]],'upper fret is local to this note');
  const alone=manualEntryNote(8,3516,'off');
  assert.equal(alone.withF,false);assert.equal(withOpenF([alone]).length,1);
  assert.equal(withOpenF([manualEntryNote(9,4000)])[1].noteNumber,14,'next entry returns to automatic F');
  assert.equal(manualEntryNote(15,4000).string,1);
  assert.throws(()=>manualEntryNote(14,4000),/poshtë/);
  assert.throws(()=>manualEntryNote(8,4000,'99'),/Zgjidh/);

  const source={id:'catalog-test',name:'DB',createdAt:'',originalAudioId:'catalog:test',
    notes:[{string:1,noteNumber:4,time:100,withF:true,upperNoteNumber:5},{string:2,noteNumber:14,time:100},
      {string:1,noteNumber:5,time:240,withF:false},{string:1,noteNumber:6,time:340,groupStart:300},
      {string:1,noteNumber:7,time:660,groupStart:600}],
    stanzas:[{start:0,label:'Grupi 1',color:'#e8b45a'},{start:300,label:'Grupi 2',color:'#42bdae'},{start:600,label:'Grupi 3',color:'#b894f6'}]};
  const original=structuredClone(source),clip=copySongGroup(source,0,1000);
  const replaced=replaceSongGroup(source,clip,300,1000).song;
  assert.equal(replaced.stanzas.length,3,'paste replaces the chosen group instead of adding a group after it');
  assert.equal(replaced.stanzas[1].label,'Grupi 2');assert.equal(replaced.stanzas[1].color,'#42bdae');
  assert.deepEqual(replaced.notes.filter(n=>n.groupStart===300).map(n=>[n.time,n.noteNumber]),[[400,4],[400,14],[540,5]]);
  assert.ok(!replaced.notes.some(n=>n.noteNumber===6),'old target contents are replaced');
  assert.equal(replaced.notes.find(n=>n.noteNumber===7).time,660,'equal-duration paste leaves later groups in place');
  assert.equal(replaced.notes.find(n=>n.time===540).withF,false);
  assert.equal(replaced.notes.find(n=>n.time===400&&n.string===1).upperNoteNumber,5);
  const longer=replaceSongGroup(source,{...clip,duration:500},300,1000).song;
  assert.deepEqual(longer.stanzas.map(g=>g.start),[0,300,800]);
  assert.equal(longer.notes.find(n=>n.noteNumber===7).time,860);
  assert.equal(longer.notes.find(n=>n.noteNumber===7).groupStart,800);
  assert.equal(longer.notes[0].time,100,'groups before the target are preserved');
  assert.throws(()=>replaceSongGroup(source,clip,99,1000),/Zgjidh grupin/,'invalid targets never default to group 1');
  assert.deepEqual(parseSongJSON(JSON.stringify(longer),source),longer);

  const removed=deleteSongGroup(source,300).song;
  assert.deepEqual(removed.stanzas.map(g=>g.start),[0,600]);
  assert.deepEqual(removed.notes.map(n=>n.time),[100,100,240,660],'deletion keeps all other note times');
  assert.ok(!removed.notes.some(n=>n.noteNumber===6));
  const removedFirst=deleteSongGroup(source,0).song;
  assert.equal(removedFirst.stanzas[0].start,0);assert.equal(removedFirst.stanzas[0].label,'Grupi 2');
  assert.deepEqual(removedFirst.notes.map(n=>n.time),[340,660]);assert.equal(removedFirst.notes[0].groupStart,0);
  assert.deepEqual(parseSongJSON(JSON.stringify(removedFirst),source),removedFirst,'first-group promotion preserves valid assignments');
  const removedLast=deleteSongGroup(source,600).song;
  assert.deepEqual(removedLast.stanzas.map(g=>g.start),[0,300]);assert.equal(removedLast.notes.at(-1).time,340);
  const removedOnly=deleteSongGroup({...source,stanzas:[source.stanzas[0]]},0).song;
  assert.equal(removedOnly.notes.length,0);assert.equal(removedOnly.stanzas[0].start,0);
  assert.throws(()=>deleteSongGroup(source,99),/Zgjidh/);
  assert.deepEqual(source,original,'paste and deletion keep the original available for undo');

  assert.throws(()=>parseSongJSON(JSON.stringify({...source,preferNotes:'false'}),source),/preferNotes/);
  console.log(`OK ${directory}: automatic local F, target-group paste and reversible group deletion`);
}
