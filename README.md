# Diary

Personal offline diary PWA for iPhone. Encrypted at rest. No backend. No accounts.

**Live:** https://ajinkya1810.github.io/diary/

---

## Features

### Writing
- Rich text editor (TipTap) — bold, italic, headings, bullets, ordered lists
- Title + date per entry (date defaults to today, can be changed)
- Mood rating 1–5 (😞 😕 😐 🙂 😄)

### Media
- Attach photos and videos per entry
- Camera capture button (uses device camera directly)
- Images compressed to max 2048px JPEG (0.85 quality) before storage
- Videos validated: max 50 MB, max 30 seconds
- Thumbnail strip shown in timeline and edit view
- Lightbox tap-to-zoom on entry detail

### Tags
- Create/rename/delete tags in Settings (⚙ top-right of timeline)
- Tag picker on entry edit — tap chip to toggle, "+ New tag" to create on-the-fly
- Tag chips shown on timeline rows and entry detail
- Tags are not encrypted (names visible in DB)

### Search
- Search bar at top of timeline — searches title + body text
- 200ms debounce, prefix-match (typing "hap" matches "happy")
- Clears with ✕ button, shows result count

### Security
- AES-GCM 256-bit encryption on all entry text and media
- Key derived from passcode via PBKDF2-SHA256 (200,000 iterations)
- Key lives in memory only — never written to disk
- Auto-locks after 2 minutes in background (visibilitychange)
- Forgotten passcode = **permanent data loss** — no reset exists
- Verifier pattern: encrypts constant string to confirm passcode correctness on unlock

### Backup & Export
- **Encrypted backup** — exports entire DB + media as `.diarybackup` file (JSON, already-encrypted data, no re-encryption). On iPhone: opens share sheet (save to Files, AirDrop, etc.)
- **Restore** — imports `.diarybackup`, replaces all data, forces re-lock. Works cross-device if passcode is the same.
- **PDF export** — one page per entry with date, title, body text. No images. On iPhone: opens share sheet.

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
- Export backup before changing devices or reinstalling.
- On restore: both devices must use the same passcode (backup embeds the vault salt).
- Auto-locks after 2 minutes when backgrounded.
- OPFS (media storage) requires iOS 17+. Older iPhones cannot store photos/videos.
