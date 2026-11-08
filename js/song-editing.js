import { GROUP_COLORS, groupForNote } from './grouping.js';
import { groupEnd } from './group-length.js';
const MAX_TIME = 3_600_000;
const MAX_NOTES = 10_000;
const MAX_GROUPS = 90;
function groupsOf(song) {
    const groups = (song.stanzas ?? []).map(g => ({ ...g })).sort((a, b) => a.start - b.start);
    if (!groups.some(g => g.start === 0))
        groups.unshift({ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] });
    return groups;
}
export function copySongGroup(song, start, endMs) {
    const groups = groupsOf(song), index = groups.findIndex(g => g.start === start);
    if (index < 0)
        throw Error('Zgjidh një grup për ta kopjuar.');
    const notes = song.notes.filter(n => groupForNote(groups, n) === index);
    if (!notes.length)
        throw Error('Grupi i zgjedhur nuk ka nota.');
    const origin = Math.min(start, ...notes.map(n => n.time));
    const last = Math.max(...notes.map(n => n.time));
    const end = Math.max(groupEnd({ ...song, stanzas: groups }, index), last + 1, origin + 100);
    return { label: groups[index].label, color: groups[index].color || GROUP_COLORS[index % GROUP_COLORS.length],
        duration: Math.ceil(end - origin), notes: notes.map(n => ({ ...n, time: n.time - origin, groupStart: 0 })) };
}
/** Insert at a group boundary; preserve intervals, accompaniment and group assignments. */
export function pasteSongGroup(song, copied, insertAt) {
    if (!Number.isFinite(insertAt) || insertAt < 0 || !Number.isInteger(insertAt))
        throw Error('Koha e ngjitjes nuk është e vlefshme.');
    if (!copied.notes.length || !Number.isInteger(copied.duration) || copied.duration < 1)
        throw Error('Kopjo së pari një grup.');
    const groups = groupsOf(song), duration = copied.duration;
    if (groups.length >= MAX_GROUPS)
        throw Error('Maksimumi është 90 grupe.');
    if (song.notes.length + copied.notes.length > MAX_NOTES)
        throw Error('Maksimumi është 10 000 nota.');
    const shift = (time) => time >= insertAt ? time + duration : time;
    const notes = song.notes.map(n => ({ ...n, time: shift(n.time),
        ...(n.groupStart !== undefined ? { groupStart: shift(n.groupStart) } : {}) }));
    notes.push(...copied.notes.map(n => ({ ...n, time: insertAt + n.time, groupStart: insertAt })));
    const stanzas = groups.map(g => ({ ...g, start: shift(g.start), ...(g.end !== undefined ? { end: g.end + (g.start >= insertAt || g.end > insertAt ? duration : 0) } : {}) }));
    stanzas.push({ start: insertAt, end: insertAt + duration, label: `${copied.label.slice(0, 55)} · Kopje`, color: copied.color });
    if (insertAt + duration >= MAX_TIME || notes.some(n => n.time >= MAX_TIME) || stanzas.some(g => g.start >= MAX_TIME || (g.end !== undefined && g.end >= MAX_TIME)))
        throw Error('Kënga nuk mund të kalojë një orë.');
    return { song: { ...song, notes: notes.sort((a, b) => a.time - b.time || a.string - b.string), stanzas: stanzas.sort((a, b) => a.start - b.start) }, groupStart: insertAt };
}
/** Replace the selected group, keeping its identity and the copied attack intervals. */
export function replaceSongGroup(song, copied, targetStart, endMs) {
    const groups = groupsOf(song), index = groups.findIndex(g => g.start === targetStart);
    if (index < 0)
        throw Error('Zgjidh grupin ku dëshiron ta ngjitësh.');
    if (!copied.notes.length || !Number.isInteger(copied.duration) || copied.duration < 1)
        throw Error('Kopjo së pari një grup.');
    const oldEnd = groupEnd({ ...song, stanzas: groups }, index);
    const delta = copied.duration - (oldEnd - targetStart);
    const notes = song.notes.filter(n => groupForNote(groups, n) !== index).map(n => {
        const later = groupForNote(groups, n) > index;
        return { ...n, time: n.time + (later ? delta : 0), ...(n.groupStart !== undefined ? { groupStart: n.groupStart + (n.groupStart > targetStart ? delta : 0) } : {}) };
    });
    notes.push(...copied.notes.map(n => ({ ...n, time: targetStart + n.time, groupStart: targetStart })));
    const stanzas = groups.map((g, i) => ({ ...g, start: g.start + (i > index ? delta : 0),
        ...(i === index ? { end: targetStart + copied.duration } : g.end !== undefined ? { end: g.end + (i > index ? delta : 0) } : {}) }));
    if (notes.length > MAX_NOTES)
        throw Error('Maksimumi është 10 000 nota.');
    if (targetStart + copied.duration >= MAX_TIME || notes.some(n => n.time < 0 || n.time >= MAX_TIME) || stanzas.some(g => g.start < 0 || g.start >= MAX_TIME || (g.end !== undefined && g.end >= MAX_TIME)))
        throw Error('Koha pas ngjitjes del jashtë kufijve të këngës.');
    return { song: { ...song, notes: notes.sort((a, b) => a.time - b.time || a.string - b.string), stanzas }, groupStart: targetStart };
}
/** Delete the group and its members without moving the other notes in time. */
export function deleteSongGroup(song, targetStart) {
    const groups = groupsOf(song), index = groups.findIndex(g => g.start === targetStart);
    if (index < 0)
        throw Error('Zgjidh grupin që dëshiron ta fshish.');
    let notes = song.notes.filter(n => groupForNote(groups, n) !== index).map(n => ({ ...n }));
    const stanzas = groups.filter((_, i) => i !== index).map(g => ({ ...g }));
    if (!stanzas.length)
        stanzas.push({ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] });
    else if (index === 0) {
        const oldStart = stanzas[0].start;
        stanzas[0].start = 0;
        notes = notes.map(n => n.groupStart === oldStart ? { ...n, groupStart: 0 } : n);
    }
    return { song: { ...song, notes, stanzas }, groupStart: stanzas[Math.min(index, stanzas.length - 1)].start };
}
/** Validate completely before replacing any editable state. */
export function parseSongJSON(text, base) {
    if (text.length > 2_000_000)
        throw Error('JSON-i është tepër i madh.');
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        throw Error('JSON-i nuk është i saktë. Kontrollo presjet, kllapat dhe thonjëzat.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('JSON-i duhet të përmbajë një këngë.');
    if (raw.id !== undefined && raw.id !== base.id)
        throw Error('Mbaje id-në e kësaj kënge; ndrysho emrin, notat dhe grupet.');
    if (raw.originalAudioId !== undefined && raw.originalAudioId !== base.originalAudioId)
        throw Error('Mbaje originalAudioId që kënga të ruajë lidhjen me audion.');
    if (raw.preferNotes !== undefined && typeof raw.preferNotes !== 'boolean')
        throw Error('preferNotes duhet të jetë true ose false.');
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200)
        throw Error('Vendos një emër kënge me 1–200 shkronja.');
    if (!Array.isArray(raw.notes) || raw.notes.length > MAX_NOTES)
        throw Error('notes duhet të jetë listë me deri në 10 000 nota.');
    const notes = raw.notes.map((n, i) => {
        const fail = (reason) => { throw Error(`Nota ${i + 1}: ${reason}`); };
        if (!n || typeof n !== 'object' || Array.isArray(n))
            return fail('duhet të jetë objekt.');
        if (n.string !== 1 && n.string !== 2)
            return fail('string duhet të jetë 1 (poshtë) ose 2 (lart).');
        if (!Number.isInteger(n.noteNumber) || n.noteNumber < 1 || n.noteNumber > 15)
            return fail('noteNumber duhet të jetë 1–15.');
        if (n.string === 2 && n.noteNumber === 15)
            return fail('15 është teli poshtë i hapur; përdor string: 1.');
        if (!Number.isFinite(n.time) || n.time < 0 || n.time >= MAX_TIME)
            return fail('time duhet të jetë 0–3 599 999 ms.');
        if (n.withF !== undefined && typeof n.withF !== 'boolean')
            return fail('withF duhet të jetë true ose false.');
        if (n.upperNoteNumber !== undefined && (!Number.isInteger(n.upperNoteNumber) || n.upperNoteNumber < 1 || n.upperNoteNumber > 14))
            return fail('upperNoteNumber duhet të jetë 1–13, ose 14 për F.');
        if (n.groupStart !== undefined && (!Number.isInteger(n.groupStart) || n.groupStart < 0 || n.groupStart >= MAX_TIME))
            return fail('groupStart nuk është i vlefshëm.');
        for (const field of ['confidence', 'velocity'])
            if (n[field] !== undefined && (!Number.isFinite(n[field]) || n[field] < 0 || n[field] > 1))
                return fail(`${field} duhet të jetë 0–1.`);
        if (n.measuredHz !== undefined && (!Number.isFinite(n.measuredHz) || n.measuredHz <= 0))
            return fail('measuredHz duhet të jetë numër pozitiv.');
        return { ...n, string: n.noteNumber === 14 ? 2 : n.string };
    }).sort((a, b) => a.time - b.time || a.string - b.string);
    const rawGroups = raw.stanzas === undefined ? base.stanzas ?? [] : raw.stanzas;
    if (!Array.isArray(rawGroups) || rawGroups.length > MAX_GROUPS)
        throw Error('stanzas duhet të jetë listë me deri në 90 grupe.');
    const stanzas = rawGroups.map((g, i) => {
        if (!g || !Number.isInteger(g.start) || g.start < 0 || g.start >= MAX_TIME || typeof g.label !== 'string' || !g.label.trim() || g.label.length > 65)
            throw Error(`Grupi ${i + 1}: kontrollo start (ms) dhe label (emri).`);
        if (g.color !== undefined && !/^#[0-9a-f]{6}$/i.test(g.color))
            throw Error(`Grupi ${i + 1}: color duhet të ketë formatin #e8b45a.`);
        if (g.end !== undefined && (!Number.isInteger(g.end) || g.end <= g.start || g.end >= MAX_TIME))
            throw Error(`Grupi ${i + 1}: end duhet të jetë pas fillimit, në milisekonda.`);
        return { ...g };
    }).sort((a, b) => a.start - b.start);
    if (new Set(stanzas.map(g => g.start)).size !== stanzas.length)
        throw Error('Dy grupe nuk mund të fillojnë në të njëjtën kohë.');
    for (let i = 0; i < stanzas.length - 1; i++)
        if (stanzas[i].end !== undefined && stanzas[i].end > stanzas[i + 1].start)
            throw Error('Fundi i grupit nuk mund të kalojë grupin pasues.');
    if (!stanzas.some(g => g.start === 0))
        stanzas.unshift({ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] });
    if (stanzas.length > MAX_GROUPS)
        throw Error('Maksimumi është 90 grupe, përfshirë grupin që fillon në zero.');
    for (const [i, n] of notes.entries())
        if (n.groupStart !== undefined && !stanzas.some(g => g.start === n.groupStart))
            throw Error(`Nota ${i + 1}: groupStart nuk përputhet me asnjë grup.`);
    return { ...base, ...raw, id: base.id, originalAudioId: base.originalAudioId, name: raw.name.trim(), notes, stanzas };
}
