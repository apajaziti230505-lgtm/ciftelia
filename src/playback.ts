export type PlaybackSource='original'|'notes';

/** MP3 is the default. Only an explicit user choice enables synthesized playback. */
export class SongPlayback {
  private songId:string|null=null;
  private current:PlaybackSource='original';
  get source():PlaybackSource{return this.current;}
  selectSong(song:{id:string}|null):PlaybackSource {
    const id=song?.id??null;
    if(id!==this.songId){this.songId=id;this.current='original';}
    return this.current;
  }
  choose(source:PlaybackSource):void {
    if(source!=='original'&&source!=='notes')throw Error('Zgjidh MP3 ose çifteli.');
    this.current=source;
  }
}
