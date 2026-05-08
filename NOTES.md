# Diary PWA — Dev Notes

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Angular 17 standalone + signals | No NgModules, minimal zone.js, tree-shakeable |
| DB | Dexie.js (IndexedDB) | Clean Promise API, versioned migrations, Dexie Cloud-compatible if needed |
| Media storage | OPFS (Origin Private File System) | No size quota issues vs. IndexedDB blobs; iOS 17+ |
| Rich text | TipTap (`@tiptap/core`, no `@tiptap/angular`) | @tiptap/angular doesn't exist; used raw ViewChild + ElementRef |
| Crypto | Web Crypto API (browser-native) | AES-GCM 256, PBKDF2-SHA256, no JS library needed |
| Audio capture | `MediaRecorder` (audio/webm;opus) | In-app voice notes, max 5 min |
| Theme | `data-mode` attribute + CSS vars | Dark + light, no theme libs |
| Hosting | GitHub Pages + Actions | Free, static, no backend |

---

## Project Structure

```
src/app/
├── core/
│   ├── auth/unlocked.guard.ts        # CanActivateFn — redirects to /lock if vault locked
│   ├── backup/backup.service.ts      # Auto rolling local IDB snapshots (last 3, debounced ≤1/day)
│   ├── crypto/crypto.service.ts      # AES-GCM + PBKDF2 + raw key import
│   ├── db/db.service.ts              # Dexie schema (v5) + interfaces
│   ├── draft/draft.service.ts        # Encrypted localStorage drafts during editing
│   ├── entry/entry.service.ts        # Encrypt/decrypt layer; saveAtomic; in-memory plaintext cache
│   ├── export/export.service.ts     # Backup serialize/import + sha256 + structure validation
│   ├── haptic/haptic.service.ts      # navigator.vibrate wrapper with enable toggle
│   ├── install/install.service.ts    # beforeinstallprompt capture + dismiss memory
│   ├── media/
│   │   ├── media.service.ts          # prepareMedia + addMedia (DB-first ordering) + reapOrphans
│   │   └── opfs.service.ts           # OPFS resolver, listFiles, dir handle cache, clearDir
│   ├── search/search.service.ts      # Dexie-backed multi-entry token index (with in-memory fallback)
│   ├── storage/storage.service.ts    # navigator.storage.persist + persisted-state signal + banner gating
│   ├── tag/tag.service.ts            # Tag CRUD (names not encrypted)
│   ├── theme/theme.service.ts        # Dark/light mode signal + persistence
│   └── vault/vault.service.ts        # Passcode setup, DEK pattern, unlock paths, migration
├── features/
│   ├── backups/                       # /backups — snapshot list, Snapshot Now / Restore / Delete
│   ├── entry-detail/                  # Read-only view; word count + reading time; audio + video preview
│   ├── entry-edit/                    # Create + edit; atomic save; draft autosave; audio recording
│   ├── help/                          # /help — static feature guide / how-to / privacy info
│   ├── lock-screen/                   # Passcode setup + unlock; install banner; hard-refresh button
│   ├── settings/                      # Tags, backups, trash, preferences (haptics), version
│   ├── timeline/                      # Entry list, calendar view, search, on-this-day card, bottom-nav
│   └── trash/                         # /trash — soft-deleted entries with restore + delete-forever
└── shared/
    ├── editor/                        # TipTap wrapper component
    └── theme-toggle/                  # Header tools (☀/🌙 + ⓘ help)
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
  bodyText: string;       // strip of bodyHtml, used for search index
  mood: number | null;    // 1–5
  tagIds: string[];
  mediaIds: string[];
  createdAt: number;      // ms epoch
  updatedAt: number;
  deletedAt?: number;     // soft-delete timestamp; undefined = active
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
  type: 'image' | 'video' | 'audio';   // audio = MediaRecorder webm/opus
  mimeType: string;
  sizeBytes: number;
  opfsPath: string;             // e.g. 'media/2024/01/abc123.jpg'
  thumbnailData: EncryptedField; // encrypted JPEG blob (mic-icon for audio)
  createdAt: number;
}

interface VaultMeta {
  id: 'singleton';
  salt: Uint8Array;                          // KDF salt for KEK_user
  verifierIv: Uint8Array;
  verifierCt: Uint8Array;                    // encrypts 'DIARY_VERIFIER_V2' with DEK
  format?: 'v2';                             // omitted for legacy v1 vaults
  saltMaster?: Uint8Array;                   // KDF salt for KEK_master ("1810")
  dekWrappedUser?: EncryptedField;           // DEK encrypted with KEK_user
  dekWrappedMaster?: EncryptedField;         // DEK encrypted with KEK_master
  migrationInProgress?: { fromFormat: 'v1'; startedAt: number };
}

interface BackupSnapshot {        // Dexie v4 — auto rolling local snapshots
  id: string;
  ts: number;
  sizeBytes: number;
  payload: Blob;                  // serialized backup JSON (already-encrypted entries)
}

interface SearchTokens {          // Dexie v5 — persistent search index
  entryId: string;
  tokens: string[];               // multi-entry indexed via `*tokens`
}
```

---

## Dexie Schema Versions

```
v1  entries(id, date, createdAt, updatedAt) + tags(id, name)
v2  + media(id, entryId, createdAt)
v3  + vaultMeta(id)
    migrate: clear entries + media (plaintext → encrypted schema change)
v4  + backupSnapshots(id, ts)              // auto rolling local backups (1.13.0)
v5  + searchTokens(entryId, *tokens)       // persistent multi-entry search index (1.13.0)
```

Adding fields to existing tables doesn't need a version bump (Dexie ignores unknown fields). Bump only when adding tables or changing index schemas.

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

### Migration (v1 → v2) — crash-safe (1.12.0)
On first unlock with old passcode:
1. Write `migrationInProgress: { fromFormat: 'v1', startedAt }` to VaultMeta BEFORE any work.
2. Inside a single Dexie transaction: decrypt every entry's text fields and every media thumbnail with the old key, re-encrypt with the new DEK.
3. Outside the transaction (OPFS isn't transactional): re-encrypt OPFS media blobs sequentially.
4. Final atomic swap: write the new v2 VaultMeta with `dekWrappedUser`, `dekWrappedMaster`, and the new verifier; the `migrationInProgress` field is omitted (cleared).

If the app crashes between steps, the next unlock detects the lingering flag and surfaces a recovery prompt. Auto-resume is intentionally not attempted (mixed-key state isn't safe to fix in-place).

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

Persistent inverted index in Dexie `searchTokens` (multi-entry index on `*tokens`). Synced incrementally — rebuilds only changed entries.

```
tokenize(text):
  lowercase → split on /[^a-z0-9]+/ → filter length 2–50 → deduplicate

ensureIndex(entries):                     // called from timeline.ngOnInit
  for each entry: compare current tokens vs persisted; put if changed
  for each persisted row not in entries: delete

search(query):                            // async, IDB-backed
  tokenize(query) → for each token: db.searchTokens.where('tokens').startsWith(token)
  → intersect entry-id sets across tokens (AND logic)
  → returns Promise<Set<entryId> | null>  (null = empty query)
```

Tokens are stored plaintext (same trade-off as `Tag.name`). If/when this becomes unacceptable, swap for HMAC tokens keyed by the DEK.

Backwards-compat: `SearchService.buildIndex(entries)` and `searchSync(query)` keep an in-memory map for any caller not yet migrated to async.

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

### Add audio (1.3.0)
```
MediaRecorder (audio/webm;opus) → Blob
     → validate (≤20MB, ≤300s)
     → encryptToBinary → [IV|CT] Blob → OPFS write

audioThumbnail() — 200×200 mic-icon JPEG (canvas draw of 🎤)
     → encryptBlob → MediaRecord.thumbnailData
```

### Write order (D3-hardened in 1.12.0)
`addMedia` calls `prepareMedia` (CPU-bound encrypt + thumb), then:
1. `db.media.add(record)` — DB row first
2. `opfs.writeBlob(record.opfsPath, encryptedBlob)` — blob second
3. On OPFS write failure → `db.media.delete(record.id)` to roll back

A daily reaper (`MediaService.reapOrphans`) walks `OpfsService.listFiles('media')` and removes any blob whose record is missing.

### OPFS path format
`media/{year}/{month}/{uuid}.{ext}`
Example: `media/2024/05/3f2a1b...jpg`

---

## Backup Format

JSON file. All data stays encrypted (no decryption during export).

Two formats supported on import:
- **`version: 1`** — older backups (no checksum). Still importable for backwards compat.
- **`version: 2`** — current. Same shape as v1 plus a top-level `checksum` field (sha256 hex over the canonical-JSON of the rest of the payload). Verified before import; mismatch aborts.

```json
{
  "version": 2,
  "exportedAt": 1714900000000,
  "vaultMeta": {
    "salt": "<base64>",
    "verifierIv": "<base64>",
    "verifierCt": "<base64>",
    "format": "v2",
    "saltMaster": "<base64>",
    "dekWrappedUser":   { "iv": "<base64>", "ct": "<base64>" },
    "dekWrappedMaster": { "iv": "<base64>", "ct": "<base64>" }
  },
  "entries": [
    {
      "id": "...",
      "date": "2024-05-01",
      "title":    { "iv": "<base64>", "ct": "<base64>" },
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
    "records": [{ "...": "MediaRecord with thumbnailData as base64" }],
    "blobs": {
      "media/2024/05/abc.jpg": "<base64 of encrypted OPFS blob>"
    }
  },
  "checksum": "<sha256 hex>"
}
```

### Import behavior (D1-hardened in 1.12.0)
1. Parse JSON; throw if invalid.
2. Validate top-level shape AND every entry/media record before touching DB.
3. If `version: 2`, recompute and verify the sha256 checksum.
4. Wrap clears + bulkPuts in a single Dexie transaction. Any failure rolls back automatically — original data intact.
5. After DB transaction commits, clear OPFS `media/` and write new blobs.
6. Force lock — user re-enters passcode.

### Cross-device restore
Works if both devices use the same passcode. The backup includes the salt and the wrapped DEKs, so `PBKDF2(passcode, salt) → KEK → unwrap DEK` produces the same DEK on both devices.

### Auto rolling local snapshots (B1, 1.13.0)
After every save, `BackupService.scheduleSnapshot()` debounces 5 min, then writes a snapshot row to `backupSnapshots` (capped at 1/day, max 3 rows kept). Snapshots are full backup blobs sitting in IndexedDB. Restorable from `/backups`. Independent of file-based exports.

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
| 1 | Timeline (month groups, mood emoji, text preview), entry CRUD, TipTap rich text editor, neon black theme |
| 2 | OPFS service, media attach (photo + video), image compression (2048px), video validation (50MB/30s), thumbnail generation, lightbox, storage quota warning |
| 3 | CryptoService (AES-GCM + PBKDF2), VaultService (in-memory key, passcode setup/unlock, verifier), EntryService (encrypt/decrypt layer), lock screen UI, auto-lock 2min, all routes guarded |
| 4 | SearchService (inverted index, prefix match), TagService (CRUD), Settings page, tag picker in entry-edit, tag chips on timeline + detail, search bar with debounce, "Edited X ago" on entry-detail |
| 5 | ExportService, encrypted backup download (.diarybackup), backup restore (cross-device), iOS share sheet integration |
| 6 | Master code "1810" + DEK pattern, transparent v1→v2 migration (1.1.0). PDF export removed (1.0.4) |
| 7 | Calendar view toggle on timeline (1.2.0); audio note recording via MediaRecorder (1.3.0) |
| 8 | Theme system (4 palettes 1.4.0 → simplified to dark/light only 1.7.1; toggle on every header 1.6.0) |
| 9 | Polish cluster — encrypted draft autosave, word count, tag filter, backup reminder, SwUpdate auto-prompt (1.5.0) |
| 10 | On-this-day card, global haptics, PWA install banner, bottom-nav (1.7.0) |
| 11 | Help & About screen + ⓘ in every header (1.8.0–1.8.1); signature watermark + neon screen frame (1.8.2–1.10.0) |
| 12 | Trash recycle bin with 30-day auto-purge (1.9.0) |
| 13 | Data integrity hardening — Phase D: validate-before-clear import + sha256, atomic save, DB-first media write, orphan reaper, persistent-storage request, crash-safe DEK migration, trash safety guards (1.12.0) |
| 14 | Auto rolling local backups + Phase P perf — decrypted-entry cache, parallel thumbnails, persistent search index, parallel media prepare, OPFS dir handle cache, computed calendar (1.13.0) |

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
| 1.10.0 | 2026-05-08 | style: neon screen frame on every route. body::after fixed-position overlay with 1.5px pink border, rounded corners, inset glow + outer glow, 4s pulse. z-index 15 so bottom-nav (20) and signature (999) sit above |
| 1.11.0 | 2026-05-08 | feat: global haptic feedback on every tap. App-level click listener fires HapticService.tap on button/[role=button]/a/label clicks. data-no-haptic attr opts out. Settings toggle to disable (persisted in localStorage) |
| 1.12.0 | 2026-05-08 | feat: data integrity hardening (Phase D). Backup import validates structure + sha256 BEFORE clearing DB; clears + bulkPuts wrapped in Dexie transaction. Save in entry-edit is now atomic via EntryService.saveAtomic with single transaction. Media write order reversed: DB record first, then OPFS (rolls back DB on OPFS failure). MediaService.reapOrphans + OpfsService.listFiles cleans up stranded blobs daily on timeline boot. StorageService.ensurePersisted called on unlock + setup; banner on timeline if browser denies persistent storage. DEK migration wraps re-encryption in transaction with migrationInProgress flag for crash detection on next unlock. Trash purgeExpired adds clock-skew guard, 1-hour debounce, 24h TTL margin, last-100 purge audit log |
| 1.13.0 | 2026-05-08 | feat: auto rolling backups (B1) + perf at scale (Phase P). New BackupService stores last 3 encrypted snapshots in IDB (Dexie v4 backupSnapshots table); auto-snapshot debounced ≤1/day after every save; /backups route + Settings link with Snapshot Now / Restore / Delete. P1: EntryService caches decrypted entries by updatedAt (cleared on lock via signal effect). P2: timeline thumbnails fan out to a 6-way concurrency pool with progressive UI updates. P3: persistent search index in Dexie v5 searchTokens table (`*tokens` multi-entry index); SearchService.ensureIndex syncs incrementally on each timeline load; search() now async via Dexie startsWith. P4: media prepare in entry-edit save runs concurrency=3 (30 photos ≈ 30s instead of 4 min). P5: OpfsService caches resolved directory handles (cleared after import). P6: calendarCells converted to computed signal so it doesn't recalc on every CD cycle |
| 1.13.1 | 2026-05-08 | fix: TS2769 in SearchService.search/searchSync — `[...result]` narrowed to `never[]`. Add explicit `Set<string>` cast |
| 1.13.2 | 2026-05-08 | docs: refresh NOTES.md + README.md to reflect every feature shipped through 1.13.x. No code changes |

---

## Future Improvements

### High value
- **Passcode change** — keep DEK, re-derive KEK_user from new passcode, re-wrap dekWrappedUser. Avoids re-encrypting entries (just rewrap the DEK). Master code "1810" path is unaffected.
- **Optimistic concurrency on entry update (D7 deferred)** — read updatedAt before write; throw on mismatch so a second tab's edit isn't silently overwritten.
- **Search highlights** — surface matched snippet from `bodyText` in search results.
- **Search in body HTML** — currently searches plaintext only. Could index TipTap HTML stripped to attribute-aware tokens.

### Medium value
- **Pinch-to-zoom on lightbox** — Pointer Events tracking, no third-party dep.
- **Drag-to-reorder media** within an entry.
- **Entry templates** — save a blank entry structure (gratitude list, daily log) and clone.
- **Storage dashboard in Settings** — show used MB / quota %, list largest media items.
- **Streak counter** — days with at least one entry.
- **Bundle split** — TipTap (~200KB) imported on `entry-edit` lazy chunk only; verify it's not in the lock-screen chunk.

### Low value / nice-to-have
- **iCloud sync** — would require CloudKit or a server. Breaks the no-backend constraint.
- **Biometric unlock** — WebAuthn PRF on iOS 16+. Complex.
- **Markdown import** — parse `.md` files into TipTap HTML on import.
- **HMAC-encrypted search tokens** — currently tokens are plaintext (same trade-off as Tag.name). HMAC under the DEK gets encryption-at-rest without giving up prefix search.
- **"What's New" — surface latest Patch Log entry in-app on first open after update.

---

## Gotchas for Future Dev

- `StoredEntry` vs `Entry` — **never** pass `StoredEntry` to UI components. Always go through `EntryService` which returns `Entry` (plaintext).
- Dexie `update()` TypeScript constraint: `UpdateSpec<T>` is strict. Encrypted fields (type `EncryptedField`) clash with the spec type. Use `as any` cast when needed.
- `@tiptap/angular` does not exist. TipTap is used via `@tiptap/core` with a raw `ElementRef` in `EditorComponent`.
- Angular 17 application builder outputs to `dist/diary/browser/`, not `dist/diary/`. The GitHub Actions deploy.yml targets `dist/diary/browser`.
- `base-href /diary/` must be passed at build time: `ng build -- --base-href /diary/`. Local dev uses `/`.
- `navigator.share({ files })` requires a user gesture. Do not call after `await import(...)` — import is not a microtask and breaks the gesture context on iOS.
- OPFS not available in Firefox private browsing and some browser contexts. OpfsService will throw; MediaService catches and skips.
