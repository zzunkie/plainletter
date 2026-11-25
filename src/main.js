import { deviceStatus, downloadDeviceModel, warmUp, readLetter, explain, startFollowUp } from './pipeline.js';
import { redact } from './redact.js';
import { filesToPages } from './pages.js';
import { saveLetter, removeLetter, listLetters } from './box.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = $('#app');
const state = { status: 'unavailable', language: 'English' };
const LANGUAGES = ['English', 'Korean', 'Spanish', 'Vietnamese', 'Chinese', 'Japanese', 'German', 'French'];
const SAMPLES = [
  { pages: ['korea-health-insurance'], title: 'Health insurance arrears notice', place: 'Korea, Korean' },
  { pages: ['germany-child-benefit-1', 'germany-child-benefit-2'], title: 'Child benefit repayment decision', place: 'Germany, German, 2 pages' },
  { pages: ['japan-resident-tax'], title: 'Resident tax notice', place: 'Japan, Japanese' },
  { pages: ['us-balance-due'], pdf: 'us-balance-due.pdf', title: 'Balance due notice', place: 'United States, English, PDF' },
];

async function refreshStatus() {
  state.status = await deviceStatus();
  const pill = $('#device-pill');
  const text = { available: 'On-device model ready', downloadable: 'On-device model not downloaded', downloading: 'Downloading on-device model', unavailable: 'On-device model unavailable in this browser' }[state.status];
  pill.textContent = text; pill.className = 'pill ' + (state.status === 'available' ? 'on' : 'off');
}

// Days until a deadline, in words.
function due(iso) {
  if (!iso) return '';
  const days = Math.round((new Date(`${iso}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  return days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'due today' : `due in ${days} day${days === 1 ? '' : 's'}`;
}

async function home() {
  const saved = await listLetters();
  app.innerHTML = `
  <section class="start">
    <div>
      <h1>Read official letters in a language you don't know. Your personal details stay on your device.</h1>
      <p class="lead">Start with photos or a PDF of a tax bill or official notice, one page or several. Chrome's on-device model reads each page and replaces your name, ID and reference numbers, address, and bank details with placeholders like [NAME_1], so only masked text goes to the cloud for an explanation.</p>
      <label class="drop" id="drop">
        <input type="file" id="file" accept="image/*,application/pdf" multiple>
        <div class="row"><span class="file">Choose photos or a PDF</span><button type="button" class="ghost" id="cam">Take a photo</button><span>or drop files here</span></div>
        <div class="row" style="margin-top:16px"><span>Explain it in</span>
          <select id="lang">${LANGUAGES.map((l) => `<option${l === state.language ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </label>
      <div id="device-note"></div>
    </div>
    <div>
      ${saved.length ? `<h2 style="margin-bottom:6px">Your letters</h2><p class="hint" style="margin:0 0 10px">Saved in this browser only.</p>
      <ul class="box">${saved.map((r) => `<li class="${r.done ? 'done' : ''}"><button class="open" data-open="${r.id}"><strong>${esc(r.explanation.title || r.explanation.sender)}</strong><small>${esc([r.explanation.amount, r.explanation.deadline, r.done ? 'done' : due(r.explanation.deadline_iso)].filter(Boolean).join(' · '))}</small></button><button class="ghost" data-done="${r.id}">${r.done ? 'Reopen' : 'Mark done'}</button><button class="ghost" data-remove="${r.id}">Delete</button></li>`).join('')}</ul>` : ''}
      <h2 style="margin:${saved.length ? '26px' : '0'} 0 14px">Try a sample letter</h2>
      <div class="samples">${SAMPLES.map((s, i) => `<button data-sample="${i}"><img src="/samples/${s.pages[0]}.jpg" alt=""><span><strong>${s.title}</strong><small>${s.place}</small></span></button>`).join('')}</div>
    </div>
  </section>`;
  $('#lang').onchange = (e) => { state.language = e.target.value; };
  $('#file').onchange = (e) => e.target.files.length && begin([...e.target.files]);
  $('#cam').onclick = (e) => { e.preventDefault(); camera(); };
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files.length && begin([...e.dataTransfer.files]); };
  app.querySelectorAll('[data-sample]').forEach((b) => { b.onclick = async () => { const s = SAMPLES[b.dataset.sample]; begin(await Promise.all((s.pdf ? [s.pdf] : s.pages.map((f) => `${f}.jpg`)).map(async (f) => (await fetch(`/samples/${f}`)).blob()))); }; });
  app.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { const r = saved.find((x) => x.id === b.dataset.open); state.language = r.language; workView(r.pages.map((url) => ({ url })), 'device'); answer(r.letter, r.explanation, r); }; });
  app.querySelectorAll('[data-done]').forEach((b) => { b.onclick = async () => { const r = saved.find((x) => x.id === b.dataset.done); await saveLetter({ ...r, done: !r.done }); home(); }; });
  app.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = async () => { await removeLetter(b.dataset.remove); home(); }; });
  const note = $('#device-note');
  if (state.status === 'downloadable' || state.status === 'downloading') {
    note.innerHTML = `<p class="hint">Chrome can read letters on this device after a one-time download of its on-device model (about 4 GB).</p><button class="ghost" id="dl">Download on-device model</button>`;
    $('#dl').onclick = async (e) => { e.target.disabled = true; await downloadDeviceModel((p) => { e.target.textContent = `Downloading (${Math.round(p * 100)}%)`; }); if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js');
await refreshStatus(); home(); };
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
    c.toBlob((blob) => { close(); begin([blob]); }, 'image/jpeg', 0.92);
  };
}

// The page images on the left and the working area on the right.
function workView(pages, where) {
  app.innerHTML = `
  <section class="work">
    <figure class="photo" style="margin:0">${pages.map((p, i) => `<div class="pg" data-page="${i}"><img src="${p.url}" alt="Page ${i + 1} of your letter"></div>`).join('')}<figcaption>${where === 'device' ? `${pages.length > 1 ? 'These pages stay' : 'This page stays'} on your device.` : 'Sent to the cloud because the on-device model wasn\'t ready.'}</figcaption></figure>
    <div id="side"></div>
  </section>`;
}

async function begin(files) {
  let pages;
  try { pages = await filesToPages(files); } catch (e) { console.error(e); alert('Could not open this file. Choose photos or a PDF.'); return; }
  if (!pages.length) return;
  let where = 'device';
  if (state.status !== 'available') {
    if (!confirm('The on-device model isn\'t ready in this browser, so the unmasked pages will be sent to Gemini in the cloud to be read and explained. Continue?')) return;
    where = 'cloud';
  }
  const names = ['Reading the letter', 'Re-reading to catch misread characters', 'Finding and masking personal details'];
  workView(pages, where);
  $('#side').innerHTML = `<h2>${where === 'device' ? 'Working on your device' : 'Working in the cloud'}</h2><ul class="steps">${names.map((n) => `<li>${n}</li>`).join('')}</ul>`;
  const items = app.querySelectorAll('.steps li');
  try {
    const letter = await readLetter(pages, where, (name, detail) => { const i = names.indexOf(name); items.forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'now' : ''; li.textContent = names[k] + (k === i ? detail : ''); }); });
    letter.pages = pages.map((p) => p.url);
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
  // One placeholder can stand for several overlapping readings of the same value.
  // The list shows the ones that differ, two at most.
  const brief = (values) => {
    const kept = [];
    for (const v of [...values].sort((a, b) => a.length - b.length)) if (!kept.some((k) => v.includes(k) || k.includes(v))) kept.push(v);
    return kept.length > 2 ? [...kept.slice(0, 2), `and ${kept.length - 2} more`] : kept;
  };
  const draw = () => {
    side.innerHTML = `
    <div class="ledger">
      <div class="keep"><h2>Stays on this device</h2>
        <ul class="vault"><li>Original photo</li>${used().map(([token, values]) => `<li><span class="tok">${token}</span><span>${brief(values).map(esc).join(' / ')}</span></li>`).join('')}</ul></div>
      <div class="send"><h2>Goes to the cloud</h2><pre class="out" id="out">${tokens(letter.outgoing)}</pre>
        ${letter.alternates.length ? `<details class="second"><summary>Second reading: ${letter.alternates.length} line${letter.alternates.length === 1 ? '' : 's'} read differently (included when sent)</summary><pre class="out">${tokens(letter.alternates.join('\n'))}</pre></details><p class="hint">Both readings are sent so the cloud model can resolve misread characters.</p>` : ''}</div>
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

// Finds where on the pages a value was read: the strip whose text holds it, and how far down
// that strip's text it comes. The position is approximate, so the band is a few lines tall.
function locate(letter, candidates) {
  const flat = (t) => String(t ?? '').normalize('NFKC').replace(/\s/g, '');
  for (const candidate of candidates.map(flat).filter((c) => c.length >= 4)) {
    // The whole value first, then shorter pieces of it, longest first.
    // A piece shorter than most of the value would match other rows of a table, so it is not tried.
    for (let size = Math.min(candidate.length, 14); size >= Math.max(5, Math.ceil(Math.min(candidate.length, 14) * 0.7)); size -= 1) {
      for (let start = 0; start + size <= candidate.length; start += 1) {
        const piece = candidate.slice(start, start + size);
        if (!/\d/.test(piece)) continue;
        for (const r of letter.regions || []) {
          const text = flat(r.lines.join('')); const at = text.indexOf(piece);
          if (at !== -1) return { page: r.page, y: r.y0 + ((at + piece.length / 2) / text.length) * (r.y1 - r.y0), h: 0.06 };
        }
      }
    }
  }
  return null;
}

function answer(letter, ex, record) {
  const side = $('#side');
  record ??= { id: String(Date.now()), savedAt: Date.now(), done: false };
  // Kept in this browser so the person can come back to it, also offline.
  const keep = (explanation) => saveLetter({ ...record, language: state.language, pages: letter.pages || record.pages, letter: { outgoing: letter.outgoing, alternates: letter.alternates, vault: letter.vault, regions: letter.regions }, explanation });
  const point = (explanation) => {
    app.querySelectorAll('.pg .band').forEach((b) => b.remove());
    const found = [['Amount', [explanation.amount]], ['Deadline', [(String(explanation.deadline_printed_as || '').match(/\d{1,4}[^\d\n]{0,12}\d{1,2}[^\d\n]{0,12}\d{1,4}\S?/) || [''])[0], explanation.deadline_printed_as]]]
      .map(([label, candidates]) => ({ label, at: locate(letter, candidates) })).filter((f) => f.at);
    // When both are printed on the same line, one band carries both labels.
    if (found.length === 2 && found[0].at.page === found[1].at.page && Math.abs(found[0].at.y - found[1].at.y) < 0.035) found.splice(0, 2, { label: 'Amount and deadline', at: found[0].at });
    found.forEach(({ label, at }) => {
      const page = app.querySelector(`.pg[data-page="${at.page}"]`);
      if (page) page.insertAdjacentHTML('beforeend', `<div class="band${label === 'Deadline' ? ' left' : ''}" style="top:${((at.y - at.h / 2) * 100).toFixed(1)}%;height:${(at.h * 100).toFixed(1)}%"><span>${label}</span></div>`);
    });
  };
  // Marks the values this browser put back in place of placeholders.
  const back = (text, typed = []) => {
    const values = [...typed, ...letter.vault].sort((a, b) => b.value.length - a.value.length);
    return values.reduce((html, v, i) => html.split(esc(v.value)).join(`\u0001${i}\u0002`), esc(text))
      .replace(/\u0001(\d+)\u0002/g, (m, i) => `<mark title="Sent as ${values[i].token}">${esc(values[i].value)}</mark>`);
  };
  // An account the letter gives but the answer did not mention is shown from the local map.
  const accountsLeftOut = (ex) => letter.vault.filter((v) => v.token.startsWith('[ACCOUNT_') && letter.outgoing.includes(v.token) && !JSON.stringify(ex.steps || []).includes(v.value));
  const fact = (k, v, printed) => (v ? `<div><div class="k">${k}</div><div class="v">${esc(v)}</div>${printed ? `<div class="printed">On the letter: ${esc(printed)}</div>` : ''}</div>` : '');
  const top = (ex, status = '') => `
    ${ex.source === 'on_device' ? `<p class="note">You're offline, so this explanation was generated by your on-device model.</p>` : ''}
    <h1>${esc(ex.title || ex.what_it_is)}</h1>
    <p class="from">From ${esc(ex.sender)}</p>
    ${ex.title ? `<p>${back(ex.what_it_is)}</p>` : ''}
    ${ex.amount || ex.deadline ? `<div class="facts">${fact('Amount', ex.amount, ex.amount_printed_as)}${fact('Deadline', ex.deadline, ex.deadline_printed_as)}</div>` : ''}
    <h2>What to do</h2><ol class="todo">${(ex.steps || []).map((s) => `<li>${back(s)}</li>`).join('')}</ol>
    ${accountsLeftOut(ex).length ? `<p>Account on the letter: ${accountsLeftOut(ex).map((v) => `<mark title="Sent as ${v.token}">${esc(v.value)}</mark>`).join(', ')}</p>` : ''}
    ${ex.if_ignored ? `<h2>If you do nothing</h2><p>${back(ex.if_ignored)}</p>` : ''}
    ${ex.objection ? `<h2>If you disagree</h2><p>${back(ex.objection)}</p>` : ''}
    ${(ex.other_figures || []).length ? `<h2>Other amounts and dates on the letter</h2><ul class="fixed">${ex.other_figures.map((f) => `<li>${back(f)}</li>`).join('')}</ul>` : ''}
    ${ex.contact ? `<h2>Who to contact</h2><p>${back(ex.contact)}</p>` : ''}
    ${ex.source !== 'on_device' && (ex.corrected || []).filter(Boolean).length ? `<h2>Misread on device, corrected in the cloud</h2><ul class="fixed">${ex.corrected.filter(Boolean).slice(0, 8).map((c) => `<li>${esc(c)}</li>`).join('')}${ex.corrected.filter(Boolean).length > 8 ? `<li>and ${ex.corrected.filter(Boolean).length - 8} more</li>` : ''}</ul>` : ''}
    ${ex.source === 'on_device' ? '' : `<p class="source">${ex.checked ? 'Explained and double-checked by Gemini in the cloud from the masked text.' : 'Explained by Gemini in the cloud from the masked text.'} <mark>Marked values</mark> were put back on this device.${status ? ` <span class="checking">${status}</span>` : ''}</p>`}
    ${(ex.unclear || []).length ? `<p class="note">Unclear in the photo: ${ex.unclear.map(esc).join(' ')}</p>` : ''}
    <div class="row">${ex.deadline_iso ? `<a href="${ics(ex)}" download="deadline.ics"><button class="ghost">Add deadline to calendar</button></a>` : ''}<button class="ghost" id="home">Read another letter</button></div>
    <p class="hint">Saved to Your letters in this browser. ${due(ex.deadline_iso) ? `${due(ex.deadline_iso).replace(/^./, (c) => c.toUpperCase())}.` : ''}</p>`;
  side.innerHTML = `
  <article class="answer">
    <div id="top">${top(ex, ex.source === 'on_device' || ex.checked ? '' : 'A larger model is double-checking the reading…')}</div>
    ${ex.source === 'on_device' ? `<p class="hint" style="margin-top:24px">You can ask follow-up questions once you're back online.</p>` : `<h2 style="margin-top:28px">Ask about this letter</h2>
    <form class="ask" id="ask"><input id="q" placeholder="Can I pay in installments?" autocomplete="off"><button>Ask</button></form>
    <div id="qa"></div>`}
  </article>`;
  const wire = () => { $('#home').onclick = () => home(); };
  wire(); point(ex); keep(ex);
  if (ex.source === 'on_device') return;
  if (!ex.checked) {
    explain(letter, state.language, { check: true })
      .then((checked) => { $('#top').innerHTML = top(checked); wire(); point(checked); keep(checked); })
      .catch(() => { $('#top').innerHTML = top(ex); wire(); });
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
