import { deviceStatus, downloadDeviceModel, warmUp, readLetter, explain, startFollowUp } from './pipeline.js';
import { redact } from './redact.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = $('#app');
const state = { status: 'unavailable', language: 'English' };
const LANGUAGES = ['English', 'Korean', 'Spanish', 'Vietnamese', 'Chinese', 'Japanese', 'German', 'French'];
const SAMPLES = [
  { file: 'korea-health-insurance', title: 'Health insurance notice', place: 'Korea, in Korean' },
  { file: 'germany-income-tax', title: 'Income tax assessment', place: 'Germany, in German' },
  { file: 'japan-pension', title: 'Pension contribution notice', place: 'Japan, in Japanese' },
];

async function refreshStatus() {
  state.status = await deviceStatus();
  const pill = $('#device-pill');
  const text = { available: 'On-device model ready', downloadable: 'On-device model not downloaded', downloading: 'Downloading on-device model', unavailable: 'On-device model unavailable in this browser' }[state.status];
  pill.textContent = text; pill.className = 'pill ' + (state.status === 'available' ? 'on' : 'off');
}

// Photos are resized in the browser. Nothing is uploaded here.
async function toJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { url, base64: url.split(',')[1] };
}

function home() {
  app.innerHTML = `
  <section class="start">
    <div>
      <h1>Read official letters in a language you don't know. Your personal details stay on your device.</h1>
      <p class="lead">Start with a photo of a tax bill or a government notice. Chrome's on-device model reads it and replaces your name, ID numbers, address, and bank details with placeholders like [NAME_1], so only the masked text goes to the cloud for an explanation.</p>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*">
        <div class="row"><span class="file">Choose a photo</span><button type="button" class="ghost" id="cam">Take a photo</button><span>or drop one here</span></div>
        <div class="row" style="margin-top:16px"><span>Explain it in</span>
          <select id="lang">${LANGUAGES.map((l) => `<option${l === state.language ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </label>
      <div id="device-note"></div>
    </div>
    <div>
      <h2 style="margin-bottom:14px">Try a sample letter</h2>
      <div class="samples">${SAMPLES.map((s) => `<button data-sample="${s.file}"><img src="/samples/${s.file}.jpg" alt=""><span><strong>${s.title}</strong><small>${s.place}</small></span></button>`).join('')}</div>
    </div>
  </section>`;
  $('#lang').onchange = (e) => { state.language = e.target.value; };
  $('#file').onchange = (e) => e.target.files[0] && begin(e.target.files[0]);
  $('#cam').onclick = (e) => { e.preventDefault(); camera(); };
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && begin(e.dataTransfer.files[0]); };
  app.querySelectorAll('[data-sample]').forEach((b) => { b.onclick = async () => begin(await (await fetch(`/samples/${b.dataset.sample}.jpg`)).blob()); });
  const note = $('#device-note');
  if (state.status === 'downloadable' || state.status === 'downloading') {
    note.innerHTML = `<p class="hint">Chrome can read letters on this device after a one-time download of its on-device model (about 4 GB).</p><button class="ghost" id="dl">Download on-device model</button>`;
    $('#dl').onclick = async (e) => { e.target.disabled = true; await downloadDeviceModel((p) => { e.target.textContent = `Downloading (${Math.round(p * 100)}%)`; }); await refreshStatus(); home(); };
  } else if (state.status === 'unavailable') {
    note.innerHTML = `<p class="hint">This browser doesn't support the on-device model. Open Plainletter in desktop Chrome to keep your photo on your device, or choose a photo here to read it in the cloud.</p>`;
  }
}

// Takes the picture with this computer's camera, so the photo never passes through a phone or a cloud drive.
async function camera() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } }); }
  catch { alert('The camera is not available. Choose a photo instead.'); return; }
  const box = document.createElement('div'); box.className = 'cam';
  box.innerHTML = `<div><video autoplay playsinline></video><div class="row"><button id="shoot">Use this photo</button><button class="ghost" id="cancel">Cancel</button></div></div>`;
  document.body.append(box);
  const video = $('video', box); video.srcObject = stream;
  const close = () => { stream.getTracks().forEach((t) => t.stop()); box.remove(); };
  $('#cancel', box).onclick = close;
  $('#shoot', box).onclick = () => {
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    c.toBlob((blob) => { close(); begin(blob); }, 'image/jpeg', 0.92);
  };
}

async function begin(blob) {
  const photo = await toJpeg(blob);
  let where = 'device';
  if (state.status !== 'available') {
    if (!confirm('The on-device model isn\'t ready in this browser, so the unmasked photo will be sent to Gemini in the cloud to be read and explained. Continue?')) return;
    where = 'cloud';
  }
  const names = ['Reading the letter', 'Reading it a second time to catch misread characters', 'Finding and masking personal details'];
  app.innerHTML = `
  <section class="work">
    <figure class="photo" style="margin:0"><img src="${photo.url}" alt="Your letter"><figcaption>${where === 'device' ? 'This photo stays on this device.' : 'This photo was sent to the cloud because the on-device model wasn\'t ready.'}</figcaption></figure>
    <div id="side"><h2>${where === 'device' ? 'Working on your device' : 'Working in the cloud'}</h2><ul class="steps">${names.map((n) => `<li>${n}</li>`).join('')}</ul></div>
  </section>`;
  const items = app.querySelectorAll('.steps li');
  try {
    const letter = await readLetter(photo.base64, where, (name) => { const i = names.indexOf(name); items.forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'now' : ''; }); });
    review(letter, where);
  } catch (e) { console.error(e); $('#side').innerHTML += `<p class="err">The letter could not be read. Try a sharper photo with the whole page in view.</p><button class="ghost" onclick="location.reload()">Start over</button>`; }
}

const tokens = (text) => esc(text).replace(/\[[A-Z_]+_\d+\]/g, (t) => `<span class="tok">${t}</span>`);

function review(letter, where) {
  const side = $('#side');
  // Placeholders that appear in the outgoing text, each with every spelling it stands for.
  const used = () => {
    const sent = `${letter.outgoing}\n${letter.alternates.join('\n')}`;
    const groups = new Map();
    letter.vault.filter((v) => sent.includes(v.token)).forEach((v) => groups.set(v.token, [...(groups.get(v.token) || []), v.value]));
    return [...groups];
  };
  const draw = () => {
    side.innerHTML = `
    <div class="ledger">
      <div class="keep"><h2>Stays on this device</h2>
        <ul class="vault"><li>Original photo</li>${used().map(([token, values]) => `<li><span class="tok">${token}</span><span>${values.map(esc).join(' / ')}</span></li>`).join('')}</ul></div>
      <div class="send"><h2>Goes to the cloud</h2><pre class="out" id="out">${tokens(letter.outgoing)}</pre>
        ${letter.alternates.length ? `<h2 style="margin-top:14px">Second reading, where it differed</h2><pre class="out">${tokens(letter.alternates.join('\n'))}</pre><p class="hint">Both readings are sent so the cloud model can resolve misread characters.</p>` : ''}</div>
    </div>
    <p class="hint" style="margin:0 0 14px">Select any text under “Goes to the cloud” to hide more before sending.</p>
    <div class="row"><button id="go">Explain this letter</button><label class="row" style="gap:8px">in <select id="lang2">${LANGUAGES.map((l) => `<option${l === state.language ? ' selected' : ''}>${l}</option>`).join('')}</select></label><button class="ghost" id="hide">Hide selection</button></div>`;
    $('#lang2').onchange = (e) => { state.language = e.target.value; };
    $('#hide').onclick = () => {
      const picked = String(getSelection()).trim();
      if (picked.length < 2 || !letter.outgoing.includes(picked)) return;
      letter.outgoing = redact(letter.outgoing, [{ kind: 'HIDDEN', value: picked }], letter.vault).outgoing;
      letter.alternates = letter.alternates.map((l) => redact(l, [{ kind: 'HIDDEN', value: picked }], letter.vault).outgoing);
      draw();
    };
    $('#go').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Explaining…';
      try { answer(letter, await explain(letter, state.language)); }
      catch (err) { e.target.disabled = false; e.target.textContent = 'Explain this letter'; console.error(err); side.insertAdjacentHTML('beforeend', `<p class="err">Couldn't get an explanation. Check your connection and try again.</p>`); }
    };
  };
  draw();
}

function ics(ex) {
  const d = ex.deadline_iso.replaceAll('-', '');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plainletter//EN', 'BEGIN:VEVENT', `UID:${Date.now()}@plainletter`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:Deadline: ${ex.sender.trim()}${ex.amount ? ` (${ex.amount})` : ''}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}

function answer(letter, ex) {
  const side = $('#side');
  // Marks the values this browser put back in place of placeholders.
  const back = (text, typed = []) => {
    const values = [...typed, ...letter.vault].sort((a, b) => b.value.length - a.value.length);
    return values.reduce((html, v, i) => html.split(esc(v.value)).join(`\u0001${i}\u0002`), esc(text))
      .replace(/\u0001(\d+)\u0002/g, (m, i) => `<mark title="Sent as ${values[i].token}">${esc(values[i].value)}</mark>`);
  };
  const fact = (k, v, printed) => (v ? `<div><div class="k">${k}</div><div class="v">${esc(v)}</div>${printed ? `<div class="printed">On the letter: ${esc(printed)}</div>` : ''}</div>` : '');
  const top = (ex, status = '') => `
    ${ex.source === 'on_device' ? `<p class="note">You're offline, so this explanation was generated by your on-device model.</p>` : ''}
    <h1>${esc(ex.title || ex.what_it_is)}</h1>
    <p class="from">From ${esc(ex.sender)}</p>
    ${ex.title ? `<p>${back(ex.what_it_is)}</p>` : ''}
    ${ex.amount || ex.deadline ? `<div class="facts">${fact('Amount', ex.amount, ex.amount_printed_as)}${fact('Deadline', ex.deadline, ex.deadline_printed_as)}</div>` : ''}
    <h2>What to do</h2><ol class="todo">${(ex.steps || []).map((s) => `<li>${back(s)}</li>`).join('')}</ol>
    ${ex.if_ignored ? `<h2>If you do nothing</h2><p>${back(ex.if_ignored)}</p>` : ''}
    ${ex.contact ? `<h2>Who to contact</h2><p>${back(ex.contact)}</p>` : ''}
    ${(ex.corrected || []).filter(Boolean).length ? `<h2>Misread on device, corrected in the cloud</h2><ul class="fixed">${ex.corrected.filter(Boolean).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${ex.source === 'on_device' ? '' : `<p class="source">${ex.checked ? 'Explained and double-checked by Gemini in the cloud from the masked text.' : 'Explained by Gemini in the cloud from the masked text.'} <mark>Marked values</mark> were put back on this device.${status ? ` <span class="checking">${status}</span>` : ''}</p>`}
    ${(ex.unclear || []).length ? `<p class="note">Unclear in the photo: ${ex.unclear.map(esc).join(' ')}</p>` : ''}
    <div class="row">${ex.deadline_iso ? `<a href="${ics(ex)}" download="deadline.ics"><button class="ghost">Add deadline to calendar</button></a>` : ''}<button class="ghost" onclick="location.reload()">Read another letter</button></div>`;
  side.innerHTML = `
  <article class="answer">
    <div id="top">${top(ex, ex.source === 'on_device' ? '' : 'A larger model is double-checking the reading…')}</div>
    ${ex.source === 'on_device' ? `<p class="hint" style="margin-top:24px">You can ask follow-up questions once you're back online.</p>` : `<h2 style="margin-top:28px">Ask about this letter</h2>
    <form class="ask" id="ask"><input id="q" placeholder="Can I pay in installments?" autocomplete="off"><button>Ask</button></form>
    <div id="qa"></div>`}
  </article>`;
  if (ex.source === 'on_device') return;
  if (ex.source !== 'on_device') {
    explain(letter, state.language, { check: true })
      .then((checked) => { $('#top').innerHTML = top(checked); })
      .catch(() => { $('#top').innerHTML = top(ex); });
  }
  const ask = startFollowUp(letter, state.language, ex);
  $('#ask').onsubmit = async (e) => {
    e.preventDefault(); const q = $('#q').value.trim(); if (!q) return; $('#q').value = '';
    const block = document.createElement('div'); block.className = 'qa'; block.innerHTML = `<div class="q">${esc(q)}</div><div class="a">…</div>`; $('#qa').prepend(block);
    const show = (r) => { block.innerHTML = `<div class="q">${esc(q)}</div>${r.sent !== q ? `<div class="sent">Sent as: ${tokens(r.sent)}</div>` : ''}<div class="a">${r.answer ? back(r.answer, r.typed).replace(/(From the letter:|Usual practice:)/g, '<strong>$1</strong>').replace(/\n+/g, '<br><br>') : 'Checking how this agency usually handles it…'}</div>${r.sources?.length ? `<div class="sources">Sources: ${r.sources.map((x) => `<a href="${esc(x.uri)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(', ')}</div>` : ''}`;
      // Google Search results come with a suggestions strip that has to be shown as provided.
      if (r.searchWidget) { const f = document.createElement('iframe'); f.className = 'search'; f.sandbox = 'allow-popups allow-popups-to-escape-sandbox'; f.title = 'Google Search suggestions'; f.srcdoc = r.searchWidget; block.append(f); } };
    try { show(await ask(q, show)); }
    catch { block.querySelector('.a').innerHTML = `<span class="err">Couldn't get an answer. Check your connection and try again.</span>`; }
  };
}

await refreshStatus();
if (state.status === 'available') warmUp();
home();
