import assert from 'node:assert/strict';

for(const directory of ['../js/']){
  const {copySongGroup,pasteSongGroup,parseSongJSON}=await import(`${directory}song-editing.js`);
  const {allSongs,upsertSong,saveSongs,loadSongs}=await import(`${directory}songs.js`);
  const {groupForNote}=await import(`${directory}grouping.js`);
  const source={id:'catalog-test',name:'Nga DB',createdAt:'2026-11-08T11:00:00Z',originalAudioId:'catalog:test',
    notes:[{string:1,noteNumber:4,time:100,withF:true,upperNoteNumber:5,velocity:.8},
      {string:2,noteNumber:14,time:100},{string:1,noteNumber:5,time:240,withF:false},
      {string:1,noteNumber:6,time:340,groupStart:300,upperNoteNumber:3,confidence:.9},
      {string:1,noteNumber:7,time:660,groupStart:600}],
    stanzas:[{start:0,label:'Grupi 1',color:'#e8b45a'},{start:300,label:'Grupi 2',color:'#42bdae'},{start:600,label:'Grupi 3',color:'#b894f6'}]};
  const untouched=structuredClone(source);
  const clip=copySongGroup(source,0,1000);
  assert.equal(clip.duration,300,'copy preserves the entire group interval, without adding a tail before the next group');
  assert.deepEqual(clip.notes.map(n=>n.time),[100,100,240]);
  assert.equal(clip.notes[0].upperNoteNumber,5);assert.equal(clip.notes[2].withF,false);
  const inserted=pasteSongGroup(source,clip,300);
  assert.equal(inserted.groupStart,300);
  assert.equal(inserted.song.notes.length,8);
  assert.deepEqual(inserted.song.stanzas.map(g=>g.start),[0,300,600,900]);
  assert.deepEqual(inserted.song.notes.filter(n=>n.groupStart===300).map(n=>n.time),[400,400,540]);
  const shifted=inserted.song.notes.find(n=>n.noteNumber===6);
  assert.equal(shifted.time,640);assert.equal(shifted.groupStart,600);assert.equal(shifted.upperNoteNumber,3);
  assert.equal(groupForNote(inserted.song.stanzas,shifted),2);
  assert.equal(inserted.song.originalAudioId,source.originalAudioId);
  assert.deepEqual(source,untouched,'copy/paste never mutates the source');
  inserted.song.notes[0].noteNumber=12;
  assert.equal(source.notes[0].noteNumber,4);assert.equal(clip.notes[0].noteNumber,4,'clipboard is an independent snapshot');
  const end=pasteSongGroup(source,clip,1000).song;
  assert.deepEqual(end.notes.slice(0,5),source.notes,'appending keeps every old event unchanged');
  assert.equal(end.stanzas.at(-1).start,1000);
  assert.equal(end.notes.at(-1).time,1240,'pasted notes can extend beyond the original MP3 duration');
  const reassigned={...source,notes:[...source.notes,{string:1,noteNumber:8,time:450,groupStart:0}]};
  const reassignedClip=copySongGroup(reassigned,0,1000);
  assert.equal(reassignedClip.notes.at(-1).noteNumber,8,'copy includes manually assigned members');
  assert.ok(reassignedClip.duration>450);
  assert.throws(()=>copySongGroup(source,999,1000),/grup/);
  assert.throws(()=>copySongGroup({...source,notes:[]},0,1000),/nuk ka nota/);
  assert.throws(()=>pasteSongGroup(source,clip,3_599_999),/orë/);
  assert.throws(()=>pasteSongGroup({...source,stanzas:Array.from({length:90},(_,i)=>({start:i*10,label:'Grupi'}))},clip,1000),/90/);
  assert.throws(()=>pasteSongGroup({...source,notes:Array.from({length:10000},()=>source.notes[0])},clip,1000),/10 000/);

  const data=structuredClone(source);data.notes[0].noteNumber=8;data.notes[0].withF=false;data.notes[3].upperNoteNumber=12;
  data.stanzas[1].label='Ndryshuar';data.name='JSON i ndryshuar';
  const changed=parseSongJSON(JSON.stringify(data),source);
  assert.equal(changed.notes[0].noteNumber,8);assert.equal(changed.notes[0].withF,false);
  assert.equal(changed.notes[3].upperNoteNumber,12);assert.equal(changed.stanzas[1].label,'Ndryshuar');
  assert.equal(changed.id,source.id);assert.equal(changed.originalAudioId,source.originalAudioId);
  assert.deepEqual(parseSongJSON(JSON.stringify(end),source),end,'copied groups round-trip through the JSON editor');
  assert.throws(()=>parseSongJSON('{',source),/JSON/);
  for(const mutation of [
    o=>o.notes[0].time=-1,o=>o.notes[0].noteNumber=16,o=>o.notes[0].withF='false',
    o=>o.notes[0].upperNoteNumber=99,o=>o.notes[0].groupStart=123,
    o=>o.stanzas.push({...o.stanzas[0]}),o=>o.stanzas[0].color='blue',o=>o.id='another',o=>o.originalAudioId='missing'
  ]){const invalid=structuredClone(source);mutation(invalid);assert.throws(()=>parseSongJSON(JSON.stringify(invalid),source));}
  assert.deepEqual(source,untouched,'validation failures leave the existing song intact');
  const empty=parseSongJSON(JSON.stringify({...source,notes:[],stanzas:[]}),source);
  assert.equal(empty.notes.length,0);assert.equal(empty.stanzas[0].start,0);
  assert.equal(parseSongJSON(JSON.stringify({...source,notes:[{string:1,noteNumber:14,time:0}]}),source).notes[0].string,2);

  const users=upsertSong([],changed);
  const usersAgain=upsertSong(users,{...changed,name:'Ruajtur përsëri'});
  assert.equal(usersAgain.length,1,'editing a DB entry updates the same saved identity');
  const merged=allSongs(usersAgain,[source]);
  assert.equal(merged.filter(s=>s.id===source.id).length,1,'catalog does not duplicate a local override');
  assert.equal(merged.find(s=>s.id===source.id).name,'Ruajtur përsëri');
  assert.deepEqual(allSongs([]),[],'no bundled exercises are added to the catalog');
  const state=new Map();globalThis.localStorage={getItem:key=>state.get(key)??null,setItem:(key,value)=>state.set(key,value)};
  assert.ok(saveSongs(usersAgain));
  assert.equal(allSongs(loadSongs(),[source]).find(s=>s.id===source.id).notes[0].withF,false);
  assert.equal(allSongs([],[source]).find(s=>s.id===source.id).name,'Nga DB','removing an override restores the original');
  console.log(`OK ${directory}: group copy/paste, timing, JSON validation and saved catalog edits`);
}
