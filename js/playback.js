/** MP3 is the default. Only an explicit user choice enables synthesized playback. */
export class SongPlayback {
    songId = null;
    current = 'original';
    get source() { return this.current; }
    selectSong(song) {
        const id = song?.id ?? null;
        if (id !== this.songId) {
            this.songId = id;
            this.current = 'original';
        }
        return this.current;
    }
    choose(source) {
        if (source !== 'original' && source !== 'notes')
            throw Error('Zgjidh MP3 ose çifteli.');
        this.current = source;
    }
}
