/** Ndarje orientuese e frazave nga pauzat mes goditjeve të detektuara.
 * Nuk imponon grupe fikse çdo katër nota dhe nuk pretendon të njohë strukturën muzikore perfekte.
 */
export const GROUP_COLORS = ['#e8b45a','#42bdae','#b894f6','#f08097','#79aaf0','#86c870','#f2a36d','#57cad4'] as const;
export interface GroupMark {start:number;label:string;color:string}
export function detectNoteGroups(hits:readonly {time:number}[], minNotes=3):GroupMark[]{
  const sorted=[...new Set(hits.filter(h=>Number.isFinite(h.time)&&h.time>=0)
    .map(h=>Math.round(h.time)))].sort((a,b)=>a-b);
  const groups:GroupMark[]=[{start:0,label:'Grupi 1',color:GROUP_COLORS[0]}];
  if(sorted.length<minNotes*2)return groups;
  const gaps=sorted.slice(1).map((v,i)=>v-sorted[i]).filter(g=>g>=60&&g<=1100).sort((a,b)=>a-b);
  // Mediana ndaj artefakteve; një pauzë reale është dukshëm më e gjatë se ritmi normal.
  const typical=gaps.length?gaps[Math.floor((gaps.length-1)/2)]:300;
  const threshold=Math.max(480,Math.min(1200,Math.round(typical*1.85)));
  let startIndex=0;
  for(let i=1;i<sorted.length;i++){
    const gap=sorted[i]-sorted[i-1];
    const before=i-startIndex;
    const after=sorted.length-i;
    if(gap>=threshold && before>=minNotes && after>=minNotes){
      groups.push({start:sorted[i],label:`Grupi ${groups.length+1}`,color:GROUP_COLORS[groups.length%GROUP_COLORS.length]});
      startIndex=i;
    }
  }
  return groups;
}
/** Një notë mund të jetë në grupin pasardhës pa lëvizur audio-n ose notat fqinje.
 * Referenca ruhet si fillimi i grupit, në mënyrë që eksporti/importi ta ruajë zgjedhjen.
 */
export function groupForNote(groups:readonly {start:number}[], note:{time:number;groupStart?:number}):number{
  if(Number.isFinite(note.groupStart)){
    const forced=groups.findIndex(g=>g.start===note.groupStart);
    if(forced>=0)return forced;
  }
  return groupAtTime(groups,note.time);
}
export function groupAtTime(groups:readonly {start:number}[],time:number):number{
  let index=0;for(let i=0;i<groups.length;i++)if(groups[i].start<=time)index=i;else break;
  return index;
}
