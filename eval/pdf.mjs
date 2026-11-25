// Prints one test document page to a PDF, for trying the PDF input. Usage: node eval/pdf.mjs <docs page> <out.pdf>
import fs from 'node:fs';
const [page, out] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: `http://localhost:5183/eval/docs/${page}` }); await new Promise((r) => setTimeout(r, 1200));
const r = await send('Page.printToPDF', { printBackground: true, paperWidth: 1000 / 96, paperHeight: 1414 / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
fs.writeFileSync(out, Buffer.from(r.data, 'base64')); ws.close();
