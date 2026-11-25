// Re-applies the current masking rules to the readings saved in a run, without calling any model.
// Usage: node eval/replay.mjs <run name>
import fs from 'node:fs';
import { redact } from '../src/redact.js';
const dir = new URL('.', import.meta.url).pathname;
const run = JSON.parse(fs.readFileSync(`${dir}out/runs/${process.argv[2]}.json`));
const truth = JSON.parse(fs.readFileSync(`${dir}notices.json`));
const flat = (s) => s.normalize('NFKC').replace(/\s+/g, '');
let sent = 0, ids = 0, kept = 0, contacts = 0, figs = 0, figsKept = 0;
for (const r of run.rows) {
  const n = truth.find((x) => x.id === r.id); const vault = [];
  const a = redact(r.transcript, r.items, vault); const b = redact(r.second, r.items, vault);
  const leaked = n.pii.filter((p) => flat(a.outgoing + b.outgoing).includes(flat(p)));
  const agency = n.agency_contacts.map((c) => flat(a.outgoing).includes(flat(c)));
  const fig = n.critical.filter((c) => flat(r.transcript).includes(flat(c)));
  sent += leaked.length; ids += n.pii.length; kept += agency.filter(Boolean).length; contacts += agency.length; figs += fig.length; figsKept += fig.filter((c) => flat(a.outgoing).includes(flat(c))).length;
  if (leaked.length || agency.includes(false)) console.log(r.id, leaked, n.agency_contacts.filter((_, i) => !agency[i]));
}
console.log(`identifiers sent ${sent} of ${ids}; agency numbers kept ${kept} of ${contacts}; figures kept ${figsKept} of ${figs}`);
