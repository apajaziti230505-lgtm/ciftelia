import { newSong } from './songs.js';
import { parseSongJSON } from './song-editing.js';
/** An updated export keeps its song identity and this device's linked recording. */
export function importSongJSON(text, knownSongs) {
    if (text.length > 2_000_000)
        throw Error('Skedari është tepër i madh.');
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        throw Error('JSON-i nuk është i saktë.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('JSON i pavlefshëm.');
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 200))
        throw Error('Id-ja e këngës nuk është e vlefshme.');
    if (raw.originalAudioId !== undefined && (typeof raw.originalAudioId !== 'string' || !raw.originalAudioId.trim() || raw.originalAudioId.length > 250))
        throw Error('Lidhja e audios nuk është e vlefshme.');
    const known = knownSongs.find(song => song.id === raw.id);
    const base = known ?? newSong(typeof raw.name === 'string' ? raw.name : 'Këngë e importuar', []);
    const id = raw.id ?? base.id;
    const originalAudioId = known?.originalAudioId ?? (raw.originalAudioId === '__draft' ? undefined : raw.originalAudioId);
    const originalAudioName = known?.originalAudioName ?? (typeof raw.originalAudioName === 'string' ? raw.originalAudioName.slice(0, 200) : undefined);
    const normalized = { ...raw, id, name: raw.name ?? base.name, originalAudioId, originalAudioName };
    const song = parseSongJSON(JSON.stringify(normalized), { ...base, id, originalAudioId, originalAudioName });
    return { song, existing: !!known };
}
export function validateAudioFile(file) {
    if (!file.size)
        throw Error('Skedari audio është bosh.');
    if (file.size > 25_000_000)
        throw Error('Audioja është mbi 25 MB. Përdor regjistrim më të shkurtër.');
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg|aac|flac|webm)$/i.test(file.name))
        throw Error('Zgjidh skedar audio MP3, M4A, WAV ose OGG.');
}
