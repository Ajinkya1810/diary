# Diary

Personal offline diary PWA for iPhone. Encrypted at rest. No backend. No accounts.

**Live:** https://ajinkya1810.github.io/diary/

## Install on iPhone

1. Open Safari on your iPhone
2. Visit https://ajinkya1810.github.io/diary/
3. Tap the Share button (square with arrow)
4. Tap **Add to Home Screen**
5. Name it **Diary** → tap Add
6. Open it from your home screen — it runs full-screen with no browser UI
7. Turn on Airplane Mode and open it again to confirm offline works

## Local development

```bash
export PATH="/snap/bin:$PATH"
npm install
npx ng serve
# open http://localhost:4200
```

## Deploy

Push to `main` — GitHub Actions builds and deploys to `gh-pages` automatically.

```bash
git push origin main
```

Build output: `dist/diary/browser/`

## Important

- **Forgotten passcode = data is permanently unrecoverable.** There is no reset.
- All entry text and media is encrypted with AES-GCM 256. The key exists only in memory.
- Auto-locks after 2 minutes when the app is backgrounded.
