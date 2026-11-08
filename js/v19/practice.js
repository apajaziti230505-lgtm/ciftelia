/** Momentary visual highlights. They never persist into a following pause/silence. */
export function notesAtMoment(notes, positionMs, holdMs = 190) {
    if (!Number.isFinite(positionMs))
        return [];
    return notes.filter(n => Number.isFinite(n.time) && positionMs >= n.time && positionMs - n.time < holdMs);
}
