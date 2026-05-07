# Diary PWA — Dev Notes

## Stack Decisions

- **Angular 17** standalone components + signals — no NgModules, minimal zone.js
- **Dexie.js** for IndexedDB — clean Promise API, migration support
- **OPFS** for media blobs — quota-managed, no size limits on IDB
- **TipTap** rich text — extensible, good iOS support
- **Web Crypto API** AES-GCM 256, PBKDF2-SHA256 200k iterations — browser-native, no dependencies
- **jsPDF** for PDF export — MIT, bundleable
- **GitHub Pages** + Actions — free, static, no backend

## Dexie Schema

### Version 1 (Phase 1)
```
entries: ++id, date, createdAt, updatedAt
tags: ++id, name
```

## Encryption Format

- Algorithm: AES-GCM 256-bit
- KDF: PBKDF2-SHA256, 200,000 iterations, 16-byte random salt
- IV: 12 bytes random per encrypt call
- Encrypted blob on disk: `{ iv: Uint8Array(12), ciphertext: Uint8Array }`
- Verifier: encrypt constant `"DIARY_VERIFIER_V1"` to confirm passcode
- Key lives in memory only — never persisted

## Search Tokenizer Rules

- Lowercase all text
- Split on non-alphanumeric characters
- Drop tokens shorter than 2 chars
- Drop tokens longer than 50 chars
- Deduplicate per entry
- Index: token → Set<entryId> (inverted index, encrypted at rest)

## Safari / iOS Quirks

- `playsinline` required on `<video>` or iOS auto-fullscreens
- HEIC photos from camera roll get downgraded to JPEG by the browser — OK
- Video thumbnail: load into `<video preload="metadata">`, seek to 0.1s, draw to canvas, revoke object URL
- OPFS available in iOS 17+
- PWA auto-lock uses `visibilitychange` event (not blur/focus)

## Gotchas

- Angular 17 `application` builder: browser output at `dist/diary/browser`, not `dist/diary`
- `ng add @angular/pwa` requires clean `npm install` with same Node version as project
- `base-href /diary/` must be passed at build time; `index.html` has `/` for local dev

## Phase Log

| Phase | Status | Deploy |
|-------|--------|--------|
| 0 — Setup & deploy | In progress | https://ajinkya1810.github.io/diary/ |
