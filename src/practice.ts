import type {NoteEvent} from './constants.js';
/** Momentary visual highlights. They never persist into a following pause/silence. */
export function notesAtMoment(notes: readonly NoteEvent[], positionMs: number, holdMs=190): NoteEvent[] {
  if(!Number.isFinite(positionMs))return [];
  return notes.filter(n=>Number.isFinite(n.time)&&positionMs>=n.time&&positionMs-n.time<holdMs);
}
