# Plainletter

Plainletter explains foreign-language tax bills and government notices while keeping your personal details on your device. Using Firebase AI Logic hybrid inference, it runs Gemini Nano in Chrome to transcribe the photo and mask identifiers locally, then sends only the masked text to Gemini in the cloud.

Try it: https://plainletter-99bce.web.app (Chrome 139 or later on a desktop computer)

Built for #BuildHybridAI 2026.

## What it does

1. Choose photos or a PDF of a tax bill or a government notice, one page or several, take a photo with your computer's camera, or click a sample letter.
2. Gemini Nano transcribes every page twice, in horizontal strips, and lists the details that identify you.
3. The app replaces them with placeholders such as `[NAME_1]` and shows what stays on the device next to what goes to the cloud.
4. Gemini in the cloud explains the masked text in your language: the sender, required steps, the amount and deadline, what happens if you ignore it, how to object, and which other figures on the letter are easy to confuse. A larger model then rewrites the explanation from the masked text and any differing lines in the second reading, updates the answer in place, and lists any words Gemini Nano misread.
5. The browser puts the real values back into the answer and marks them, and after the answer Gemini Nano re-reads thin slices of the page so a band can mark where the amount and the deadline are printed. Follow-up questions are masked the same way and answered using Google Search, with source links under each reply.
6. Each letter is saved to "Your letters" in IndexedDB with its deadline and the days left, and reopens without a connection. You can also install Plainletter from Chrome as a web app.
7. "Write back to the office" drafts a reply in the letter's language (installments, objection, more time) from the masked text, and the browser fills in your details.
8. When offline, the explanation call automatically falls back to Gemini Nano on the device.

## Where Firebase AI Logic is used

All inference goes through `firebase/ai`. See [`src/pipeline.js`](src/pipeline.js).

| Task | Call | Mode |
|---|---|---|
| Transcribe every page twice, in strips | `InferenceMode.ONLY_ON_DEVICE` with `generateContent([prompt, image])` | on device only |
| Find identifying details as JSON | `InferenceMode.ONLY_ON_DEVICE` with `onDeviceParams.promptOptions.responseConstraint` | on device only |
| Explain the masked letter as JSON | `InferenceMode.PREFER_IN_CLOUD` (`gemini-3.5-flash-lite` `inCloudParams` and Gemini Nano `onDeviceParams` sharing one schema) | cloud, on device when offline |
| Double-check the explanation | `InferenceMode.ONLY_IN_CLOUD` on `gemini-4-hydrogen` with `thinkingConfig` and the same schema | cloud only |
| Draft a reply to the office | `InferenceMode.ONLY_IN_CLOUD` on `gemini-4-hydrogen` with `responseSchema`; placeholders are filled in on the device | cloud only |
| Follow-up questions | `getGenerativeModel()` on `gemini-4-hydrogen` with `tools: [{ googleSearch: {} }]`, `startChat()`, and `sendMessageStream()` | cloud only |

`src/firebase.js` initializes App Check (reCAPTCHA Enterprise) before any model call. `src/redact.js` builds the masked text and restores real values in the answer. `src/pages.js` turns photos and PDF pages into strips, and `src/box.js` is the letter box.

## Results on the test set

We created 84 fictional letters (108 pages) in Korean, German, Japanese, English, French, and Spanish with invented recipients, modeled on real notices and bills from 16 countries: tax assessments, insurance and pension arrears, immigration document requests, traffic fines, court payment orders, hospital bills, utility cutoff notices, benefit decisions, installment plans, refunds, and summonses. Each page includes tables, multiple amounts and dates, and numbered legal notes; 24 letters span two pages with a required fact only on page 2, and 18 require an action without a payment. Every page was rendered as a camera-style image with tilt, shear, blur, shadow, noise, and JPEG compression.

To evaluate without overfitting, we wrote the letters in four groups and changed prompts and rules only between groups: 18 tuning letters, 30 held-out letters untouched until the first full run, 18 letters written after that run, and 18 final letters written after the last change and run once. The first run on the 30 held-out letters left 8 of 183 personal identifiers in the text sent to the cloud (four vehicle plates, three names printed in a second format, and one five-digit customer number). We added vehicle plates to the on-device prompt and added a rule for names printed in multiple formats, leaving 1 of 119 identifiers on the next 18 letters. Two of those letters lost their deadline because the date rule did not yet recognize German and French month names. After we added those month names, the run on the 18 final letters left 0 of 119 identifiers and matched 17 of 18 deadlines.

| Check | 18 final letters (24 pages), run once | 18 letters after the first fix | 30 held-out letters, first run |
|---|---|---|---|
| Amounts and deadlines transcribed correctly by Gemini Nano | 29 of 30 | 30 of 30 | 58 of 58 |
| Personal identifiers masked by Gemini Nano alone | 113 of 119 | 102 of 119 | 156 of 183 |
| Personal identifiers remaining in text sent to the cloud, after `src/redact.js` | 0 of 119 | 1 of 119 | 8 of 183 |
| Deadline matches the letter (first answer → after double-check) | 17 of 18 → 17 of 18 | 14 of 18 → 16 of 18 | 30 of 30 → 30 of 30 |
| Amount due matches the letter (first → after double-check) | 16 of 18 → 18 of 18 | 18 of 18 → 18 of 18 | 29 of 30 → 30 of 30 |
| Required action stated correctly (first → after double-check) | 18 of 18 → 18 of 18 | 17 of 18 → 18 of 18 | 30 of 30 → 30 of 30 |
| Consequence of ignoring stated correctly (first → after double-check) | 16 of 18 → 17 of 18 | 17 of 18 → 18 of 18 | 28 of 30 → 29 of 30 |
| Same explanation from Gemini Nano alone, on the same masked text | deadline 15 of 18, amount 11 of 18, action 17 of 18, consequence 7 of 18 | not run | not run |

The last row shows why the explanation runs in the cloud. Gemini Nano reads and masks these pages well, yet from the same masked text it got the amount right on 11 of 18 letters and the consequence on 7, compared with 18 and 17 from the cloud models. Across all 84 letters, the cloud double-check also listed and corrected 204 misread words. When the device is offline, the app still returns the on-device explanation and says that it came from the on-device model.

We also tested 59 sample notices published by public agencies to explain their bills. These cover tax, fine, court, and utility notices from agencies in the US, Canada, the UK, New Zealand, Germany, Austria, Switzerland, France, Spain, Colombia, Japan, and South Korea, many of them low-resolution web images (`eval/real/sources.json` lists each source). We ran them in three batches and changed prompts and rules only between batches.

| Check | 14 confirmation samples, run once after the last change | Next 34 samples (first run → after the date fix) | First 11 samples (after the installment fix; first run → after for amount due) |
|---|---|---|---|
| Personal identifiers remaining in text sent to the cloud | 0 of 28 | 2 of 95 → 0 of 95 | 0 to 3 of 47 across three runs |
| Amounts and deadlines transcribed correctly by Gemini Nano | 24 of 28 | 48 of 54 → 49 of 54 | 15 of 19 |
| Amount due matches the notice | 12 of 14 | 31 of 34 → 31 of 34 | 6 of 11 → 10 of 11 |
| Deadline matches the notice, where one is printed | 12 of 14 | 17 of 25 → 21 of 25 | 6 of 8 |
| Required action stated correctly | 14 of 14 | 31 of 34 → 30 of 34 | 10 of 11 |
| Consequence of ignoring the notice stated correctly | 14 of 14 | 33 of 34 → 33 of 34 | 11 of 11 |

On the first 11 samples, four of the five wrong amounts were on bills paid in installments or at a reduced early rate, where the app reported the yearly total or the standard fine; we updated the prompt to report the next installment or the reduced amount currently due. On the next 34, the first run matched 17 of 25 deadlines. In four of the misses the masking step had hidden the date: `src/redact.js` did not recognize dates written as 2026/06/30 or 12.03.26, and Gemini Nano had listed a bare year as an account number. We added those formats and stopped masking inside recognized dates and amounts, and a rerun matched 21 of 25. We then collected 14 more samples and ran them once. Most of the remaining misses were on guide pages that print the sample bill at a reduced size inside an explanation, making the small digits hard for Gemini Nano to read.

`eval/eval.html` runs the app's production pipeline, including the double-check, over the rendered page images. `eval/docs/` stores every letter and answer key, and `eval/out/runs/` logs the per-letter transcripts, outgoing masked text, and explanations for each run.

On an Apple M5 Max test machine, the on-device pass took a median of 32 seconds per letter on our set and about 50 seconds on the agency samples, the initial cloud explanation took 2 to 6 seconds, and the double-check took a median of 9 to 10 seconds across the two sets.

To reproduce, start `npm run dev`, start Chrome with `--remote-debugging-port=9333`, and run:

```
node eval/build.mjs            # render eval/docs to page photos in eval/out
node eval/run.mjs final run-1 nano  # or dev, held-out, fresh, or a list of ids such as ko01,de08; "nano" adds the on-device-only comparison
node eval/replay.mjs run-1     # re-apply the current masking rules to a saved run, without model calls
node eval/run.mjs real real-1   # the agency samples; download them first from the addresses in eval/real/sources.json
```

`eval/docs/AUTHORING.md` describes the letter format and the answer key.

## Run it locally

Requirements: Node 20 or later, Chrome 139 or later on a desktop computer, and a Firebase project with Firebase AI Logic (Gemini Developer API) enabled.

```
npm install
cp firebase-config.example.json firebase-config.json   # paste your web app config
npm run dev
```

Open http://localhost:5183 in Chrome. App Check is enforced for Firebase AI Logic, so register a debug token for local development: add `VITE_APPCHECK_DEBUG_TOKEN=<a UUID>` to `.env.development.local` and register the same value under **App Check > Apps > Manage debug tokens** in the Firebase console. For a deployed build, set `VITE_RECAPTCHA_SITE_KEY` in `.env.production` to your reCAPTCHA Enterprise site key.

Deploy to Firebase Hosting:

```
npm run build
npx firebase-tools deploy --only hosting
```

## License

Apache 2.0. See [LICENSE](LICENSE).
