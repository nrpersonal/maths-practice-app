# Maths Practice Tests (UK Years 1–8)

Life-in-the-UK-style multiple-choice maths tests. Everything is in `www/` — one HTML file, no server, no accounts, no data leaves the device.

## Option A — install as a web app (free, 10 minutes)
1. Put the `www` folder on any static host (GitHub Pages, Netlify Drop, Cloudflare Pages).
2. On iPhone: open the link in Safari → Share → **Add to Home Screen**.
   On Android: open in Chrome → ⋮ → **Install app**.
It works offline after the first visit (service worker in `sw.js`).

## Option B — App Store and Google Play (Capacitor)
Needs Node.js 20+, plus a Mac with Xcode for iOS and Android Studio for Android.

```bash
npm install @capacitor/core @capacitor/ios @capacitor/android
npm install -D @capacitor/cli
npx cap add ios
npx cap add android
npx cap sync            # run again after any change to www/
npx cap open ios        # build, sign, archive in Xcode
npx cap open android    # Build > Generate Signed App Bundle
```
- Change `appId` in `capacitor.config.json` to a reverse domain you own before the first `cap add`.
- Store accounts: Apple Developer Program (annual fee) and Google Play Console (one-off fee). New personal Play accounts must run a closed test with testers before going public.
- Apps aimed at children fall under Apple's Kids Category rules and Google Play's Families policy. This app has no ads, tracking, or network calls, which keeps that simple.
- Replace `www/icon-*.png` with your own icon; use `@capacitor/assets` to generate all sizes.

## Customising
- In the app: Settings → year, questions per test, pass mark, difficulty, timer, exam/instant mode, topics included, your own questions.
- In code: each topic is one `topic(id, year, name, hint, generator)` call in `www/index.html`. A generator returns
  `Q(questionHtml, correctAnswer, {wrong:[common mistakes], sol:'worked solution'})`; numeric distractors are filled in automatically.
