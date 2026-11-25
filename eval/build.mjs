// Builds the test set from eval/docs: merges the truth records into notices.json, renders every
// page to an image, and gives it a photo look (tilt, shear, blur, shadow, noise, JPEG) in out/.
// Needs `npm run dev` and Chrome with --remote-debugging-port=9333. Usage: node eval/build.mjs [lang,lang]
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const langs = (process.argv[2] || 'ko,de,ja,en,fr,es').split(',');
const newOnly = ['fresh', 'final'].includes(process.argv[3]) ? process.argv[3] : '';
const all = fs.readdirSync(`${dir}docs`).filter((f) => f.endsWith('.json')).sort().flatMap((f) => JSON.parse(fs.readFileSync(`${dir}docs/${f}`, 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
// Letters 01 to 03 of each language were used while tuning prompts and rules. 04 to 08 were held
// out until the first full run; the rules changed once after it. 09 to 11 were written after that
// change. 12 to 14 were written after the last change to prompts and rules and were run once.
for (const n of all) n.split = +n.id.slice(2) <= 3 ? 'dev' : +n.id.slice(2) <= 8 ? 'held-out' : +n.id.slice(2) <= 11 ? 'fresh' : 'final';
fs.writeFileSync(`${dir}notices.json`, JSON.stringify(all, null, 1));

const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const send = (method, params = {}) => new Promise((res) => { const i = ++id; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); res(m.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1414, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(`${dir}out/pages`, { recursive: true });
const todo = all.filter((n) => langs.includes(n.id.slice(0, 2)) && (!newOnly || n.split === newOnly));
for (const n of todo) for (const page of n.pages) {
  await send('Page.navigate', { url: `http://localhost:5183/eval/docs/${page}` }); await new Promise((r) => setTimeout(r, 700));
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1000, height: 1414, scale: 1 } });
  fs.writeFileSync(`${dir}out/pages/${page.replace('.html', '.png')}`, Buffer.from(r.data, 'base64'));
}
await send('Page.navigate', { url: 'http://localhost:5183/eval/blank.html' }); await new Promise((r) => setTimeout(r, 1200));
let k = 0;
for (const n of all) for (const page of n.pages) {
  k += 1; if (!todo.includes(n)) continue;
  const name = page.replace('.html', '');
  const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `photoFrom('out/pages/${name}.png', ${k}).then((p) => p.dataUrl)` });
  fs.writeFileSync(`${dir}out/${name}.jpg`, Buffer.from(r.result.value.split(',')[1], 'base64'));
}
console.log(`${all.length} letters, ${all.reduce((a, n) => a + n.pages.length, 0)} pages; built ${todo.length}`); ws.close();
