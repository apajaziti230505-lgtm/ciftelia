export const KEYS = 'qwertyuiopasdfg'.split('') as string[];
// Matje orientuese nga regjistrimi i ri: nuk aplikohet transpozim ose konvertim 220↔440.
// F = teli shoqërues i hapur 220 Hz; G = teli melodik i hapur 293 Hz.
export const HZ = [326, 354, 387, 436, 473, 516, 579, 652, 710, 776, 870, 955, 1035, 220, 293] as const;
export const TOLERANCE = 15;
// Pragu për F = 220 Hz me tolerancë ±15 Hz. Nuk ka transpozim audio.
export const MIN_MIC_HZ = 205;
export const FRETS = 13;
export type NoteNumber = number;
export interface NoteEvent { string: 1 | 2; noteNumber: number; time: number; measuredHz?: number; confidence?: number; velocity?: number; withF?: boolean; upperNoteNumber?: number; groupStart?: number; }
export interface Stanza { start: number; label: string; color?: string; end?: number; }
export interface Song { id: string; name: string; notes: NoteEvent[]; createdAt: string; originalAudioId?: string; originalAudioName?: string; stanzas?: Stanza[]; preferNotes?: boolean; }
export const DEMO: Song[] = [
  { id: 'demo-fast', name: 'Ushtrim i shpejtë · R–Y', createdAt: '', notes:
    [4,5,6,7,7,7,6,5,4,14,4,5,6,7].flatMap((noteNumber,i) => [
      {string:1 as const, noteNumber, time:i*165},
      ...((i%2===0) ? [{string:2 as const, noteNumber:14, time:i*165}]:[])
    ])
  },
  { id:'demo-scale', name:'13 perdet · ushtrim', createdAt:'', notes:
    [...Array(13)].map((_,i)=>({string:1 as const,noteNumber:i+1,time:i*240}))
      .concat([{string:1 as const,noteNumber:15,time:3120}])
  }
];
export function hzToNote(hz: number): {noteNumber: number; target: number; error: number} | null {
  if (!Number.isFinite(hz) || hz < MIN_MIC_HZ) return null;
  let best = -1, diff = Infinity;
  HZ.forEach((v,i)=>{const d = Math.abs(hz-v); if(d<diff){best=i;diff=d;}});
  return diff <= TOLERANCE ? {noteNumber:best+1,target:HZ[best],error:diff} : null;
}
// 220 Hz luhet si shoqërim me perdet 1-13 dhe telin poshtë të hapur 293 Hz.
// Kënga origjinale mbetet e paprekur; nuk dyfishojmë F nëse ekziston në të njëjtën kohë.
export function upperFret(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 1 && value! <= 13 ? value! : 14;
}
/** Upper frets follow the measured fret ratios of the lower string. */
export function upperPlaybackRate(noteNumber: number): number {
  const fret=upperFret(noteNumber);
  return fret === 14 ? 1 : HZ[fret - 1] / HZ[14];
}
export function noteFrequency(noteNumber: number, string: 1 | 2): number {
  return string === 2 ? HZ[13] * upperPlaybackRate(noteNumber) : HZ[noteNumber - 1];
}
export function withOpenF(events: readonly NoteEvent[], upperEnabled = true): NoteEvent[] {
  const combined: NoteEvent[] = events.map(e => e.noteNumber === 14 ? {...e, string: 2} : e);
  if (!upperEnabled) return combined.filter(e => e.string === 1);
  const accompanimentTimes = new Set(combined.filter(e => e.string === 2).map(e => e.time));
  for (const ev of combined.slice()) {
    if (ev.string === 1 && (ev.noteNumber >= 1 && ev.noteNumber <= 13 || ev.noteNumber === 15) && ev.withF !== false && !accompanimentTimes.has(ev.time)) {
      combined.push({string:2, noteNumber:upperFret(ev.upperNoteNumber), time:ev.time, velocity:ev.velocity, groupStart:ev.groupStart});
      accompanimentTimes.add(ev.time);
    }
  }
  return combined.sort((a,b) => a.time-b.time || a.string-b.string);
}
export function labelFor(note: number): string { return KEYS[note - 1]?.toUpperCase() ?? '?'; }
export function fmt(ms: number): string {
  const m = Math.floor(Math.max(0,ms)/60000);
  const s = Math.floor((Math.max(0,ms)%60000)/1000);
  const h = Math.floor(Math.max(0,ms)%1000/10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(h).padStart(2,'0')}`;
}
