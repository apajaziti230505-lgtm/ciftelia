export const KEYS = 'qwertyuiopasdfg'.split('');
// Matje orientuese nga regjistrimi i ri: nuk aplikohet transpozim ose konvertim 220↔440.
// F = teli shoqërues i hapur 220 Hz; G = teli melodik i hapur 293 Hz.
export const HZ = [330, 359, 392, 440, 482, 523, 586, 660, 721, 788, 883, 970, 1053, 220, 293];
export const TOLERANCE = 15;
// Pragu për F = 220 Hz me tolerancë ±15 Hz. Nuk ka transpozim audio.
export const MIN_MIC_HZ = 205;
export const FRETS = 13;
export const DEMO = [
    { id: 'demo-fast', name: 'Ushtrim i shpejtë · R–Y', createdAt: '', notes: [4, 5, 6, 7, 7, 7, 6, 5, 4, 14, 4, 5, 6, 7].flatMap((noteNumber, i) => [
            { string: 1, noteNumber, time: i * 165 },
            ...((i % 2 === 0) ? [{ string: 2, noteNumber: 14, time: i * 165 }] : [])
        ])
    },
    { id: 'demo-scale', name: '13 perdet · ushtrim', createdAt: '', notes: [...Array(13)].map((_, i) => ({ string: 1, noteNumber: i + 1, time: i * 240 }))
            .concat([{ string: 1, noteNumber: 15, time: 3120 }])
    }
];
export function hzToNote(hz) {
    if (!Number.isFinite(hz) || hz < MIN_MIC_HZ)
        return null;
    let best = -1, diff = Infinity;
    HZ.forEach((v, i) => { const d = Math.abs(hz - v); if (d < diff) {
        best = i;
        diff = d;
    } });
    return diff <= TOLERANCE ? { noteNumber: best + 1, target: HZ[best], error: diff } : null;
}
// 220 Hz luhet si shoqërim me perdet 1-13 dhe telin poshtë të hapur 293 Hz.
// Kënga origjinale mbetet e paprekur; nuk dyfishojmë F nëse ekziston në të njëjtën kohë.
export function withOpenF(events) {
    const accompanimentTimes = new Set(events.filter(e => e.noteNumber === 14).map(e => e.time));
    const combined = events.map(e => e.noteNumber === 14 ? { ...e, string: 2 } : e);
    for (const ev of events) {
        if ((ev.noteNumber >= 1 && ev.noteNumber <= 13 || ev.noteNumber === 15) && !accompanimentTimes.has(ev.time)) {
            combined.push({ string: 2, noteNumber: 14, time: ev.time });
            accompanimentTimes.add(ev.time);
        }
    }
    return combined.sort((a, b) => a.time - b.time || Number(a.noteNumber === 14) - Number(b.noteNumber === 14));
}
export function labelFor(note) { return KEYS[note - 1]?.toUpperCase() ?? '?'; }
export function fmt(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    const s = Math.floor((Math.max(0, ms) % 60000) / 1000);
    const h = Math.floor(Math.max(0, ms) % 1000 / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
}
