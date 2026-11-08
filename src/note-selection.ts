/** Move selected attacks by one shared offset. Their rhythm and other notes stay intact. */
export function moveNoteSelection(notes:readonly {time:number}[],indices:readonly number[],requestedDelta:number,maxTime=3_599_999):{delta:number;times:number[]} {
  if(!Number.isFinite(requestedDelta)||!Number.isFinite(maxTime)||maxTime<0)throw Error('Zhvendosje e pavlefshme.');
  const selected=new Set(indices);
  for(const index of selected)if(!Number.isInteger(index)||index<0||index>=notes.length||!Number.isFinite(notes[index].time))throw Error('Zgjedhje e pavlefshme e notave.');
  if(!selected.size)return {delta:0,times:notes.map(n=>n.time)};
  const times=[...selected].map(i=>notes[i].time);
  const min=-Math.min(...times),max=Math.min(3_599_999,maxTime)-Math.max(...times);
  if(max<min)throw Error('Notat nuk futen brenda kufirit kohor.');
  const delta=Math.max(min,Math.min(max,Math.round(requestedDelta)));
  return {delta,times:notes.map((n,i)=>n.time+(selected.has(i)?delta:0))};
}
