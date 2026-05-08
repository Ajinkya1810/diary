import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DbService, VaultMeta } from '../db/db.service';
import { CryptoService } from '../crypto/crypto.service';
import { OpfsService } from '../media/opfs.service';

const MASTER_CODE = '1810';
const VERIFIER_V2 = 'DIARY_VERIFIER_V2';

@Injectable({ providedIn: 'root' })
export class VaultService {
  private key: CryptoKey | null = null;
  migrating = signal(false);

  constructor(
    private db: DbService,
    private crypto: CryptoService,
    private opfs: OpfsService,
    private router: Router,
  ) {}

  async isInitialized(): Promise<boolean> {
    const meta = await this.db.vaultMeta.get('singleton');
    return !!meta;
  }

  async setupPasscode(passcode: string): Promise<void> {
    const dekRaw = crypto.getRandomValues(new Uint8Array(32));
    const dek = await this.importAesKey(dekRaw);

    const saltUser = this.crypto.generateSalt();
    const kekUser = await this.crypto.deriveKey(passcode, saltUser);
    const dekWrappedUser = await this.crypto.encrypt(kekUser, dekRaw.buffer as ArrayBuffer);

    const saltMaster = this.crypto.generateSalt();
    const kekMaster = await this.crypto.deriveKey(MASTER_CODE, saltMaster);
    const dekWrappedMaster = await this.crypto.encrypt(kekMaster, dekRaw.buffer as ArrayBuffer);

    const verifier = await this.crypto.encryptString(dek, VERIFIER_V2);

    await this.db.vaultMeta.put({
      id: 'singleton',
      salt: saltUser,
      saltMaster,
      dekWrappedUser,
      dekWrappedMaster,
      verifierIv: verifier.iv,
      verifierCt: verifier.ct,
      format: 'v2',
    });

    this.key = dek;
  }

  async unlock(passcode: string): Promise<boolean> {
    const meta = await this.db.vaultMeta.get('singleton');
    if (!meta) return false;

    if (meta.format === 'v2' && meta.dekWrappedUser && meta.dekWrappedMaster && meta.saltMaster) {
      return this.unlockV2(passcode, meta);
    }
    return this.unlockLegacyAndMigrate(passcode, meta);
  }

  private async unlockV2(passcode: string, meta: VaultMeta): Promise<boolean> {
    const dek = await this.tryUnwrapDek(passcode, meta);
    if (!dek) return false;
    this.key = dek;
    return true;
  }

  private async tryUnwrapDek(passcode: string, meta: VaultMeta): Promise<CryptoKey | null> {
    // Try user passcode first
    try {
      const kek = await this.crypto.deriveKey(passcode, meta.salt);
      const dekRaw = await this.crypto.decrypt(kek, meta.dekWrappedUser!);
      return this.importAesKey(new Uint8Array(dekRaw));
    } catch { /* fall through */ }
    // Try master code
    try {
      const kek = await this.crypto.deriveKey(passcode, meta.saltMaster!);
      const dekRaw = await this.crypto.decrypt(kek, meta.dekWrappedMaster!);
      return this.importAesKey(new Uint8Array(dekRaw));
    } catch {
      return null;
    }
  }

  private async unlockLegacyAndMigrate(passcode: string, meta: VaultMeta): Promise<boolean> {
    let oldKey: CryptoKey;
    try {
      oldKey = await this.crypto.deriveKey(passcode, meta.salt);
      // Verify with V1 verifier — throws if wrong passcode
      await this.crypto.decryptString(oldKey, { iv: meta.verifierIv, ct: meta.verifierCt });
    } catch {
      return false;
    }

    this.migrating.set(true);
    try {
      await this.migrateV1ToV2(oldKey, passcode);
      return true;
    } finally {
      this.migrating.set(false);
    }
  }

  private async migrateV1ToV2(oldKey: CryptoKey, passcode: string): Promise<void> {
    const dekRaw = crypto.getRandomValues(new Uint8Array(32));
    const dek = await this.importAesKey(dekRaw);

    // Re-encrypt entries
    const entries = await this.db.entries.toArray();
    for (const e of entries) {
      const titlePlain = await this.crypto.decryptString(oldKey, e.title);
      const bodyHtmlPlain = await this.crypto.decryptString(oldKey, e.bodyHtml);
      const bodyTextPlain = await this.crypto.decryptString(oldKey, e.bodyText);
      await this.db.entries.update(e.id, {
        title: await this.crypto.encryptString(dek, titlePlain),
        bodyHtml: await this.crypto.encryptString(dek, bodyHtmlPlain),
        bodyText: await this.crypto.encryptString(dek, bodyTextPlain),
      } as any);
    }

    // Re-encrypt media (thumbnails in DB + blobs in OPFS)
    const mediaRecords = await this.db.media.toArray();
    for (const r of mediaRecords) {
      const thumbPlain = await this.crypto.decryptToBlob(oldKey, r.thumbnailData);
      await this.db.media.update(r.id, {
        thumbnailData: await this.crypto.encryptBlob(dek, thumbPlain),
      } as any);
      try {
        const oldBlob = await this.opfs.readBlob(r.opfsPath);
        const decrypted = await this.crypto.decryptFromBinary(oldKey, oldBlob, r.mimeType);
        const reencrypted = await this.crypto.encryptToBinary(dek, decrypted);
        await this.opfs.writeBlob(r.opfsPath, reencrypted);
      } catch { /* skip missing blob */ }
    }

    // Wrap DEK with KEK_user (reuse existing salt) and KEK_master (new salt)
    const existingMeta = await this.db.vaultMeta.get('singleton');
    const saltUserBytes = existingMeta!.salt;
    const kekUser = await this.crypto.deriveKey(passcode, saltUserBytes);
    const dekWrappedUser = await this.crypto.encrypt(kekUser, dekRaw.buffer as ArrayBuffer);

    const saltMasterBytes = this.crypto.generateSalt();
    const kekMaster = await this.crypto.deriveKey(MASTER_CODE, saltMasterBytes);
    const dekWrappedMaster = await this.crypto.encrypt(kekMaster, dekRaw.buffer as ArrayBuffer);

    const verifier = await this.crypto.encryptString(dek, VERIFIER_V2);

    await this.db.vaultMeta.put({
      id: 'singleton',
      salt: saltUserBytes,
      saltMaster: saltMasterBytes,
      dekWrappedUser,
      dekWrappedMaster,
      verifierIv: verifier.iv,
      verifierCt: verifier.ct,
      format: 'v2',
    });

    this.key = dek;
  }

  private async importAesKey(raw: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  lock(): void {
    this.key = null;
    this.router.navigate(['/lock']);
  }

  getKey(): CryptoKey | null {
    return this.key;
  }

  requireKey(): CryptoKey {
    if (!this.key) throw new Error('Vault is locked');
    return this.key;
  }
}
