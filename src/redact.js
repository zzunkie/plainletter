// Decides what leaves the device. The on-device model proposes identifiers;
// these rules have the final say on what is masked and what must stay readable.

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_PATTERNS = [
  /\d{4}\s?년\s?\d{1,2}\s?월\s?\d{1,2}\s?일/g,
  /(?:令和|平成)\s?\d{1,2}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/g,
  /\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/g,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  new RegExp(`\\b\\d{1,2} (?:${MONTHS}) \\d{4}\\b`, 'g'),
  new RegExp(`\\b(?:${MONTHS}) \\d{1,2}, \\d{4}\\b`, 'g'),
];
// Billing periods ("2026년 9월", "令和8年7月", "08.2026") are not identifiers either.
const PERIOD_PATTERNS = [/\d{4}\s?년\s?\d{1,2}\s?월/g, /(?:令和|平成)\s?\d{1,2}\s?年(?:\s?\d{1,2}\s?月)?/g, /\d{4}\s?年\s?\d{1,2}\s?月/g, /\b\d{1,2}\.\d{4}\b/g, /\b\d{4}\/\d{2}\b/g, new RegExp(`\\b(?:${MONTHS}) \\d{4}\\b`, 'g')];
const AMOUNT_PATTERNS = [/\d[\d.,]*\s?(?:원|円|EUR|€|USD|GBP)/g, /[£$€]\s?\d[\d.,]*/g];

// True when nothing is left after removing dates, periods, amounts and the words that join them.
const isDateOrAmount = (value) => {
  let rest = value;
  [...DATE_PATTERNS, ...PERIOD_PATTERNS, ...AMOUNT_PATTERNS].forEach((p) => { rest = rest.replace(p, ''); });
  return rest.replace(/[\s~〜～\-–,.()]|bis|to|until|부터|까지|분|から|まで|分/g, '') === '';
};

export const normalize = (text) => text.normalize('NFKC').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

// items: [{ kind, value }] proposed by the on-device model, values copied from the text.
export function redact(rawText, items, vault = []) {
  const text = normalize(rawText);
  // vault: [{ token, value }] stays on the device; pass it again to keep tokens stable across texts
  const tokenFor = (kind, value) => {
    const hit = vault.find((v) => v.value === value);
    if (hit) return hit.token;
    const n = vault.filter((v) => v.token.startsWith(`[${kind}_`)).length + 1;
    const token = `[${kind}_${n}]`;
    vault.push({ token, value });
    return token;
  };

  // Deadlines and amounts are what the reader needs explained, so they are never masked,
  // even when the model lists them. A birth date is the exception.
  const protectedSpans = [];
  const protect = (patterns) => patterns.forEach((p) => { for (const m of text.matchAll(p)) protectedSpans.push([m.index, m.index + m[0].length]); });
  protect(DATE_PATTERNS); protect(AMOUNT_PATTERNS);
  const overlapsProtected = (s, e) => protectedSpans.some(([a, b]) => s < b && e > a);

  const accepted = items
    .map((it) => ({ kind: it.kind, value: normalize(it.value || '') }))
    .filter((it) => it.kind !== 'AGENCY_CONTACT' && it.value.length > 1 && text.includes(it.value))
    .filter((it) => it.kind === 'BIRTH_DATE' || it.kind === 'HIDDEN' || !isDateOrAmount(it.value))
    .sort((a, b) => b.value.length - a.value.length);

  // The office's own phone numbers are how the reader gets help, so they stay readable.
  // Only short, phone-shaped values qualify, whatever the model says.
  const keep = items
    .filter((it) => it.kind === 'AGENCY_CONTACT')
    .map((it) => normalize(it.value || ''))
    .filter((v) => /^[\d\-() +]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 12)
    .filter((v) => !accepted.some((a) => a.kind !== 'PHONE' && a.value.includes(v)));
  // A number the model called both a personal phone and the agency's line is treated as the agency's.
  for (let i = accepted.length - 1; i >= 0; i -= 1) if (accepted[i].kind === 'PHONE' && keep.includes(accepted[i].value)) accepted.splice(i, 1);

  let out = text;
  for (const it of accepted) out = out.split(it.value).join(tokenFor(it.kind, it.value));

  // A name is often printed twice: native script and Latin letters in parentheses.
  // Both spellings go under one placeholder so the cloud model sees one person.
  out = out.split('\n').map((line) => line.replace(/(\[NAME_\d+\])\s*\(([^()]*)\)/gu, (m, token, inner) => {
    const other = vault.find((v) => v.token === inner.trim());
    if (other) { other.token = token; return token; }
    if (!/\p{L}/u.test(inner) || /\[[A-Z_]+_\d+\]/.test(inner)) return m;
    vault.push({ token, value: inner.trim() });
    return token;
  })).join('\n');

  // Number-shaped identifiers the model missed. Dates and amounts are skipped.
  const spansNow = [];
  [...DATE_PATTERNS, ...AMOUNT_PATTERNS].forEach((p) => { for (const m of out.matchAll(p)) spansNow.push([m.index, m.index + m[0].length]); });
  keep.forEach((v) => { for (let i = out.indexOf(v); i !== -1; i = out.indexOf(v, i + 1)) spansNow.push([i, i + v.length]); });
  const safe = (i, len) => !spansNow.some(([a, b]) => i < b && i + len > a);
  out = out.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, (m, i) => (safe(i, m.length) ? tokenFor('ACCOUNT', m) : m));
  out = out.replace(/\d[\d\-\/ ]{5,}\d/g, (m, i) => (safe(i, m.length) && m.replace(/\D/g, '').length >= 7 ? tokenFor('NUMBER', m) : m));

  return { outgoing: out, vault };
}

// Puts the real values back into a cloud answer, on the device.
export const restore = (answer, vault) => vault.reduce((t, v) => t.split(v.token).join(v.value), answer);

// Masks text the user types (follow-up questions) with what the vault already knows.
// People rarely retype a name the way the letter prints it, so each word of a masked name
// is matched on its own, in any letter case.
export function maskWithVault(text, vault) {
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameWords = vault.filter((v) => v.token.startsWith('[NAME_'))
    .flatMap((v) => v.value.split(/[\s(),]+/).filter((w) => w.length >= 3).map((w) => ({ token: v.token, value: w, word: true })));
  const known = [...vault, ...nameWords].sort((a, b) => b.value.length - a.value.length);
  let out = normalize(text);
  for (const k of known) {
    const latin = /^[\p{Script=Latin}'-]+$/u.test(k.value);
    out = out.replace(new RegExp(k.word && latin ? `\\b${escape(k.value)}\\b` : escape(k.value), 'giu'), k.token);
  }
  // Two words of one name leave the same placeholder twice in a row.
  out = out.replace(/(\[NAME_\d+\])(?:\s+\1)+/g, '$1');
  return redact(out, [], vault).outgoing;
}

// A spelling the model listed on its own (for example the Latin form of a name) may never get
// its own placeholder because a longer value covered it. Point it at that placeholder, so a
// follow-up question that uses the short spelling is masked with a token the cloud has seen.
export function aliasUnused(vault, sentText) {
  for (const v of vault) {
    if (sentText.includes(v.token)) continue;
    const host = vault.find((o) => o !== v && sentText.includes(o.token) && o.value.includes(v.value));
    if (host) v.token = host.token;
  }
}

// How the person spelled each masked name in their own question. An answer to that question
// shows the name the same way, which reads better than the letter's full printed form.
export function typedNames(text, vault) {
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typed = [];
  for (const token of new Set(vault.filter((v) => v.token.startsWith('[NAME_')).map((v) => v.token))) {
    const words = vault.filter((v) => v.token === token).flatMap((v) => v.value.split(/[\s(),]+/).filter((w) => w.length >= 3));
    const hits = words.map((w) => new RegExp(escape(w), 'iu').exec(text)).filter(Boolean).sort((a, b) => a.index - b.index);
    if (!hits.length) continue;
    const last = hits[hits.length - 1];
    const span = text.slice(hits[0].index, last.index + last[0].length);
    typed.push({ token, value: span.length <= hits.reduce((n, h) => n + h[0].length + 2, 0) ? span : hits[0][0] });
  }
  return typed;
}
