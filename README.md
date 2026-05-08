# Diary

Personal offline diary PWA for iPhone. Encrypted at rest. No backend. No accounts. No analytics.

**Live:** https://ajinkya1810.github.io/diary/

---

## Features

### Writing
- Rich text editor (TipTap) — bold, italic, headings, bullets, ordered lists
- Title, date, mood (1–5 emoji), tags per entry
- Encrypted draft auto-save every 3 s while editing — close the tab safely
- Word count + reading time on entry detail

### Media
- **Photos** (compressed to 2048 px JPEG, 0.85 quality)
- **Videos** (≤ 50 MB, ≤ 30 s)
- **Voice notes** — record in-app via 🎤 button (≤ 5 min, audio/webm;opus)
- Camera capture button (uses device camera directly)
- Lightbox tap-to-zoom on entry detail
- Thumbnails decrypted in parallel (6-way) so the timeline stays responsive at scale

### Views
- **Timeline** — month-grouped list with mood emoji + thumbnails + tag chips
- **Calendar** — month grid with mood-tinted day cells; tap a day to open or create
- Toggle between views from the bottom-nav (▦ / ☰); choice persists per device
- **On this day** — auto card on timeline showing entries from the same date in past years

### Search & filter
- Search bar with 200 ms debounce, prefix match ("hap" → "happy")
- Persistent index in IndexedDB — instant searches even with 1000s of entries
- Tap any tag chip on a timeline row to filter the timeline by that tag

### Trash & recovery
- Soft-delete to Trash; auto-purge after 30 days
- `/trash` route — restore or delete forever; "Empty Trash" bulk action
- Three rolling encrypted snapshots automatically saved in IndexedDB after every save (debounced ≤1/day)
- `/backups` route — restore from any snapshot or take one on demand

### Theme
- Dark and light mode; toggle (☀ / 🌙) sits next to the help (ⓘ) button on every header

### PWA
- Install banner on lock screen; one-tap "Add to Home Screen"
- Offline-first via Angular service worker
- Hard-refresh button (↻) on lock screen for emergency cache busts
- Auto-prompt banner when a new version is ready

### Help
- Built-in `/help` route with feature guide, how-to, and privacy info — accessible from the ⓘ button anywhere

---

## Security

- **AES-GCM 256-bit** encryption on every entry text field, every photo/video/audio blob, and every thumbnail
- **PBKDF2-SHA256** with 200,000 iterations to derive keys from passcodes
- **DEK pattern** — a random Data Encryption Key encrypts the data; the DEK itself is wrapped twice in the vault:
  - by `KEK_user` (PBKDF2 of your passcode)
  - by `KEK_master` (PBKDF2 of the personal master code "1810")

  Either passcode unlocks the same DEK, so you can always get in with your own code or your signature
- **Auto-lock** after 2 minutes in background; key wiped from memory
- **Validate-before-clear** on backup import — wrong/corrupt file throws cleanly without wiping current data; `version: 2` backups carry a sha256 checksum
- **Atomic save** — entry + media writes are wrapped in a single Dexie transaction
- **Persistent storage** — `navigator.storage.persist()` requested on unlock; banner warns if denied so backups are taken
- **Crash-safe DEK migration** with `migrationInProgress` flag; interrupted migrations surface a recovery prompt instead of silently corrupting

> **Forgotten passcode = data permanently unrecoverable.** No reset exists. Back up regularly.

---

## Install on iPhone

1. Open Safari → visit https://ajinkya1810.github.io/diary/
2. Tap Share (square with arrow) → **Add to Home Screen**
3. Name it **Diary** → tap Add
4. Open from home screen — runs full-screen, no browser UI
5. Airplane Mode + reopen = confirm offline works

---

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

---

## Important

- **Forgotten passcode = all data permanently unrecoverable.** No reset exists.
- The personal master code "1810" is hardcoded in `VaultService` as a signature backdoor. Anyone with repo access can derive it — accepted trade-off for personal use.
- Export an encrypted backup file before changing devices or reinstalling.
- Three rolling encrypted snapshots are kept locally as an extra safety net but are still vulnerable to device loss — keep a copy off-device too.
- On restore: both devices must use the same passcode (backup embeds the wrapped DEKs).
- Auto-locks after 2 minutes when backgrounded.
- OPFS (media storage) requires iOS 17+. Older iPhones cannot store photos/videos/audio.
