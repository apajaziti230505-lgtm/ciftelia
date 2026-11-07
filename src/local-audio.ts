/** Save a song's original audio on this device, not in GitHub or on a server. */
const DB_NAME='ciftelia-studio-original-audio';
const STORE='recordings';
let opening:Promise<IDBDatabase>|null=null;
function openDB():Promise<IDBDatabase>{
  if(!('indexedDB' in window))return Promise.reject(new Error('Ky shfletues nuk mbështet ruajtjen e audios lokale.'));
  if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error??new Error('IndexedDB nuk u hap.'));
  }).catch(e=>{opening=null;throw e;});
  return opening!;
}
export async function putOriginal(id:string,file:Blob):Promise<void>{
  const db=await openDB();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(file,id);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Ruajtja e audios dështoi.'));
    tx.onabort=()=>reject(tx.error??new Error('Ruajtja e audios u anulua.'));
  });
}
export async function getOriginal(id:string):Promise<Blob|null>{
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).get(id);
    req.onsuccess=()=>resolve(req.result??null);
    req.onerror=()=>reject(req.error??new Error('Audio nuk u lexua.'));
  });
}
export async function deleteOriginal(id:string):Promise<void>{
  const db=await openDB();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Audio nuk u fshi.'));
  });
}
