import {upperFret} from './constants.js';
/** A precise tab click maps pixels to ms irrespective of live playback position. */
export function manualTapTime(
  isPlaying:boolean, playerMs:number, x:number,
  viewStartMs:number, left:number, scale:number, maxDurationMs:number
):number {
  const proposed=viewStartMs+(x-left)/scale;
  if(!Number.isFinite(proposed))return 0;
  return Math.max(0,Math.min(Math.max(0,maxDurationMs),Math.round(proposed)));
}
export function manualNote(n:number,time:number,withF=true,groupStart=0,string:1|2=n===14?2:1,upperNoteNumber=14){
  if(!Number.isInteger(n)||n<1||n>15||!Number.isFinite(time)||time<0)
    throw new Error('Nota ose koha nuk është e vlefshme.');
  const targetString:1|2=n===14?2:n===15?1:string;
  return {time:Math.round(time),noteNumber:n,string:targetString,
    confidence:1,withF:targetString===2?false:withF,
    ...(Number.isInteger(upperNoteNumber)&&upperNoteNumber>=1&&upperNoteNumber<=13?{upperNoteNumber}:{}),
    groupStart,detail:'Vendosur manualisht'};
}

/** A new entry always chooses the lower note and its own upper-string companion. */
export function manualEntryNote(n:number,time:number,upper='14',groupStart=0){
  if(!Number.isInteger(n)||!(n>=1&&n<=13||n===15))throw Error('Zgjidh perden poshtë 1–13 ose G hapur.');
  if(upper!=='off'&&(!Number.isInteger(Number(upper))||Number(upper)<1||Number(upper)>14))throw Error('Zgjidh F, një perde lart 1–13 ose Pa telin lart.');
  return manualNote(n,time,upper!=='off',groupStart,1,upperFret(Number(upper)));
}

/** Every band of the canvas maps to the same time at its horizontal pixel.
 * The left labels and right padding snap to the visible edge rather than
 * generating a negative or off-screen note. */
export function manualAnywhereTime(x:number,viewStartMs:number,left:number,scale:number,canvasWidth:number,right:number,maxDurationMs:number):number {
  const px=Math.max(left,Math.min(canvasWidth-right,Number.isFinite(x)?x:left));
  return manualTapTime(false,0,px,viewStartMs,left,scale,maxDurationMs);
}
