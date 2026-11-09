const KEY = 'ciftelia-studio-ts-songs-v1';
const REMOVED_EXERCISES = new Set(['demo-fast', 'demo-scale']);
const validNote = (n) => n && (n.string === 1 || n.string === 2) && Number.isInteger(n.noteNumber) && n.noteNumber >= 1 && n.noteNumber <= 15 && Number.isFinite(n.time) && n.time >= 0 && n.time < 3600000;
export function loadSongs() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || '[]');
        if (!Array.isArray(v))
            return [];
        const songs = v.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.notes))
            .map((s) => ({ ...s, notes: s.notes.filter(validNote).slice(0, 10000) }));
        const retained = songs.filter(song => !REMOVED_EXERCISES.has(song.id));
        if (retained.length !== songs.length)
            saveSongs(retained);
        return retained;
    }
    catch {
        return [];
    }
}
export function saveSongs(songs) {
    try {
        localStorage.setItem(KEY, JSON.stringify(songs));
        return true;
    }
    catch {
        return false;
    }
}
export function allSongs(userSongs, catalog = []) {
    const defaults = catalog.filter(s => !REMOVED_EXERCISES.has(s.id)), ids = new Set(defaults.map(s => s.id));
    const retained = userSongs.filter(s => !REMOVED_EXERCISES.has(s.id));
    const overrides = new Map(retained.map(s => [s.id, s]));
    return [...defaults.map(s => overrides.get(s.id) ?? s), ...retained.filter(s => !ids.has(s.id))];
}
export function upsertSong(songs, song) {
    return songs.some(s => s.id === song.id) ? songs.map(s => s.id === song.id ? song : s) : [...songs, song];
}
export function newSong(name, events) {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `song-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return { id, name: name.trim().slice(0, 80) || 'Melodi e re', createdAt: new Date().toISOString(), notes: events.map(e => ({ ...e, time: Math.max(0, Math.round(e.time)) })).sort((a, b) => a.time - b.time) };
}
export function exportSong(song) {
    const blob = new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${song.name.replace(/[^a-zA-Z0-9_\- ]/g, '_').replace(/ /g, '_')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
