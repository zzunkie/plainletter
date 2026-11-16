// Opens eval.html in a Chrome started with --remote-debugging-port=9333 (and `npm run dev` running),
// waits for the run to finish, and saves out/results.json. Usage: node eval/run.mjs [id,id]
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const only = process.argv[2] ? `?only=${process.argv[2]}` : '';
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
  if (v.startsWith('{')) { const out = JSON.parse(v); if (!only) fs.writeFileSync(`${dir}out/results.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.summary, null, 1)); for (const row of out.rows) if (row.idsSent.length || row.figuresKept.includes(false) || !row.deadlineRight || !row.amountRight || row.agencyKept.includes(false)) console.log(row.id, { sent: row.idsSent, kept: row.figuresKept, agency: row.agencyKept, deadline: row.explained.deadline_iso, amount: row.explained.amount }); break; }
  process.stdout.write(`\r${v.slice(0, 40)}   `);
}
ws.close();
