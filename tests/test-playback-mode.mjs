import assert from 'node:assert/strict';
for(const dir of ['../js/']){
  const {SongPlayback}=await import(`${dir}playback.js`);
  const playback=new SongPlayback();
  const song={id:'catalog-song',originalAudioId:'catalog:mp3',preferNotes:true,
    notes:[{time:100,string:1,noteNumber:7,withF:false},{time:300,string:1,noteNumber:8,upperNoteNumber:5}]};
  assert.equal(playback.source,'original');
  assert.equal(playback.selectSong(song),'original','legacy preferNotes, custom frets and lower-only notes never override MP3');
  for(const edit of [
    {...song,name:'Renamed'},
    {...song,notes:[...song.notes,{time:500,string:2,noteNumber:4}]},
    {...song,originalAudioId:'local:replacement'},
    {...song,preferNotes:false}
  ])assert.equal(playback.selectSong(edit),'original','edits and saved versions of the same song retain MP3');
  playback.choose('notes');
  assert.equal(playback.source,'notes','an explicit user choice enables synthesized playback');
  assert.equal(playback.selectSong({...song,preferNotes:true}),'notes','the current explicit choice survives an editor refresh/save');
  playback.choose('original');assert.equal(playback.selectSong(song),'original');
  playback.choose('notes');
  assert.equal(playback.selectSong({id:'another-song',preferNotes:true}),'original','choosing another song always resets to MP3');
  assert.equal(playback.selectSong({id:'no-file-linked'}),'original','a missing MP3 does not silently select the çifteli');
  playback.choose('notes');assert.equal(playback.selectSong({id:'no-file-linked'}),'notes','notes-only songs can still be played by explicit choice');
  assert.equal(playback.selectSong(song),'original');
  playback.choose('notes');assert.equal(playback.selectSong(null),'original');
  assert.equal(new SongPlayback().selectSong(song),'original','a fresh page starts with MP3 rather than a saved synthetic preference');
  assert.throws(()=>playback.choose('unknown'),/MP3/);
  console.log(`OK ${dir}: MP3 defaults, explicit çifteli choice, saved/edited/imported songs, missing audio and source resets`);
}
