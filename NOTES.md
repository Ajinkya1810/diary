# Diary PWA — Dev Notes

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Angular 17 standalone + signals | No NgModules, minimal zone.js, tree-shakeable |
| DB | Dexie.js (IndexedDB) | Clean Promise API, versioned migrations, Dexie Cloud-compatible if needed |
| Media storage | OPFS (Origin Private File System) | No size quota issues vs. IndexedDB blobs; iOS 17+ |
| Rich text | TipTap (`@tiptap/core`, no `@tiptap/angular`) | @tiptap/angular doesn't exist; used raw ViewChild + ElementRef |
| Crypto | Web Crypto API (browser-native) | AES-GCM 256, PBKDF2-SHA256, no JS library needed |
| PDF | jsPDF | MIT, bundleable, text-only output |
| Hosting | GitHub Pages + Actions | Free, static, no backend |

---

## Project Structure

```
src/app/
├── core/
│   ├── auth/
│   │   └── unlocked.guard.ts          # CanActivateFn — redirects to /lock if vault locked
│   ├── crypto/
│   │   └── crypto.service.ts          # All AES-GCM + PBKDF2 ops
│   ├── db/
│   │   └── db.service.ts              # Dexie schema + all interfaces
│   ├── entry/
│   │   └── entry.service.ts           # Transparent encrypt/decrypt layer over DB
│   ├── export/
│   │   └── export.service.ts          # Backup export/import + PDF
│   ├── media/
│   │   ├── media.service.ts           # Add/get/delete media, compression, quota
│   │   └── opfs.service.ts            # Low-level OPFS path resolver
│   ├── search/
│   │   └── search.service.ts          # In-memory inverted index
│   ├── tag/
│   │   └── tag.service.ts             # Tag CRUD
│   └── vault/
│       └── vault.service.ts           # Passcode setup, unlock, lock, key in memory
├── features/
│   ├── entry-detail/                  # Read-only view of one entry
│   ├── entry-edit/                    # Create + edit entries
│   ├── lock-screen/                   # Passcode setup + unlock UI
│   ├── settings/                      # Tag management + backup/export
│   └── timeline/                      # Entry list, search bar, month groups
└── shared/
    └── editor/                        # TipTap wrapper component
```

---

## Data Models (db.service.ts)

```typescript
// Plaintext — used by all UI components
interface Entry {
  id: string;
  date: string;           // 'YYYY-MM-DD'
  title: string;
  bodyHtml: string;
  bodyText: string;       // strip of bodyHtml, used for search index + PDF
  mood: number | null;    // 1–5
  tagIds: string[];
  mediaIds: string[];
  createdAt: number;      // ms epoch
  updatedAt: number;
}

// On-disk — text fields replaced with encrypted form
interface StoredEntry extends Omit<Entry, 'title' | 'bodyHtml' | 'bodyText'> {
  title: EncryptedField;
  bodyHtml: EncryptedField;
  bodyText: EncryptedField;
}

interface EncryptedField {
  iv: Uint8Array;   // 12 bytes
  ct: Uint8Array;   // AES-GCM ciphertext
}

interface Tag {
  id: string;
  name: string;     // NOT encrypted
}

interface MediaRecord {
  id: string;
  entryId: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  opfsPath: string;             // e.g. 'media/2024/01/abc123.jpg'
  thumbnailData: EncryptedField; // encrypted JPEG blob stored in DB
  createdAt: number;
}

interface VaultMeta {
  id: 'singleton';
  salt: Uint8Array;         // 16 bytes, PBKDF2 salt
  verifierIv: Uint8Array;
  verifierCt: Uint8Array;   // encrypt('DIARY_VERIFIER_V1') — passcode check
}
```

---

## Dexie Schema Versions

```
v1  entries(id, date, createdAt, updatedAt) + tags(id, name)
v2  + media(id, entryId, createdAt)
v3  + vaultMeta(id)
    migrate: clear entries + media (plaintext → encrypted schema change)
```

No v4 yet. Future changes that add fields don't need migration (Dexie ignores unknown fields).
Changes that encrypt previously-unencrypted fields need a version bump + migration.

---

## Encryption Architecture (v2 — DEK pattern, since v1.1.0)

### Layers
```
random DEK (32 bytes, AES-GCM 256)        ← encrypts all data (entries, media, thumbnails)
  ↑ wrapped by ↑
KEK_user (PBKDF2 from user passcode + saltUser)       → dekWrappedUser
KEK_master (PBKDF2 from "1810" + saltMaster)          → dekWrappedMaster
```

Both wrapped DEKs stored in VaultMeta. Either unlock path recovers same DEK.

### Unlock attempt
```
1. derive KEK_user = PBKDF2(passcode, saltUser); try decrypt dekWrappedUser → got DEK
2. else derive KEK_master = PBKDF2(passcode, saltMaster); try decrypt dekWrappedMaster → got DEK
3. else: wrong passcode
```

So user's normal passcode unlocks via path 1. Master code "1810" unlocks via path 2.

### Master code
Hardcoded `MASTER_CODE = '1810'` in VaultService. Personal-use signature backdoor. Anyone with repo access can derive it — acceptable for personal app.

### Migration (v1 → v2)
On first unlock with old passcode: decrypt all entries+media with old key → generate DEK → re-encrypt everything with DEK → wrap DEK with both KEKs → write new VaultMeta.

### Verifier pattern
v2 uses verifier `'DIARY_VERIFIER_V2'` encrypted with DEK. Used to confirm a successful unwrap (since AES-GCM throws on bad MAC anyway, verifier mostly informational).

### Entry text fields
Each field (title, bodyHtml, bodyText) gets its own random IV. Encrypted separately.
Stored as `EncryptedField { iv: Uint8Array(12), ct: Uint8Array }` in IndexedDB.

### Media blob (OPFS)
Wire format: `[12-byte IV][ciphertext]` — single Blob written to OPFS.
On read: split at byte 12, decrypt.

### Media thumbnail (IndexedDB)
Stored as `EncryptedField` in `MediaRecord.thumbnailData`.
Decrypted by `MediaService.getThumbnailBlob()`.

### Key lifecycle
- Key is a `CryptoKey` object held in `VaultService.key` (private field, in-memory only)
- `VaultService.lock()` → `this.key = null` + navigate to /lock
- Auto-lock: `visibilitychange` → setTimeout 2 min → `vault.lock()`
- Timer is cleared if app comes back to foreground within 2 min

---

## Search

In-memory inverted index. Rebuilt from plaintext entries every time Timeline loads.

```
tokenize(text):
  lowercase → split on /[^a-z0-9]+/ → filter length 2–50 → deduplicate

buildIndex(entries):
  for each entry: tokenize(title + ' ' + bodyText) → Map<token, Set<entryId>>

search(query):
  tokenize(query) → for each token, prefix-match all keys in index
  → intersect result sets across tokens (AND logic)
  → returns Set<entryId> | null (null = empty query)
```

Prefix match means "hap" matches entries containing "happy", "happening", etc.

Index is NOT persisted. Cleared on lock. Rebuilt on each navigation to /timeline.

---

## Media Pipeline

### Add image
```
File → compressImage(maxPx=2048, quality=0.85) → Blob (JPEG)
     → encryptToBinary → [IV|CT] Blob → OPFS write

File → compressImage(maxPx=400) → thumbnail Blob
     → encryptBlob → EncryptedField → stored in MediaRecord.thumbnailData
```

### Add video
```
File → validate (≤50MB, ≤30s via HTMLVideoElement.duration)
     → encryptToBinary → [IV|CT] Blob → OPFS write

File → videoThumbnail (seek to 0.1s, canvas draw) → JPEG Blob
     → encryptBlob → EncryptedField → MediaRecord.thumbnailData
```

### OPFS path format
`media/{year}/{month}/{uuid}.{ext}`
Example: `media/2024/05/3f2a1b...jpg`

---

## Backup Format (.diarybackup)

JSON file. All data stays encrypted (no decryption during export).

```json
{
  "version": 1,
  "exportedAt": 1714900000000,
  "vaultMeta": {
    "salt": "<base64>",
    "verifierIv": "<base64>",
    "verifierCt": "<base64>"
  },
  "entries": [
    {
      "id": "...",
      "date": "2024-05-01",
      "title": { "iv": "<base64>", "ct": "<base64>" },
      "bodyHtml": { "iv": "<base64>", "ct": "<base64>" },
      "bodyText": { "iv": "<base64>", "ct": "<base64>" },
      "mood": 4,
      "tagIds": [],
      "mediaIds": [],
      "createdAt": 1714900000000,
      "updatedAt": 1714900000000
    }
  ],
  "tags": [{ "id": "...", "name": "travel" }],
  "media": {
    "records": [{ ...MediaRecord with thumbnailData as base64... }],
    "blobs": {
      "media/2024/05/abc.jpg": "<base64 of encrypted OPFS blob>"
    }
  }
}
```

### Import behavior
- Clears entire DB (entries, media, tags, vaultMeta)
- Clears OPFS `media/` directory
- Restores all data from backup
- Forces lock — user re-enters passcode (which must match backup's passcode, because vaultMeta/salt is restored)

### Cross-device restore
Works if both devices use the same passcode. The backup includes the salt, so `PBKDF2(passcode, salt)` produces the same key → can decrypt everything.

---

## iOS / Safari Quirks

| Issue | Fix |
|---|---|
| `<video>` auto-fullscreens | `playsinline` attribute required |
| HEIC photos | Browser converts to JPEG automatically — no handling needed |
| Download via `<a>` unreliable in PWA | Use `navigator.share({ files })` — opens iOS share sheet |
| `navigator.share` must be in gesture context | jsPDF imported statically (not `await import()`), avoids context loss |
| OPFS | iOS 17+ only |
| `visibilitychange` for background detection | Reliable on iOS; `blur`/`focus` not reliable |
| `type="date"` input | Native date picker works on iOS |

---

## Angular Patterns Used

- **Standalone components** — no NgModule, each component declares its own imports
- **Signals** — `signal<T>()`, `signal.set()`, `signal()` reads — no RxJS in components
- **Lazy routes** — `loadComponent: () => import(...)` — each route chunk separate
- **`@if` / `@for` / `@switch`** — Angular 17 control flow syntax (no `*ngIf`)
- **`ng-template` + `*ngTemplateOutlet`** — reusable entry row in timeline
- **`canActivate: [unlockedGuard]`** — functional guard, no class

---

## Dev Protocol

**Every change must:**
1. Bump `"version"` in `package.json` (patch for fixes, minor for features) — `version.ts` is auto-generated from it at build via `scripts/gen-version.js`, do NOT edit `version.ts` directly
2. Add entry to Patch Log below
3. Update NOTES.md if architecture/patterns change

---

## Phase Log

| Phase | What was built |
|---|---|
| 0 | Angular scaffold, GitHub Actions deploy to GitHub Pages, PWA manifest + service worker, iOS install instructions |
| 1 | Timeline (month groups, mood emoji, text preview), entry CRUD (create/edit/delete), TipTap rich text editor, neon black theme |
| 2 | OPFS service, media attach (photo + video), image compression (2048px), video validation (50MB/30s), thumbnail generation, lightbox, storage quota warning |
| 3 | CryptoService (AES-GCM + PBKDF2), VaultService (in-memory key, passcode setup/unlock, verifier), EntryService (encrypt/decrypt layer), lock screen UI, auto-lock 2min, all routes guarded |
| 4 | SearchService (inverted index, prefix match), TagService (CRUD), Settings page, tag picker in entry-edit, tag chips on timeline + detail, search bar with debounce, "Edited X ago" on entry-detail |
| 5 | ExportService, encrypted backup download (.diarybackup), backup restore (cross-device), PDF export (jsPDF, cover + one page per entry), iOS share sheet integration |

## Patch Log

| Version | Date | Change |
|---|---|---|
| 1.0.1 | 2026-05-08 | entry-detail: video poster from decrypted thumbnail — no more blank frame before play |
| 1.0.2 | 2026-05-08 | fix: GitHub Pages SPA deep-link 404 — added 404.html redirect + index.html decode script |
| 1.0.3 | 2026-05-08 | feat: hard refresh button on lock screen — SwUpdate.checkForUpdate + activateUpdate + reload |
| 1.0.4 | 2026-05-08 | remove: PDF export feature + jspdf dep (~200KB bundle save). Settings PDF row removed |
| 1.1.0 | 2026-05-08 | feat: master code "1810" unlock + DEK pattern. Random DEK encrypts data, wrapped by KEK_user (passcode) and KEK_master ("1810"). Either unlocks. Transparent v1→v2 migration on first unlock |
| 1.2.0 | 2026-05-08 | feat: calendar view toggle on timeline. Month grid with mood emoji + color tint per day. Tap day → entry detail or new entry pre-filled with date. Persisted view choice in localStorage |
| 1.3.0 | 2026-05-08 | feat: audio note recording. MediaRecorder (audio/webm;opus). Max 5min. Mic-icon thumbnail. Encrypted same as other media. Audio player in entry-detail. MediaRecord.type extended with 'audio' |
| 1.4.0 | 2026-05-08 | feat: theme system (Neon/OLED/Midnight/Sunset). data-theme on <html>, CSS-var swap. ThemeService persists choice. Theme picker in Settings. Page fade-in animation. Improved serif body font stack |
| 1.5.0 | 2026-05-08 | feat: polish cluster — encrypted draft auto-save (3s), word count + reading time on detail, tag filter on timeline, backup reminder (>7d), SwUpdate auto-prompt banner with periodic 30min check |
| 1.6.0 | 2026-05-08 | feat: light mode + dark/light toggle on every screen. Theme split into mode (dark/light) + theme (accent palette). data-mode and data-theme on <html>. ThemeToggleComponent shared button placed in lock/timeline/entry-detail/entry-edit/settings headers |
| 1.7.0 | 2026-05-08 | feat: on-this-day card on timeline (entries from same MM-DD in past years), HapticService (vibrate on mood + save), PWA install banner via beforeinstallprompt with 14d dismiss memory, bottom nav bar (List/Calendar/+/Settings) replaces FAB |
| 1.7.1 | 2026-05-08 | remove: 4-theme picker (Neon/OLED/Midnight/Sunset). Keep dark/light mode only. ThemeService simplified to mode-only. Settings theme section + theme-card SCSS dropped |
| 1.8.0 | 2026-05-08 | feat: Help & About screen at /help. Sections: hero, features list, 6-step how-to, privacy info, tips, version. Linked from Settings as a card row |
| 1.8.1 | 2026-05-08 | move: Help button into ThemeToggleComponent — ⓘ now renders next to ☀/🌙 in every header. Settings help link removed |
| 1.8.2 | 2026-05-08 | feat: "Ajinkya" signature watermark fixed bottom-right on every screen (italic script font, 40% opacity, pointer-events none) |
| 1.8.3 | 2026-05-08 | style: signature now pink neon glow, full opacity, pulsing text-shadow, z-index 999 so it stays visible above bottom-nav on every screen |
| 1.8.4 | 2026-05-08 | style: prefix "made by" added before Ajinkya. Smaller sans-serif, lowercase, slightly muted; signature stays italic script with neon glow |
| 1.8.5 | 2026-05-08 | fix: signature offset raised to 82px from bottom so it no longer overlaps the bottom-nav Settings button on timeline |
| 1.8.6 | 2026-05-08 | fix: lock-screen footer (info/theme/version/refresh) no longer fixed at bottom — now in flex flow with justify-content: space-evenly so it centers in lower half |
| 1.9.0 | 2026-05-08 | feat: Trash / recycle bin. Soft-delete via Entry.deletedAt timestamp. /trash route lists deleted entries with restore + delete-forever buttons. Auto-purge after 30 days runs on timeline init. Empty Trash bulk action |

---

## Future Improvements

### High value
- **Passcode change** — requires re-encrypting all entries + media with new key. Pattern: decrypt all → derive new key → re-encrypt all → replace vaultMeta. Heavy but doable.
- **Entry sort options** — alphabetical, mood, date ascending. Currently always date descending (Dexie `orderBy('date').reverse()`).
- **Tag filter on timeline** — tap a tag chip to filter; currently tags only shown, not filterable.
- **Search in body HTML** — currently searches `bodyText` only; same for title. Could also surface matches with highlights.

### Medium value
- **Pinch-to-zoom on lightbox** — iOS native gesture; needs HammerJS or Pointer Events tracking.
- **Drag to reorder media** — currently media shown in add order only.
- **Entry templates** — save a blank entry structure to reuse (gratitude list, daily log, etc.).
- **Dark/light theme toggle** — currently hardcoded black. CSS custom property swap is straightforward.
- **Word count + reading time** — show on entry-detail; trivial to add.

### Low value / nice-to-have
- **iCloud sync** — would require CloudKit or a server. Breaks the no-backend constraint.
- **Biometric unlock** — WebAuthn PRF extension can derive a key from Touch ID / Face ID. Complex but possible on iOS 16+.
- **Markdown import** — parse `.md` files into TipTap HTML on import.
- **Streak counter** — days with at least one entry.

---

## Gotchas for Future Dev

- `StoredEntry` vs `Entry` — **never** pass `StoredEntry` to UI components. Always go through `EntryService` which returns `Entry` (plaintext).
- Dexie `update()` TypeScript constraint: `UpdateSpec<T>` is strict. Encrypted fields (type `EncryptedField`) clash with the spec type. Use `as any` cast when needed.
- `@tiptap/angular` does not exist. TipTap is used via `@tiptap/core` with a raw `ElementRef` in `EditorComponent`.
- Angular 17 application builder outputs to `dist/diary/browser/`, not `dist/diary/`. The GitHub Actions deploy.yml targets `dist/diary/browser`.
- `base-href /diary/` must be passed at build time: `ng build -- --base-href /diary/`. Local dev uses `/`.
- `navigator.share({ files })` requires a user gesture. Do not call after `await import(...)` — import is not a microtask and breaks the gesture context on iOS.
- OPFS not available in Firefox private browsing and some browser contexts. OpfsService will throw; MediaService catches and skips.
