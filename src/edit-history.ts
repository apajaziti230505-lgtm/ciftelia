import type {Song} from './constants.js';

export interface EditorSnapshot {song:Song;selectedGroupStart:number;time:number;}
interface Step {snapshot:EditorSnapshot;label:string;bytes:number;}
export interface HistoryResult {snapshot:EditorSnapshot;label:string;}

/** Bounded, independent snapshots. Undo and redo never expose stored mutable objects. */
export class EditHistory {
  private past:Step[]=[];
  private future:Step[]=[];
  constructor(private maxSteps=50,private maxBytes=4*1024*1024){
    if(!Number.isInteger(maxSteps)||maxSteps<1||!Number.isFinite(maxBytes)||maxBytes<1)throw Error('Kufij historie të pavlefshëm.');
  }
  get undoCount():number{return this.past.length;}
  get redoCount():number{return this.future.length;}
  get undoLabel():string{return this.past.at(-1)?.label??'';}
  get redoLabel():string{return this.future.at(-1)?.label??'';}
  private step(snapshot:EditorSnapshot,label:string):Step {
    const copy=structuredClone(snapshot);
    return {snapshot:copy,label,bytes:JSON.stringify(copy).length*2};
  }
  private trim():void {
    const bytes=()=>[...this.past,...this.future].reduce((sum,step)=>sum+step.bytes,0);
    while(this.past.length+this.future.length>1&&
      (this.past.length+this.future.length>this.maxSteps||bytes()>this.maxBytes)){
      if(this.past.length)this.past.shift();else this.future.shift();
    }
  }
  record(before:EditorSnapshot,after:EditorSnapshot,label:string):boolean {
    if(before.song.id!==after.song.id)throw Error('Historiku duhet të mbetet brenda së njëjtës këngë.');
    if(JSON.stringify(before.song)===JSON.stringify(after.song))return false;
    this.past.push(this.step(before,label));this.future=[];this.trim();return true;
  }
  undo(current:EditorSnapshot):HistoryResult|null {
    const step=this.past.pop();if(!step)return null;
    this.future.push(this.step(current,step.label));this.trim();
    return {snapshot:structuredClone(step.snapshot),label:step.label};
  }
  redo(current:EditorSnapshot):HistoryResult|null {
    const step=this.future.pop();if(!step)return null;
    this.past.push(this.step(current,step.label));this.trim();
    return {snapshot:structuredClone(step.snapshot),label:step.label};
  }
}
