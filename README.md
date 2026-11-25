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
7. When offline, the explanation call automatically falls back to Gemini Nano on the device.

## Where Firebase AI Logic is used

All inference goes through `firebase/ai`. See [`src/pipeline.js`](src/pipeline.js).

| Task | Call | Mode |
|---|---|---|
| Transcribe every page twice, in strips | `InferenceMode.ONLY_ON_DEVICE` with `generateContent([prompt, image])` | on device only |
| Find identifying details as JSON | `InferenceMode.ONLY_ON_DEVICE` with `onDeviceParams.promptOptions.responseConstraint` | on device only |
| Explain the masked letter as JSON | `InferenceMode.PREFER_IN_CLOUD` (`gemini-3.5-flash-lite` `inCloudParams` and Gemini Nano `onDeviceParams` sharing one schema) | cloud, on device when offline |
| Double-check the explanation | `InferenceMode.ONLY_IN_CLOUD` on `gemini-4-hydrogen` with `thinkingConfig` and the same schema | cloud only |
| Follow-up questions | `getGenerativeModel()` on `gemini-4-hydrogen` with `tools: [{ googleSearch: {} }]`, `startChat()`, and `sendMessageStream()` | cloud only |

`src/firebase.js` initializes App Check (reCAPTCHA Enterprise) before any model call. `src/redact.js` builds the masked text and restores real values in the answer. `src/pages.js` turns photos and PDF pages into strips, and `src/box.js` is the letter box.

## Results on the test set

We created 66 fictional letters (84 pages) with invented recipients in Korean, German, Japanese, English, French, and Spanish, modeled on real agency forms from 16 countries: tax assessments, insurance and pension arrears, immigration document requests, traffic fines, court payment orders, hospital bills, utility cutoff notices, benefit repayments, and summonses. Each page includes tables, multiple amounts and dates, and numbered legal notes; 18 letters span two pages with a required fact only on page 2, and 12 require an action without a payment. Every page was rendered as a camera-style image with tilt, shear, blur, shadow, noise, and JPEG compression.

To evaluate without overfitting, we split the 66 letters into three groups: 18 tuning letters, 30 held-out letters untouched until the first full run, and 18 new letters written after updating our prompts and rules. That first run on the 30 held-out letters masked 175 of 183 personal identifiers and left 8 in the text sent to the cloud (four vehicle plates, three names printed in a second format, and one five-digit customer number). After we added vehicle plates to the on-device prompt and introduced the multi-format name rule, the 18 new letters kept 118 of 119 identifiers on the device, leaving 1 in the sent text.

| Check | 18 new letters (24 pages) | 30 held-out letters (42 pages), first run |
|---|---|---|
| Amounts and deadlines transcribed correctly by Gemini Nano | 30 of 30 | 58 of 58 |
| Personal identifiers masked by Gemini Nano alone | 102 of 119 | 156 of 183 |
| Personal identifiers remaining in text sent to the cloud, after `src/redact.js` | 1 of 119 | 8 of 183 |
| Deadline matches the letter (first answer → after double-check) | 14 of 18 → 16 of 18 | 30 of 30 → 30 of 30 |
| Amount due matches the letter (first → after double-check) | 18 of 18 → 18 of 18 | 29 of 30 → 30 of 30 |
| Required action stated correctly (first → after double-check) | 17 of 18 → 18 of 18 | 30 of 30 → 30 of 30 |
| Consequence of ignoring stated correctly (first → after double-check) | 17 of 18 → 18 of 18 | 28 of 30 → 29 of 30 |

Both deadline misses on the 18 new letters had the same root cause: Gemini Nano flagged deadlines with spelled-out month names ("7. Januar 2027" and "8 janvier 2027"), and our date pattern did not yet recognize German, French, or Spanish months to keep them unmasked. Adding those month names resolved both cases. The single unmasked identifier on the new set was a 12-character reference number on a Colombian vehicle tax notice. Re-running the earlier splits with the current rules leaves 4 of 183 identifiers on the 30 held-out letters and 0 of 101 on the 18 tuning letters. Across all 66 letters, the cloud double-check listed and corrected 156 misread words.

We also ran 11 sample notices that agencies publish themselves, which we did not write: IRS notices CP14 and CP503, the CP14 in Spanish, two UK council tax bills, a New York City water bill, a North Rhine-Westphalia income tax assessment, a Cologne property charges notice, two French traffic fine notices from ANTAI, and a Tokyo ward's resident tax notice. `eval/real/sources.json` lists where each one comes from. On the first run the explanation gave the amount to pay on 6 of 11. Four of the five misses were bills paid in instalments or at a reduced early rate, where the app reported the yearly total or the standard fine. After we told the model to report the next instalment, a rerun gave the amount on 10 of 11, the required action on 10 of 11, the consequence on 11 of 11, and the deadline on 6 of the 8 notices that print one. Gemini Nano read 15 of 19 amounts and deadlines on these pages, several of which are low-resolution images, and across three runs between 0 and 3 of 47 identifiers remained in the sent text.

`eval/eval.html` runs the app's production pipeline, including the double-check, over the rendered page images. `eval/docs/` stores every letter and answer key, and `eval/out/runs/` logs the per-letter transcripts, outgoing masked text, and explanations for each run.

On an Apple M5 Max test machine, the on-device pass took a median of 32 seconds per letter on our set and 44 seconds on the agency samples, the initial cloud explanation took 2 to 3 seconds, and the double-check took a median of 9 seconds.

To reproduce, start `npm run dev`, start Chrome with `--remote-debugging-port=9333`, and run:

```
node eval/build.mjs            # render eval/docs to page photos in eval/out
node eval/run.mjs fresh run-1  # or dev, held-out, or a list of ids such as ko01,de08
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
