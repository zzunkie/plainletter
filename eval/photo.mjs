// Evaluates an expression on the eval page and writes the returned data URL(s) as files.
// Usage: node eval/photo.mjs '<js returning {name: dataUrl}>' <outDir>
import fs from 'node:fs';
const [expr, outDir] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: 'http://localhost:5183/eval/blank.html' }); await new Promise((r) => setTimeout(r, 1500));
const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => (${expr}))()` });
if (!r.result?.value) { console.error(JSON.stringify(r).slice(0, 600)); process.exit(1); }
for (const [name, url] of Object.entries(r.result.value)) fs.writeFileSync(`${outDir}/${name}`, Buffer.from(url.split(',')[1], 'base64'));
console.log(Object.keys(r.result.value).join(' ')); ws.close();
