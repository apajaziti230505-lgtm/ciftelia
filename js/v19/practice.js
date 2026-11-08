/** Momentary visual highlights. They never persist into a following pause/silence. */
export function notesAtMoment(notes, positionMs, holdMs = 190) {
    if (!Number.isFinite(positionMs))
        return [];
    const active = notes.filter(n => Number.isFinite(n.time) && positionMs >= n.time && positionMs - n.time < holdMs);
    const latest = new Map();
    for (const note of active)
        latest.set(note.string, Math.max(latest.get(note.string) ?? -Infinity, note.time));
    return active.filter(note => note.time === latest.get(note.string));
}
/** Alternate each repeated attack independently on each string. */
export function noteAttackColor(notes, note, base) {
    const preceding = notes.filter(n => n.string === note.string && n.time <= note.time).sort((a, b) => b.time - a.time);
    let repetitions = 0, previousTime = note.time;
    for (const previous of preceding) {
        if (previous.time === note.time)
            continue;
        if (previous.time === previousTime)
            continue;
        if (previous.noteNumber !== note.noteNumber)
            break;
        repetitions++;
        previousTime = previous.time;
    }
    return repetitions % 2 ? (note.string === 2 ? '#b5a3ff' : '#ff8e88') : base;
}
