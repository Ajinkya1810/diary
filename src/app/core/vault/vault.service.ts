import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { DbService } from '../db/db.service';
import { CryptoService } from '../crypto/crypto.service';

@Injectable({ providedIn: 'root' })
export class VaultService {
  private key: CryptoKey | null = null;

  constructor(
    private db: DbService,
    private crypto: CryptoService,
    private router: Router,
  ) {}

  async isInitialized(): Promise<boolean> {
    const meta = await this.db.vaultMeta.get('singleton');
    return !!meta;
  }

  async setupPasscode(passcode: string): Promise<void> {
    const salt = this.crypto.generateSalt();
    const key = await this.crypto.deriveKey(passcode, salt);
    const verifier = await this.crypto.encryptString(key, 'DIARY_VERIFIER_V1');

    await this.db.vaultMeta.put({
      id: 'singleton',
      salt,
      verifierIv: verifier.iv,
      verifierCt: verifier.ct,
    });

    this.key = key;
  }

  async unlock(passcode: string): Promise<boolean> {
    const meta = await this.db.vaultMeta.get('singleton');
    if (!meta) return false;
    try {
      const key = await this.crypto.deriveKey(passcode, meta.salt);
      // Throws if wrong passcode
      await this.crypto.decryptString(key, { iv: meta.verifierIv, ct: meta.verifierCt });
      this.key = key;
      return true;
    } catch {
      return false;
    }
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
