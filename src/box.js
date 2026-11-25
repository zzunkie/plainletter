// The letter box: letters the person has read, kept in this browser's IndexedDB.
// Photos, real values and explanations are stored here and nowhere else.
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('plainletter', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('letters', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('letters', mode); const req = fn(tx.objectStore('letters'));
    tx.oncomplete = () => resolve(req?.result); tx.onerror = () => reject(tx.error);
  });
};
export const saveLetter = (record) => run('readwrite', (s) => s.put(record)).catch(() => {});
export const removeLetter = (id) => run('readwrite', (s) => s.delete(id)).catch(() => {});
export const getLetter = (id) => run('readonly', (s) => s.get(id)).catch(() => null);
// Open letters first, soonest deadline on top.
export const listLetters = async () => ((await run('readonly', (s) => s.getAll()).catch(() => [])) || [])
  .sort((a, b) => (+!!a.done - +!!b.done) || (a.explanation.deadline_iso || '9999').localeCompare(b.explanation.deadline_iso || '9999'));
