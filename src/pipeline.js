// Two models, two jobs.
// On device (Gemini Nano in Chrome): read the photo and find what identifies the person.
// In the cloud (Gemini): explain the masked text. The photo and the identifiers never go there.
import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { ai } from './firebase.js';
import { redact, restore, maskWithVault, normalize, aliasUnused, typedNames } from './redact.js';

// The larger model double-checks the fast explanation and answers follow-up questions.
export const CHECK_MODEL = 'gemini-4-hydrogen';
export const CHAT_MODEL = CHECK_MODEL;
export const CLOUD_MODEL = new URLSearchParams(location.search).get('model') || 'gemini-3.5-flash-lite';

const TRANSCRIBE = 'Transcribe every line of text in this photo of a letter exactly as written, in the original language. Do not translate, summarize, or correct anything. Output only the transcription, one line per line.';
const FIND_IDS = 'Below is the text of an official letter. List every piece of information that identifies the private person it is addressed to: personal names (every spelling), ID or registration numbers, reference/case/account numbers, bank account numbers, street addresses, dates of birth, personal phone numbers. Also list, with kind AGENCY_CONTACT, the phone numbers of the office that sent the letter: helplines, inquiry lines, and numbers printed after labels such as Contact, Tel, Telefon, 문의, 전화, お問い合わせ, or 電話. Copy each value character for character from the text. Do not list amounts of money, payment deadlines, or the name of the sending agency.\n\nTEXT:\n';
const IDS_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['NAME', 'ID_NUMBER', 'REFERENCE_NUMBER', 'ACCOUNT', 'ADDRESS', 'BIRTH_DATE', 'PHONE', 'AGENCY_CONTACT'] }, value: { type: 'string' } }, required: ['kind', 'value'] } } }, required: ['items'] };

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

async function findIds(readText, text) {
  try { return JSON.parse(await readText(FIND_IDS + text, IDS_SCHEMA)).items || []; } catch { return []; }
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

// Reads the photo twice and masks both readings with one shared vault.
// where: 'device' keeps the photo on this machine; 'cloud' is the fallback the user agreed to.
export async function readLetter(imageBase64, where, onStep = () => {}) {
  const image = { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } };
  const cloud = getGenerativeModel(ai, { model: CLOUD_MODEL });
  const readImage = async () => (where === 'device'
    ? (await onDevice({ image: true }).generateContent([TRANSCRIBE, image])).response.text()
    : (await cloud.generateContent([TRANSCRIBE, image])).response.text());
  const readText = async (prompt, schema) => (where === 'device'
    ? (await onDevice({ promptOptions: { responseConstraint: schema } }).generateContent(prompt)).response.text()
    : (await getGenerativeModel(ai, { model: CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json' } }).generateContent(prompt + '\n\nReply as JSON: {"items":[{"kind":"NAME|ID_NUMBER|REFERENCE_NUMBER|ACCOUNT|ADDRESS|BIRTH_DATE|PHONE|AGENCY_CONTACT","value":"..."}]}')).response.text());

  const t = [performance.now()]; const lap = () => t.push(performance.now());
  onStep('Reading the letter');
  const first = normalize(await readImage()); lap();
  onStep('Reading it a second time to catch misread characters');
  const second = normalize(await readImage()); lap();
  onStep('Finding and masking personal details');
  const [itemsFirst, itemsSecond] = [await findIds(readText, first), await findIds(readText, second)]; lap();
  const items = [...itemsFirst, ...itemsSecond];
  const vault = [];
  const a = redact(first, items, vault);
  const b = redact(second, items, vault);
  console.info('readLetter seconds', t.slice(1).map((x, i) => ((x - t[i]) / 1000).toFixed(1)).join(' / '));
  const alternates = differingLines(a.outgoing, b.outgoing);
  aliasUnused(vault, `${a.outgoing}\n${alternates.join('\n')}`);
  return { transcript: first, second, items, outgoing: a.outgoing, alternates, vault };
}

// One schema for both models: the cloud takes it as responseSchema, the on-device model as responseConstraint.
const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What this letter is, in eight words or fewer, for example "Overdue health insurance bill"' },
    sender: { type: 'string', description: 'Who sent the letter, translated, with the original name in parentheses' },
    what_it_is: { type: 'string', description: 'One or two plain sentences: what this letter is and why the person received it' },
    steps: { type: 'array', items: { type: 'string' }, description: 'What the person has to do, in order. Each step names the exact amount, date, account token or phone number it involves. Include only what the letter itself asks for; do not add a payment method the letter does not state' },
    amount: { type: 'string', description: 'Amount to pay exactly as printed, or empty string' },
    amount_printed_as: { type: 'string', description: 'The line of the letter containing the amount, in the original language, or empty string' },
    deadline: { type: 'string', description: 'Deadline written out the way the reader writes dates, for example "December 14, 2026" for English, or empty string' },
    deadline_printed_as: { type: 'string', description: 'The line of the letter containing the deadline, in the original language, or empty string' },
    deadline_iso: { type: 'string', description: 'Deadline as YYYY-MM-DD, or empty string' },
    if_ignored: { type: 'string', description: 'What happens if the person does nothing, as stated in the letter' },
    contact: { type: 'string', description: 'Every phone number or office the letter gives for questions, as printed, with what each is for, or empty string' },
    corrected: { type: 'array', items: { type: 'string' }, description: 'Words in the readings that were misread and that you corrected from context. List every word where your explanation relies on a different reading than the transcription, including words that are wrong in both readings. One entry each, in the reader language, in the form: read as "<what the reading says>", understood as "<what the letter says>" (<meaning>). Empty if none' },
    unclear: { type: 'array', items: { type: 'string' }, description: 'Only if the two readings disagree about an amount, a date or what the person must do: one short sentence each. Never mention tokens, names, addresses or spacing. Empty if none' },
  },
  required: ['title', 'sender', 'what_it_is', 'steps', 'amount', 'amount_printed_as', 'deadline', 'deadline_printed_as', 'deadline_iso', 'if_ignored', 'contact', 'corrected', 'unclear'],
};

const explainPrompt = (letter, language) => `You explain official letters to people who cannot read the language they are written in.

The text below was copied from a photo by a small on-device model, so it can contain misread characters. Where a line was read two ways, both readings are given; use context and your knowledge of this kind of letter to decide what it says. The same word can be misread in both readings: if a phrase makes no sense for this kind of letter, read it as the closest phrase that does. Personal details were replaced with tokens such as [NAME_1] or [ID_NUMBER_1] before the text left the person's device. Keep every token exactly as written and never guess what is behind one.

The reader is usually someone living in a country whose language they cannot read, so consequences often concern residence status, benefits, or enforcement such as late fees and seizure.

Write for the reader in ${language}. Use plain words. Copy amounts and dates exactly as printed. When a step involves an account, a reference number or a phone number, include its token in the step; the person's device puts the real value back.

LETTER (first reading):
${letter.outgoing}
${letter.alternates.length ? `\nLINES READ DIFFERENTLY ON THE SECOND PASS:\n${letter.alternates.join('\n')}` : ''}`;

// Online this runs in the cloud. Offline the same call falls back to the on-device model.
// With check: true the larger cloud model reads the same masked text again, slower and more carefully.
export async function explain(letter, language, { check = false } = {}) {
  const model = getGenerativeModel(ai, {
    mode: check ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.PREFER_IN_CLOUD,
    inCloudParams: { model: check ? CHECK_MODEL : CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: EXPLAIN_SCHEMA, ...(check ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } },
    onDeviceParams: { promptOptions: { responseConstraint: EXPLAIN_SCHEMA } },
  }, check ? { timeout: 45000 } : undefined);
  const result = await model.generateContent(explainPrompt(letter, language));
  const raw = result.response.text();
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const back = (v) => (typeof v === 'string' ? restore(v, letter.vault) : Array.isArray(v) ? v.map(back) : v);
  return { source: result.response.inferenceSource || 'in_cloud', checked: check, ...Object.fromEntries(Object.entries(json).map(([k, v]) => [k, back(v)])) };
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
    const sources = (grounding?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri && !seen.has(w.title) && seen.add(w.title)).map((w) => ({ title: w.title || w.uri, uri: w.uri })).sort((a, b) => official(a.title) - official(b.title));
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
