/** Highlights only the current pluck, including simultaneously played strings.
 * Returning [] outside a short onset window prevents a note from appearing
 * permanently pressed while the recording is silent or after a stop.
 */
export function currentPluck(notes, timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0)
        return [];
    let latest = -Infinity;
    for (const note of notes) {
        if (Number.isFinite(note.time) && note.time <= timeMs + 16 && note.time > latest)
            latest = note.time;
    }
    if (latest === -Infinity || timeMs - latest > 220 || timeMs - latest < -16)
        return [];
    return notes.filter(n => Math.abs(n.time - latest) <= 24);
}
export function nextMelodyNote(notes, timeMs) {
    let next;
    for (const note of notes) {
        if (note.noteNumber !== 14 && note.time > timeMs + 12 && (!next || note.time < next.time))
            next = note;
    }
    return next;
}
