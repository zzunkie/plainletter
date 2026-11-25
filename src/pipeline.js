// Two models, two jobs.
// On device (Gemini Nano in Chrome): read the photo and find what identifies the person.
// In the cloud (Gemini): explain the masked text. The photo and the identifiers never go there.
import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { ai } from './firebase.js';
import { redact, restore, maskWithVault, normalize, aliasUnused, typedNames, tidyTokens } from './redact.js';
import { strips, stripCount } from './pages.js';

// The larger model double-checks the fast explanation and answers follow-up questions.
export const CHECK_MODEL = 'gemini-4-hydrogen';
export const CHAT_MODEL = CHECK_MODEL;
export const CLOUD_MODEL = new URLSearchParams(location.search).get('model') || 'gemini-3.5-flash-lite';

const TRANSCRIBE = 'Transcribe every line of text in this photo of a letter exactly as written, in the original language. Do not translate, summarize, or correct anything. Output only the transcription, one line per line.';
const FIND_IDS = 'Below is the text of an official letter. List every piece of information that identifies the private person it is addressed to: personal names (every spelling), ID or registration numbers, reference/case/account numbers, bank account numbers, street addresses, dates of birth, personal phone numbers, vehicle registration plates. Also list, with kind AGENCY_CONTACT, the phone numbers of the office that sent the letter: helplines, inquiry lines, and numbers printed after labels such as Contact, Tel, Telefon, 문의, 전화, お問い合わせ, or 電話. Copy each value character for character from the text. Do not list amounts of money, payment deadlines, or the name of the sending agency.\n\nTEXT:\n';
const IDS_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['NAME', 'ID_NUMBER', 'REFERENCE_NUMBER', 'ACCOUNT', 'ADDRESS', 'BIRTH_DATE', 'PHONE', 'VEHICLE_PLATE', 'AGENCY_CONTACT'] }, value: { type: 'string' } }, required: ['kind', 'value'] } } }, required: ['items'] };

export async function deviceStatus() {
  if (!('LanguageModel' in self)) return 'unavailable';
  // Some Chromium-based browsers expose the API but never answer, so give up after a few seconds.
  const late = new Promise((resolve) => setTimeout(() => resolve('unavailable'), 5000));
  try { return await Promise.race([self.LanguageModel.availability(IMAGE_INPUT), late]); } catch { return 'unavailable'; }
}

const IMAGE_INPUT = { expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }] };
const onDevice = ({ image = false, promptOptions } = {}) => getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: image ? IMAGE_INPUT : undefined, promptOptions },
});

// Holds one session open so the model stays in memory while the person chooses a photo.
let warm;
export const warmUp = () => { warm ??= self.LanguageModel?.create(IMAGE_INPUT).catch(() => {}); return warm; };

export const downloadDeviceModel = (onProgress) => onDevice({ image: true }).initializeDeviceModel(onProgress);

// A call to the on-device model that has not answered in time is abandoned.
const within = (promise, seconds) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('The on-device model did not answer in time')), seconds * 1000))]);

// Asked twice if the first answer is late or is not valid JSON. A letter whose details
// cannot be listed is not sent anywhere: the error stops the reading.
async function findIds(readText, text) {
  for (let attempt = 0; ; attempt += 1) {
    try { return JSON.parse(await within(readText(FIND_IDS + text, IDS_SCHEMA), 90)).items || []; } catch (e) { if (attempt) throw e; }
  }
}

const TOKEN = /\[[A-Z_]+_\d+\]/;
const bigrams = (l) => { const t = l.replace(/\s/g, ''); return new Set([...t].slice(0, -1).map((c, i) => c + t[i + 1])); };
const overlap = (x, y) => { const A = bigrams(x), B = bigrams(y); let n = 0; A.forEach((g) => { if (B.has(g)) n += 1; }); return n / Math.max(1, Math.min(A.size, B.size)); };

// Lines of the second reading worth sending: the wording differs from the first reading,
// and the matching first-reading line holds no placeholder. A line that carries a personal
// detail goes out once, masked, and never in a second spelling.
export function differingLines(firstMasked, secondMasked) {
  const shape = (l) => l.replace(new RegExp(TOKEN, 'g'), '[]').replace(/[\s~〜～().,:;·\-]/g, '');
  const A = firstMasked.split('\n').filter((l) => l.trim());
  const B = secondMasked.split('\n').filter((l) => l.trim());
  const seen = new Set(A.map(shape));
  return B.filter((line, i) => {
    if (seen.has(shape(line))) return false;
    const twin = A.length === B.length ? A[i] : A.reduce((best, l) => (overlap(l, line) > overlap(best, line) ? l : best), A[0] || '');
    return !TOKEN.test(twin);
  });
}

// Reads one slice of a page on the device. Used after the answer to find where a value is printed.
export const readSlice = async (base64) => normalize((await within(onDevice({ image: true }).generateContent([TRANSCRIBE, { inlineData: { mimeType: 'image/jpeg', data: base64 } }]), 60)).response.text());

// Strips of one page overlap, so the same line can come back twice. A line at the top of a strip
// is dropped when the strip above already ended with it: same digits, nearly the same letters.
const digitsOf = (l) => l.replace(/\D/g, '');
const sameLine = (x, y) => digitsOf(x) === digitsOf(y) && overlap(x, y) >= 0.6;
function joinStrips(texts) {
  const lines = [], perStrip = [];
  for (const text of texts) {
    const own = normalize(text).split('\n').filter((l) => l.trim());
    const tail = lines.slice(-6);
    let start = 0;
    while (start < own.length && start < 6 && tail.some((l) => sameLine(l, own[start]))) start += 1;
    perStrip.push(own); lines.push(...own.slice(start));
  }
  return { text: lines.join('\n'), perStrip };
}

// Reads every page twice and masks both readings with one shared vault.
// pages: [{ base64, url, width, height }]. where: 'device' keeps the pages on this machine;
// 'cloud' is the fallback the user agreed to.
export async function readLetter(pages, where, onStep = () => {}) {
  const inline = (data) => ({ inlineData: { mimeType: 'image/jpeg', data } });
  const cloud = getGenerativeModel(ai, { model: CLOUD_MODEL });
  const readImage = async (data) => (where === 'device'
    ? (await onDevice({ image: true }).generateContent([TRANSCRIBE, inline(data)])).response.text()
    : (await cloud.generateContent([TRANSCRIBE, inline(data)])).response.text());
  const readText = async (prompt, schema) => (where === 'device'
    ? (await onDevice({ promptOptions: { responseConstraint: schema } }).generateContent(prompt)).response.text()
    : (await getGenerativeModel(ai, { model: CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json' } }).generateContent(prompt + '\n\nReply as JSON: {"items":[{"kind":"NAME|ID_NUMBER|REFERENCE_NUMBER|ACCOUNT|ADDRESS|BIRTH_DATE|PHONE|VEHICLE_PLATE|AGENCY_CONTACT","value":"..."}]}')).response.text());
  const of = (i) => (pages.length > 1 ? ` (page ${i + 1} of ${pages.length})` : '');

  // The second reading cuts each page at different heights, so a line that fell on a cut
  // the first time is read whole the second time.
  const readPages = async (step, fewer) => {
    const texts = [], regions = [];
    for (const [i, page] of pages.entries()) {
      const parts = where === 'device' ? await strips(page, Math.max(1, stripCount(page) - fewer)) : [{ base64: page.base64, y0: 0, y1: 1 }];
      const read = [];
      for (const [k, part] of parts.entries()) {
        onStep(step, `${of(i)}${parts.length > 1 ? `, part ${k + 1} of ${parts.length}` : ''}`);
        read.push(await within(readImage(part.base64), 90).catch(() => within(readImage(part.base64), 90)));
      }
      const joined = joinStrips(read);
      texts.push(joined.text);
      parts.forEach((part, k) => regions.push({ page: i, y0: part.y0, y1: part.y1, lines: joined.perStrip[k] }));
    }
    return { texts, regions };
  };

  const t = [performance.now()]; const lap = () => t.push(performance.now());
  const first = await readPages('Reading the letter', 0); lap();
  const second = await readPages('Re-reading to catch misread characters', 1); lap();
  onStep('Finding and masking personal details', '');
  const items = [];
  for (const text of [...first.texts, ...second.texts]) items.push(...await findIds(readText, text));
  lap();
  const vault = [];
  const a = redact(first.texts.join('\n'), items, vault);
  const b = redact(second.texts.join('\n'), items, vault);
  console.info('readLetter seconds', t.slice(1).map((x, i) => ((x - t[i]) / 1000).toFixed(1)).join(' / '));
  const alternates = differingLines(a.outgoing, b.outgoing);
  aliasUnused(vault, `${a.outgoing}\n${alternates.join('\n')}`);
  const tidy = tidyTokens([a.outgoing, ...alternates], vault, items);
  // One placeholder can hold several spellings of a value. The one both readings agree on comes
  // first, because that is the spelling put back into answers and replies; for a name, the Latin
  // spelling printed beside it is read more reliably than a native-script one.
  const agreed = (v) => +normalize(first.texts.join('\n')).includes(v.value) + +normalize(second.texts.join('\n')).includes(v.value) + (v.token.startsWith('[NAME_') && /^[\p{Script=Latin} .,'\-]+$/u.test(v.value) ? 10 : 0);
  vault.sort((x, y) => agreed(y) - agreed(x));
  a.outgoing = tidy[0]; alternates.splice(0, alternates.length, ...tidy.slice(1));
  // regions: where on each page a line was read. They hold unmasked text and stay on the device.
  return { transcript: normalize(first.texts.join('\n')), second: normalize(second.texts.join('\n')), items, outgoing: a.outgoing, alternates, vault, regions: first.regions };
}

// One schema for both models: the cloud takes it as responseSchema, the on-device model as responseConstraint.
const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What this letter is, in eight words or fewer, for example "Overdue health insurance bill"' },
    sender: { type: 'string', description: 'Who sent the letter, translated, with the original name in parentheses' },
    what_it_is: { type: 'string', description: 'One or two plain sentences: what this letter is and why the person received it' },
    steps: { type: 'array', items: { type: 'string' }, description: 'What the person has to do, in order. Each step names the exact amount, date, account token or phone number it involves. Include only what the letter itself asks for; do not add a payment method the letter does not state' },
    amount: { type: 'string', description: 'Amount to pay exactly as printed, or empty string. When the letter sets out installments, or a lower amount for paying early, give the next amount the person has to pay; the yearly total or the later, higher amount belongs in other_figures' },
    amount_printed_as: { type: 'string', description: 'The line of the letter containing the amount, in the original language with misread characters corrected, or empty string' },
    deadline: { type: 'string', description: 'Deadline written out the way the reader writes dates, for example "December 14, 2026" for English, or empty string. With installments, the date of the next one' },
    deadline_printed_as: { type: 'string', description: 'The line of the letter containing the deadline, in the original language with misread characters corrected, or empty string' },
    deadline_iso: { type: 'string', description: 'Deadline as YYYY-MM-DD, or empty string' },
    if_ignored: { type: 'string', description: 'What happens if the person does nothing, as stated in the letter' },
    objection: { type: 'string', description: 'How the person can object, appeal or ask for a review, and by when, as stated in the letter, or empty string' },
    other_figures: { type: 'array', items: { type: 'string' }, description: 'Other amounts and dates in the letter the person should not confuse with the amount to pay and the deadline, for example a higher amount after the deadline or the date the letter was issued. One short sentence each, at most four. Empty if none' },
    contact: { type: 'string', description: 'Every phone number or office the letter gives for questions, as printed, with what each is for, or empty string' },
    corrected: { type: 'array', items: { type: 'string' }, description: 'Words in the readings that were misread and that you corrected from context. List every word where your explanation relies on a different reading than the transcription, including words that are wrong in both readings. One entry each, in the reader language, in the form: read as "<what the reading says>", understood as "<what the letter says>" (<meaning>). Empty if none' },
    unclear: { type: 'array', items: { type: 'string' }, description: 'Only if the two readings disagree about an amount, a date or what the person must do: one short sentence each. Never mention tokens, names, addresses or spacing. Empty if none' },
  },
  required: ['title', 'sender', 'what_it_is', 'steps', 'amount', 'amount_printed_as', 'deadline', 'deadline_printed_as', 'deadline_iso', 'if_ignored', 'objection', 'other_figures', 'contact', 'corrected', 'unclear'],
};

const explainPrompt = (letter, language) => `You explain official letters to people who cannot read the language they are written in.

The text below was copied from a photo by a small on-device model, so it can contain misread characters. Where a line was read two ways, both readings are given; use context and your knowledge of this kind of letter to decide what it says. The same word can be misread in both readings: if a phrase makes no sense for this kind of letter, read it as the closest phrase that does. Personal details were replaced with tokens such as [NAME_1] or [ID_NUMBER_1] before the text left the person's device. Keep every token exactly as written and never guess what is behind one.

The reader is usually someone living in a country whose language they cannot read, so consequences often concern residence status, benefits, or enforcement such as late fees and seizure.

Write for the reader in ${language}. Use plain words. Copy amounts and dates exactly as printed. When a step involves an account, a reference number or a phone number, include its token in the step; the person's device puts the real value back.

LETTER (first reading):
${letter.outgoing}
${letter.alternates.length ? `\nLINES READ DIFFERENTLY ON THE SECOND PASS:\n${letter.alternates.join('\n')}` : ''}`;

// The on-device model often copies a bare number ("777,00") and a numeric date. The amount gets
// the currency printed next to it in the letter, and a numeric deadline is written out for the reader.
const LOCALES = { English: 'en-US', Korean: 'ko-KR', Japanese: 'ja-JP', German: 'de-DE', French: 'fr-FR', Spanish: 'es-ES', Vietnamese: 'vi-VN', Chinese: 'zh-CN', Portuguese: 'pt-BR', Russian: 'ru-RU', Arabic: 'ar', Hindi: 'hi-IN', Indonesian: 'id-ID', Thai: 'th-TH', Turkish: 'tr-TR', Polish: 'pl-PL', Ukrainian: 'uk-UA', Tagalog: 'fil-PH', Nepali: 'ne-NP' };
const CURRENCY = '€|EUR|원|円|USD|GBP|CHF|CAD|AUD|MXN|zł|kr|[$£¥₩]';
function tidyFigures(json, letter, language) {
  const out = { ...json };
  const bare = String(out.amount || '').trim();
  if (/^\d[\d.,' ]*$/.test(bare)) {
    // The model may swap the decimal mark (777.00 for 777,00), so either mark matches.
    const n = bare.replace(/[.,]/g, '[.,]').replace(/ /g, '\\s?');
    const m = new RegExp(`(?:${CURRENCY})\\s?${n}(?![\\d.,])|(?<![\\d.,])${n}\\s?(?:${CURRENCY})`).exec(`${out.amount_printed_as || ''}\n${letter.outgoing}`);
    if (m) out.amount = m[0];
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(out.deadline_iso || '');
  if (iso && !/\p{L}/u.test(out.deadline || '')) {
    const locale = Object.entries(LOCALES).find(([name]) => language.startsWith(name))?.[1] || 'en-US';
    out.deadline = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])));
  }
  return out;
}

// Online this runs in the cloud. Offline the same call falls back to the on-device model.
// With check: true the larger cloud model reads the same masked text again, slower and more carefully.
// onDeviceOnly: the on-device model explains even when a connection is available (used to compare the two).
export async function explain(letter, language, { check = false, onDeviceOnly = false } = {}) {
  const model = getGenerativeModel(ai, {
    mode: onDeviceOnly ? InferenceMode.ONLY_ON_DEVICE : check ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.PREFER_IN_CLOUD,
    inCloudParams: { model: check ? CHECK_MODEL : CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: EXPLAIN_SCHEMA, ...(check ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } },
    onDeviceParams: { promptOptions: { responseConstraint: EXPLAIN_SCHEMA } },
  }, { timeout: check ? 45000 : 30000 });
  const result = await model.generateContent(explainPrompt(letter, language));
  const raw = result.response.text();
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const back = (v) => (typeof v === 'string' ? restore(v, letter.vault) : Array.isArray(v) ? v.map(back) : v);
  return { source: result.response.inferenceSource || 'in_cloud', checked: check, ...Object.fromEntries(Object.entries(tidyFigures(json, letter, language)).map(([k, v]) => [k, back(v)])) };
}

// A reply to the office, written in the cloud from the masked letter. The model addresses and
// signs it with placeholders; the device puts the person's name, address and reference numbers in.
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    letter: { type: 'string', description: 'The complete reply in the language of the official letter, ready to send: sender block, date, recipient office, subject line with the reference token, body, closing, signature. Use the tokens for the person\'s name, address and numbers exactly as written' },
    translation: { type: 'string', description: 'The same reply translated for the reader, so they know what they are sending' },
    send_to: { type: 'string', description: 'Where the letter says to send replies (postal address, portal or e-mail of the office), as printed, or empty string' },
  },
  required: ['letter', 'translation', 'send_to'],
};
export const REPLY_KINDS = { installments: 'ask to pay in installments', objection: 'object to this decision or notice', extension: 'ask for more time to pay or to respond' };
// reason: what the person typed about their own situation; it is masked like a follow-up question.
export async function draftReply(letter, language, explanation, kind, reason = '') {
  const said = reason.trim() ? maskWithVault(reason, letter.vault) : '';
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CHECK_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: REPLY_SCHEMA, thinkingConfig: { thinkingLevel: 'low' } } },
  }, { timeout: 45000 });
  const prompt = `Below is an official letter. Personal details were replaced with tokens such as [NAME_1] before the text left the person's device. Write a short, polite, formal reply from the person to the office that sent it, to ${REPLY_KINDS[kind]}. Write it in the language of the official letter and follow that country's conventions for such a letter. Refer to the amounts, dates and legal basis the letter itself gives. Keep every token exactly as written and use them for the sender block, the reference line and the signature; never guess what is behind one. The text was copied from a photo by a small on-device model and can contain misread characters; write the words the letter means, not the misreadings. Put each part of the reply on its own line, with blank lines between paragraphs. ${said ? `The person describes their situation below, in their own words and language; put it into the reply in the letter's language, in the register such a letter uses, and state no other personal circumstances.` : `State no personal circumstances the letter does not mention: where the person has to add a reason, leave one line in square brackets saying what to fill in, in ${language}.`} Today's date is ${new Date().toLocaleDateString('en-CA')}. The translation is in ${language}.

WHAT THE LETTER IS: ${maskWithVault(`${explanation.what_it_is} ${explanation.objection || ''}`, letter.vault)}${said ? `\n\nTHE PERSON'S SITUATION: ${said}` : ''}

LETTER:
${letter.outgoing}`;
  const raw = (await model.generateContent(prompt)).response.text();
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  return { sent: prompt, said, letter: restore(json.letter, letter.vault), translation: restore(json.translation, letter.vault), sendTo: restore(json.send_to || '', letter.vault) };
}

// Follow-up questions go to the cloud as a chat. The question is masked with the same vault.
export function startFollowUp(letter, language, explanation) {
  const open = (model) => getGenerativeModel(ai, {
    model,
    // The larger model may look up the agency's published guidance. It searches with the masked text.
    ...(model === CHAT_MODEL ? { tools: [{ googleSearch: {} }], generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } } : {}),
    systemInstruction: `You answer follow-up questions about one official letter, in ${language}, in a few plain sentences. Tokens like [NAME_1] stand for personal details that stayed on the person's device; keep them as written. Answer in up to two short paragraphs. Begin the first with "From the letter:" and say what the letter itself states about the question. If the letter does not settle it, add a second paragraph that begins with "Usual practice:" and explains how this agency and this kind of notice normally work in that country, based on the agency's or the government's own pages when you can find them. Give a specific figure or condition only when a source states it.`,
  }).startChat({ history: [
    { role: 'user', parts: [{ text: `The letter:\n${letter.outgoing}` }] },
    { role: 'model', parts: [{ text: maskWithVault(`${explanation.what_it_is} ${explanation.if_ignored}`, letter.vault) }] },
  ] });
  let chat = open(CHAT_MODEL);
  let onFallback = false;
  const send = async (sent, onText, typed) => {
    const vault = [...typed, ...letter.vault];
    const reply = await chat.sendMessageStream(sent);
    let masked = '';
    for await (const chunk of reply.stream) { masked += chunk.text(); onText({ sent, typed, answer: restore(masked, vault) }); }
    const grounding = (await reply.response).candidates?.[0]?.groundingMetadata;
    const seen = new Set();
    // Government and agency sites are listed first.
    const official = (t) => (/(\.go\.[a-z]{2}|\.gov(\.[a-z]{2})?|\.or\.kr|\.gouv\.fr|\.bund\.de|\.admin\.ch|\.gv\.at|europa\.eu)$/.test(t || '') ? 0 : 1);
    const sources = (grounding?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri && !seen.has(w.title) && seen.add(w.title)).map((w) => ({ title: w.title || w.uri, uri: w.uri })).sort((a, b) => official(a.title) - official(b.title)).slice(0, 4)
      // When an official site is among the sources, personal blogs are left out of the list.
      .filter((w, i, all) => official(all[0].title) !== 0 || !/tistory|blog|medium\.com|brunch|wordpress|velog/i.test(w.title + w.uri));
    return { sent, typed, answer: restore(masked, vault), sources, searchWidget: grounding?.searchEntryPoint?.renderedContent || '' };
  };
  return async (question, onText = () => {}) => {
    const sent = maskWithVault(question, letter.vault);
    const typed = typedNames(normalize(question), letter.vault);
    onText({ sent, answer: '' });
    try { return await send(sent, onText, typed); } catch (e) {
      // If the larger model fails, the faster model answers.
      if (onFallback) throw e;
      onFallback = true; chat = open(CLOUD_MODEL);
      return send(sent, onText, typed);
    }
  };
}
