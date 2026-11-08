import type {Song,Stanza} from './constants.js';
import {groupForNote} from './grouping.js';

export const DEFAULT_GROUP_MS=1000;
const MAX_END=3_599_999;
/** A group's length follows its notes, never the duration of the attached MP3. */
export function groupLengthBounds(song:Song,index:number):{min:number;max:number;initial:number} {
  const groups=song.stanzas??[],group=groups[index];
  if(!group)throw Error('Zgjidh një grup.');
  const max=groups[index+1]?.start??MAX_END;
  const members=song.notes.filter(n=>groupForNote(groups,n)===index&&n.time>=group.start&&n.time<max);
  const last=members.length?Math.max(...members.map(n=>n.time)):null;
  const min=Math.min(max,Math.max(group.start+100,last===null?0:last+80));
  const initial=Math.min(max,Math.max(group.start+DEFAULT_GROUP_MS,last===null?0:last+180));
  return {min,max,initial};
}
export function groupEnd(song:Song,index:number):number {
  const group=song.stanzas?.[index],bounds=groupLengthBounds(song,index);
  return Math.min(bounds.max,Math.max(bounds.min,Number.isFinite(group?.end)?group!.end!:bounds.initial));
}
export function resizedGroupEnd(song:Song,index:number,proposed:number):number {
  if(!Number.isFinite(proposed))throw Error('Vendos një gjatësi të vlefshme.');
  const bounds=groupLengthBounds(song,index);
  return Math.min(bounds.max,Math.max(bounds.min,Math.round(proposed)));
}
export function withGroupEnd(song:Song,index:number,proposed:number):Song {
  const end=resizedGroupEnd(song,index,proposed);
  const stanzas=(song.stanzas??[]).map((g,i):Stanza=>i===index?{...g,end}:{...g});
  return {...song,notes:song.notes.map(n=>({...n})),stanzas};
}
