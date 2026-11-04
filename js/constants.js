export const KEYS = 'qwertyuiopasdf'.split('');
// Matje orientuese nga regjistrimi i ri: nuk aplikohet transpozim ose konvertim 220↔440.
// F = teli i hapur ~220 Hz (me harmonikë të fortë edhe rreth 440 Hz).
export const HZ = [330, 359, 392, 440, 482, 523, 586, 660, 721, 788, 883, 970, 1053, 220];
export const TOLERANCE = 15;
export const FRETS = 13;
export const DEMO = [
    { id: 'demo-fast', name: 'Ushtrim i shpejtë · R–Y', createdAt: '', notes: [4, 5, 6, 7, 7, 7, 6, 5, 4, 14, 4, 5, 6, 7].flatMap((noteNumber, i) => [
            { string: 1, noteNumber, time: i * 165 },
            ...((i % 2 === 0) ? [{ string: 2, noteNumber: 14, time: i * 165 }] : [])
        ])
    },
    { id: 'demo-scale', name: '13 perdet · ushtrim', createdAt: '', notes: [...Array(13)].map((_, i) => ({ string: 1, noteNumber: i + 1, time: i * 240 }))
            .concat([{ string: 1, noteNumber: 14, time: 3120 }])
    }
];
export function hzToNote(hz) {
    if (!Number.isFinite(hz) || hz <= 0)
        return null;
    let best = -1, diff = Infinity;
    HZ.forEach((v, i) => { const d = Math.abs(hz - v); if (d < diff) {
        best = i;
        diff = d;
    } });
    return diff <= TOLERANCE ? { noteNumber: best + 1, target: HZ[best], error: diff } : null;
}
export function labelFor(note) { return KEYS[note - 1]?.toUpperCase() ?? '?'; }
export function fmt(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    const s = Math.floor((Math.max(0, ms) % 60000) / 1000);
    const h = Math.floor(Math.max(0, ms) % 1000 / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
}
