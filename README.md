# Plainletter

Plainletter explains foreign-language tax bills and government notices while keeping your personal details on your device. Using Firebase AI Logic hybrid inference, it runs Gemini Nano in Chrome to transcribe the photo and mask identifiers locally, then sends only the masked text to Gemini in the cloud.

Try it: https://plainletter-99bce.web.app (Chrome 139 or later on a desktop computer)

Built for #BuildHybridAI 2026.

## What it does

1. Choose a photo of a tax bill or a government notice, take one with your computer's camera, or click a sample letter.
2. Gemini Nano transcribes the photo twice and lists the details that identify you.
3. The app replaces them with placeholders such as `[NAME_1]` and shows what stays on the device next to what goes to the cloud.
4. Gemini in the cloud explains the masked text in your language, covering the sender, required steps, the amount and deadline, and what happens if you ignore it. A larger model then rewrites the explanation from the masked text and any differing lines in the second reading, updates the answer in place, and lists any words Gemini Nano misread.
5. The browser puts the real values back into the answer and marks them. Follow-up questions are masked the same way and answered using Google Search, with source links under each reply.
6. When offline, the explanation call automatically falls back to Gemini Nano on the device.

## Where Firebase AI Logic is used

All inference goes through `firebase/ai`. See [`src/pipeline.js`](src/pipeline.js).

| Task | Call | Mode |
|---|---|---|
| Transcribe the photo (twice) | `InferenceMode.ONLY_ON_DEVICE` with `generateContent([prompt, image])` | on device only |
| Find identifying details as JSON | `InferenceMode.ONLY_ON_DEVICE` with `onDeviceParams.promptOptions.responseConstraint` | on device only |
| Explain the masked letter as JSON | `InferenceMode.PREFER_IN_CLOUD` (`gemini-3.5-flash-lite` `inCloudParams` and Gemini Nano `onDeviceParams` sharing one schema) | cloud, on device when offline |
| Double-check the explanation | `InferenceMode.ONLY_IN_CLOUD` on `gemini-4-hydrogen` with `thinkingConfig` and the same schema | cloud only |
| Follow-up questions | `getGenerativeModel()` on `gemini-4-hydrogen` with `tools: [{ googleSearch: {} }]`, `startChat()`, and `sendMessageStream()` | cloud only |

`src/firebase.js` initializes App Check (reCAPTCHA Enterprise) before any model call. `src/redact.js` builds the masked text and restores real values in the answer.

## Results on the test set

The evaluation set in `eval/out/*.jpg` contains 10 synthetic notices in Korean, German, Japanese, and English with fictional names and numbers, each rendered as a 1280×960 JPEG with tilt, blur, shadow, and compression noise.

| Check | Result |
|---|---|
| Amounts and deadlines transcribed correctly by Gemini Nano | 20 of 20 |
| Personal identifiers masked by Gemini Nano's own detection | 46 of 46 |
| Personal identifiers in the text sent to the cloud, after the `src/redact.js` rules | 0 of 46 |
| Amounts and deadlines still readable in the sent text | 20 of 20 |
| Agency helpline numbers still readable in the sent text | 3 of 4 (one was labeled a personal phone, masked, and restored in the answer on the device) |
| Deadline in the explanation matches the letter | 10 of 10 in the first answer, 10 of 10 after the double-check |
| Amount due in the explanation matches the letter | 10 of 10 in the first answer, 10 of 10 after the double-check |
| Misread words listed and corrected by the double-check | 9, on 4 of the 10 notices |

`eval/eval.html` runs the app's own pipeline (`readLetter` and `explain` from `src/pipeline.js`, including the double-check) over the notices in `eval/notices.json`. To reproduce, start `npm run dev`, start Chrome with `--remote-debugging-port=9333`, and run:

```
node eval/run.mjs
```

The per-notice transcriptions, detected identifiers, sent text, and explanations are saved to `eval/out/results.json`.

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
