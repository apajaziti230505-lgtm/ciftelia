import assert from 'node:assert/strict';
for(const dir of ['../js/','../js/v27/']){
  const {DEFAULT_GROUP_MS,groupEnd,withGroupEnd}=await import(`${dir}group-length.js`);
  const {copySongGroup,pasteSongGroup,replaceSongGroup,parseSongJSON}=await import(`${dir}song-editing.js`);
  const {EditHistory}=await import(`${dir}edit-history.js`);
  const empty={id:'short',name:'Grupi i vogël',createdAt:'',originalAudioId:'catalog:mp3',notes:[],stanzas:[{start:0,label:'Grupi 1'}]};
  assert.equal(DEFAULT_GROUP_MS,1000);assert.equal(groupEnd(empty,0),1000,'empty group starts at one second even with a full MP3');
  const song={...empty,notes:[{time:100,string:1,noteNumber:4,withF:false},{time:250,string:1,noteNumber:6,upperNoteNumber:8}]};
  const original=structuredClone(song);
  assert.equal(groupEnd(song,0),1000);
  const clip=copySongGroup(song,0,84_132);
  assert.equal(clip.duration,1000,'copy excludes the silent tail of the original MP3');
  const expanded=withGroupEnd(song,0,2500);
  assert.equal(groupEnd(expanded,0),2500);assert.equal(expanded.stanzas[0].end,2500);
  assert.deepEqual(expanded.notes,song.notes);assert.deepEqual(song,original,'resizing preserves note times, F choices and the original');
  assert.equal(copySongGroup(expanded,0,84_132).duration,2500,'a user-expanded length is preserved in the clipboard');
  const shorter=withGroupEnd(song,0,100);
  assert.equal(groupEnd(shorter,0),330,'shortening never cuts off the last note');
  const content={...song,notes:[...song.notes,{time:2400,string:1,noteNumber:8}]};
  assert.equal(groupEnd(content,0),2580,'longer actual phrases retain every note');
  const neighbors={...expanded,stanzas:[{...expanded.stanzas[0]},{start:3000,label:'Grupi 2'}]};
  assert.equal(groupEnd(withGroupEnd(neighbors,0,9000),0),3000,'growing cannot overlap the next group');
  assert.equal(groupEnd(withGroupEnd(empty,0,4_000_000),0),3_599_999);
  const inserted=pasteSongGroup(neighbors,clip,3000).song;
  assert.equal(inserted.stanzas[0].end,2500);assert.equal(inserted.stanzas[1].end,4000);
  assert.equal(inserted.stanzas[2].start,4000);
  assert.deepEqual(parseSongJSON(JSON.stringify(inserted),song),inserted,'group lengths survive JSON export and reimport');
  const boundary={...neighbors,stanzas:[{...neighbors.stanzas[0],end:3000},neighbors.stanzas[1]]};
  assert.equal(pasteSongGroup(boundary,clip,3000).song.stanzas[0].end,3000,'inserting at an end does not expand the preceding group');
  assert.throws(()=>pasteSongGroup({...song,stanzas:[{start:0,end:3_599_999,label:'Grupi'}]},clip,0),/orë/,'explicit ends also obey the one-hour limit');
  assert.throws(()=>replaceSongGroup({...song,stanzas:[{start:0,end:1000,label:'Grupi 1'},{start:2000,end:3_599_999,label:'Grupi 2'}]},{...clip,duration:2000},0,84_132),/kufij/);
  const replaced=replaceSongGroup(neighbors,clip,0,84_132).song;
  assert.equal(replaced.stanzas[0].end,1000);assert.equal(replaced.stanzas[1].start,1500);
  for(const end of [0,-1,3_600_000,NaN]){
    assert.throws(()=>parseSongJSON(JSON.stringify({...song,stanzas:[{start:0,end,label:'Grupi'}]}),song));
  }
  assert.throws(()=>parseSongJSON(JSON.stringify({...neighbors,stanzas:[{start:0,end:3100,label:'Grupi'},neighbors.stanzas[1]]}),song));
  const history=new EditHistory(),state=s=>({song:s,selectedGroupStart:0,time:0});
  history.record(state(song),state(expanded),'Gjatësia e grupit');
  assert.deepEqual(history.undo(state(expanded)).snapshot.song,song);
  assert.deepEqual(history.redo(state(song)).snapshot.song,expanded);
  console.log(`OK ${dir}: one-second defaults, compact copy, manual resize, note safety, neighbors, JSON and undo/redo`);
}
