# Writing test documents

Each test document is a fictional official letter rendered from HTML, one file per page, plus one truth record.

## Page files
- `docs/<id>.html` for a one-page letter, `docs/<id>-p1.html` and `docs/<id>-p2.html` for a two-page letter.
- Start every file with: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="doc.css">` and put everything in one `<div class="sheet">` (add class `serif` for a serif look). The sheet is 1000 x 1414 px and clips overflow, so keep content inside it. See `docs/proto.html` and `docs/doc.css` for the available classes (head, sub, table, box, small, foot, seal, addr, r, n).
- No images, no scripts, no external resources, no inline font sizes below 17px.
- Look like the real form of that agency: letterhead, reference block, recipient block, at least one table with several amounts or dates, a payment or action box, numbered legal notes, footer with contact lines. Around 25 to 40 lines of text per page.
- Every letter has several dates and (when money is involved) several amounts, of which exactly one is the amount to pay and one is the deadline to act.

## Content rules
- The recipient is a fictional private person, usually a foreign resident. Vary names and origins. Invent all personal values (names, ID numbers, addresses, account and reference numbers, birth dates, phone numbers). No real private person.
- Agencies may be real public bodies. Do not name any real bank or company; write "virtual account" style lines without a bank name, or an IBAN starting with the country code and invented digits.
- Dates fall between 2026-11-20 and 2027-03-31.
- Write the letter entirely in its language, in the wording such letters really use.

## Truth record
One JSON array per language in `docs/<lang>.json`, one object per letter:

```json
{
  "id": "ko01",
  "lang": "Korean",
  "country": "South Korea",
  "type": "health insurance arrears",
  "pages": ["ko01.html"],
  "pii": ["마리아 곤잘레스", "Maria Gonzalez", "920314-6234567", "서울특별시 구로구 디지털로 123, 402호", "5 1120 4478 902", "2026-11-0048213", "562-01-998877"],
  "critical": ["286,370원", "2026년 11월 25일"],
  "amount_due": "286,370원",
  "deadline_iso": "2026-11-25",
  "agency_contacts": ["1577-1000", "033-811-2000"],
  "action": ["pay"],
  "consequence": ["seiz|attach|garnish", "(stay|residence|visa|sojourn)"]
}
```

- `pii`: every value that identifies the recipient, copied character for character from the page text (each must be a contiguous substring of one text node as printed). Include every spelling of the name, ID numbers, the street address, birth date, personal phone, and personal account, payer, case and reference numbers.
- `critical`: the amount to pay and the deadline exactly as printed (the deadline only, if no money is due).
- `amount_due`: as printed, or "" if nothing is to be paid.
- `deadline_iso`: the date by which the recipient must act.
- `agency_contacts`: the sending office's phone numbers as printed.
- `action`: case-insensitive regular expressions that a correct English description of what the recipient must do would match (all must match). Keep them lenient, with alternatives.
- `consequence`: the same for a correct English statement of what happens if the recipient does nothing, one expression per distinct consequence the letter states (at most two).
