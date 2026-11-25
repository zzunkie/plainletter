// Decides what leaves the device. The on-device model proposes identifiers;
// these rules have the final say on what is masked and what must stay readable.

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
  + '|Januar|Jänner|Februar|März|Mai|Juni|Juli|Oktober|Dezember'
  + '|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre'
  + '|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
const DATE_PATTERNS = [
  /\d{4}\s?년\s?\d{1,2}\s?월\s?\d{1,2}\s?일/g,
  /(?:令和|平成)\s?\d{1,2}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/g,
  /\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日/g,
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  new RegExp(`\\b\\d{1,2}(?:\\.|er)? (?:de )?(?:${MONTHS}) (?:de )?\\d{4}\\b`, 'gi'),
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

// Words that mark a line as the office's contact line, in the languages the test set covers.
const INQUIRY = /문의|상담|お問合|contact us|contact citoyen|TTY|問い?合わ?せ|照会|Auskunft|Rückfragen|Fragen|Servicetelefon|Hotline|Helpline|enquir|inquir|questions?\b|call us|contact us|customer service|renseignement|accueil|Atención|consultas|información/i;
const grams = (t) => { const f = t.replace(/\s/g, ''); return new Set([...f].slice(0, -1).map((c, i) => c + f[i + 1])); };
const shared = (want, have) => { let n = 0; want.forEach((g) => { if (have.has(g)) n += 1; }); return n / Math.max(1, want.size); };

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

  // A name listed as "native spelling (Latin spelling)" is two values.
  const listed = items.flatMap((it) => {
    const m = it.kind === 'NAME' && /^(.+?)\s*\(([^()]+)\)\s*$/.exec(normalize(it.value || ''));
    return m ? [{ kind: 'NAME', value: m[1] }, { kind: 'NAME', value: m[2] }] : [it];
    // Forms of address are not part of the name.
  }).map((it) => (it.kind === 'NAME' ? { kind: 'NAME', value: normalize(it.value || '').replace(/\s*(様|殿|さん|님|귀하)$/, '') } : it));
  // The model copies a name or an address from one reading; the other reading, or another strip
  // of the same page, may spell it a little differently. Those near-copies are masked as well.
  const near = listed.filter((it) => ['NAME', 'ADDRESS'].includes(it.kind)).flatMap((it) => {
    const value = normalize(it.value || ''); const want = grams(value); const n = value.split(' ').length;
    if (want.size < 3) return [];
    return text.split('\n').flatMap((line) => {
      const words = line.split(' ');
      return words.flatMap((_, i) => [words.slice(i, i + n).join(' '), words.slice(i, i + n + 1).join(' ')]).filter((span) => span !== value && Math.abs(span.length - value.length) <= 3 && !/\d{4}/.test(span) === !/\d{4}/.test(value) && shared(want, grams(span)) * want.size / Math.max(want.size, grams(span).size) >= (it.kind === 'NAME' ? 0.5 : 0.6))
        .map((span) => ({ kind: it.kind, value: span.replace(/^[(\[]+|[)\],.:;]+$/g, '') }));
    });
  });

  const accepted = [...listed, ...near]
    // A number is listed without the note printed after it, such as "(account holder: the agency)".
    .map((it) => ({ kind: it.kind, value: normalize(it.value || '').replace(['NAME', 'ADDRESS', 'HIDDEN'].includes(it.kind) ? /$^/ : /\s*\([^()]*\)\s*$/, '') }))
    .filter((it) => it.kind !== 'AGENCY_CONTACT' && it.value.length > 1 && text.includes(it.value))
    .filter((it) => it.kind === 'BIRTH_DATE' || it.kind === 'HIDDEN' || !isDateOrAmount(it.value))
    .sort((a, b) => b.value.length - a.value.length);

  // The office's own phone numbers are how the reader gets help, so they stay readable.
  // They are the phone-shaped parts of what the model called an agency contact, plus numbers
  // printed on a line that says it is for questions. Only short, phone-shaped values qualify.
  const PHONE_SHAPED = /\+?\(?\d[\d\-() .]{5,16}\d/g;
  const fromModel = items.filter((it) => it.kind === 'AGENCY_CONTACT').flatMap((it) => normalize(it.value || '').match(PHONE_SHAPED) || []);
  const fromLabels = text.split('\n').filter((line) => INQUIRY.test(line)).flatMap((line) => line.match(PHONE_SHAPED) || []);
  const keep = [...new Set([...fromModel, ...fromLabels].map((v) => v.trim()))]
    .filter((v) => /^[\d\-() +.]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 13 && text.includes(v))
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

  // A letter prints the same name in several forms: "WHITAKER, DANIEL JAMES" in a table,
  // "Dear Daniel James Whitaker" in the text. Each word of a listed name is masked wherever
  // it stands as a whole word, in any letter case, and neighbouring pieces become one placeholder.
  for (const it of listed.filter((x) => x.kind === 'NAME')) {
    const value = normalize(it.value || '');
    const words = value.split(/[\s,]+/).filter((w) => w.length >= 4 && /^[\p{Script=Latin}'\-]+$/u.test(w));
    if (words.length < 2) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\]])(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\[])`, 'giu');
    if (!pattern.test(out)) continue;
    const token = tokenFor('NAME', value);
    out = out.replace(pattern, token).replace(new RegExp(`${token.replace(/[\[\]]/g, '\\$&')}(?:,? (?:[\\p{L}'.\\-]{1,3} )?${token.replace(/[\[\]]/g, '\\$&')})+`, 'gu'), token);
  }

  // In a letter written in Korean or Japanese, capital Latin words in parentheses are the
  // romanized name of the person, whether or not the model listed it.
  out = out.split('\n').map((line) => (/[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(line)
    ? line.replace(/\(\s*([A-Z][A-Z'\-]+(?: [A-Z][A-Z'\-]+){1,3})\s*\)/g, (m, name) => `(${tokenFor('NAME', name)})`) : line)).join('\n');

  // A misread native spelling printed right before a masked Latin spelling, as in
  // "성명 마리아 골렌스 ([NAME_1])", belongs to the same person. The field label stays.
  out = out.replace(/((?:[\p{L}·]+ ){1,3})\((\[NAME_\d+\])\)/gu, (m, before, token) => {
    const words = before.trim().split(' ');
    const label = /^(성명|이름|수신인?|납세자|氏名|名前|Name|Nom|Nombre|Titular)$/i.test(words[0]) ? `${words.shift()} ` : '';
    if (!words.length) return m;
    vault.push({ token, value: words.join(' ') });
    return `${label}${token}`;
  });

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
