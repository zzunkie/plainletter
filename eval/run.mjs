// Opens eval.html in a Chrome started with --remote-debugging-port=9333 (and `npm run dev` running),
// waits for the run to finish, and saves out/results.json. Usage: node eval/run.mjs [id,id]
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
// Usage: node eval/run.mjs [dev|held-out|id,id] [outName]
const arg = process.argv[2] || '';
const only = !arg ? '' : arg === 'real' ? '?set=real' : ['dev', 'held-out', 'fresh', 'final'].includes(arg) ? `?split=${arg}${process.argv[4] === 'nano' ? '&nano=1' : ''}` : `?only=${arg}`;
const outName = process.argv[3];
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: `http://localhost:5183/eval/eval.html${only}` });
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await send('Runtime.evaluate', { expression: 'window.__eval ? JSON.stringify(window.__eval) : document.getElementById("o")?.textContent', returnByValue: true });
  const v = r.result?.value || '';
  if (v.startsWith('{')) { const out = JSON.parse(v); if (outName) fs.writeFileSync(`${dir}out/runs/${outName}.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.summary, null, 1)); if (out.failedToRead?.length) console.log('failed to read', out.failedToRead); for (const row of out.rows) if (row.idsSent.length || row.figuresRead.includes(false) || !row.finalDeadlineRight || !row.finalAmountRight || !row.actionFinal || !row.consequenceFinal || row.agencyKept.includes(false)) console.log(row.id, JSON.stringify({ sent: row.idsSent, read: row.figuresRead, agency: row.agencyKept, deadline: row.final.deadline_iso, amount: row.final.amount, action: row.actionFinal, consequence: row.consequenceFinal, sec: Math.round(row.readSec) })); break; }
  process.stdout.write(`\r${v.slice(0, 40)}   `);
}
ws.close();
