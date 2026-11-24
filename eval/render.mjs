// Writes the photo-like test images to eval/out/. Needs `npm run dev` and Chrome with --remote-debugging-port=9333.
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: 'http://localhost:5183/eval/eval.html?only=none' });
await new Promise((r) => setTimeout(r, 2500));
const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => { const n = await (await fetch('./notices.json')).json(); const out = {}; for (const [i, x] of n.entries()) out[x.id] = (await renderPhoto(x, i)).dataUrl.split(',')[1]; return out; })()` });
for (const [k, v] of Object.entries(r.result.value)) fs.writeFileSync(`${dir}out/${k}.jpg`, Buffer.from(v, 'base64'));
console.log(Object.keys(r.result.value).join(' ')); ws.close();
