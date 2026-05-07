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

## Encryption Architecture

### Key derivation
```
passcode (string)
  → PBKDF2-SHA256, 200,000 iterations, 16-byte salt
  → CryptoKey (AES-GCM 256-bit, extractable: false)
```

### Verifier pattern (passcode check without storing passcode)
```
on setup:   encrypt('DIARY_VERIFIER_V1') → { iv, ct } → stored in VaultMeta
on unlock:  derive key from entered passcode + stored salt
            → decrypt VaultMeta.{ verifierIv, verifierCt }
            → if result === 'DIARY_VERIFIER_V1' → correct passcode
            → if decrypt throws → wrong passcode
```

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

## Phase Log

| Phase | What was built |
|---|---|
| 0 | Angular scaffold, GitHub Actions deploy to GitHub Pages, PWA manifest + service worker, iOS install instructions |
| 1 | Timeline (month groups, mood emoji, text preview), entry CRUD (create/edit/delete), TipTap rich text editor, neon black theme |
| 2 | OPFS service, media attach (photo + video), image compression (2048px), video validation (50MB/30s), thumbnail generation, lightbox, storage quota warning |
| 3 | CryptoService (AES-GCM + PBKDF2), VaultService (in-memory key, passcode setup/unlock, verifier), EntryService (encrypt/decrypt layer), lock screen UI, auto-lock 2min, all routes guarded |
| 4 | SearchService (inverted index, prefix match), TagService (CRUD), Settings page, tag picker in entry-edit, tag chips on timeline + detail, search bar with debounce, "Edited X ago" on entry-detail |
| 5 | ExportService, encrypted backup download (.diarybackup), backup restore (cross-device), PDF export (jsPDF, cover + one page per entry), iOS share sheet integration |

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
