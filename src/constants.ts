export const KEYS = 'qwertyuiopasdf'.split('') as string[];
export const HZ = [329, 358, 389, 440, 477, 521, 587, 660, 719, 784, 880, 960, 1050, 292] as const;
export const TOLERANCE = 15;
export const FRETS = 13;
export type NoteNumber = number;
export interface NoteEvent { string: 1 | 2; noteNumber: number; time: number; measuredHz?: number; confidence?: number; }
export interface Song { id: string; name: string; notes: NoteEvent[]; createdAt: string; }
export const DEMO: Song[] = [
  { id: 'demo-fast', name: 'Ushtrim i shpejtë · R–Y', createdAt: '', notes:
    [4,5,6,7,7,7,6,5,4,14,4,5,6,7].flatMap((noteNumber,i) => [
      {string:1 as const, noteNumber, time:i*165},
      ...((i%2===0) ? [{string:2 as const, noteNumber:14, time:i*165}]:[])
    ])
  },
  { id:'demo-scale', name:'13 perdet · ushtrim', createdAt:'', notes:
    [...Array(13)].map((_,i)=>({string:1 as const,noteNumber:i+1,time:i*240}))
      .concat([{string:1 as const,noteNumber:14,time:3120}])
  }
];
export function hzToNote(hz: number): {noteNumber: number; target: number; error: number} | null {
  if (!Number.isFinite(hz) || hz<=0) return null;
  let best = -1, diff = Infinity;
  HZ.forEach((v,i)=>{const d = Math.abs(hz-v); if(d<diff){best=i;diff=d;}});
  return diff <= TOLERANCE ? {noteNumber:best+1,target:HZ[best],error:diff} : null;
}
export function labelFor(note: number): string { return KEYS[note - 1]?.toUpperCase() ?? '?'; }
export function fmt(ms: number): string {
  const m = Math.floor(Math.max(0,ms)/60000);
  const s = Math.floor((Math.max(0,ms)%60000)/1000);
  const h = Math.floor(Math.max(0,ms)%1000/10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(h).padStart(2,'0')}`;
}
