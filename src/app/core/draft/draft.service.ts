import { Injectable } from '@angular/core';
import { CryptoService, EncryptedField } from '../crypto/crypto.service';
import { VaultService } from '../vault/vault.service';

export interface DraftPayload {
  title: string;
  date: string;
  bodyHtml: string;
  bodyText: string;
  mood: number | null;
  tagIds: string[];
  ts: number;
}

const KEY_PREFIX = 'diary.draft.';

@Injectable({ providedIn: 'root' })
export class DraftService {
  constructor(private crypto: CryptoService, private vault: VaultService) {}

  async save(slot: string, data: DraftPayload): Promise<void> {
    const key = this.vault.getKey();
    if (!key) return;
    const enc = await this.crypto.encryptString(key, JSON.stringify(data));
    const wire = { iv: this.b64(enc.iv), ct: this.b64(enc.ct) };
    try { localStorage.setItem(KEY_PREFIX + slot, JSON.stringify(wire)); } catch { /* quota */ }
  }

  async load(slot: string): Promise<DraftPayload | null> {
    const key = this.vault.getKey();
    if (!key) return null;
    const raw = localStorage.getItem(KEY_PREFIX + slot);
    if (!raw) return null;
    try {
      const wire = JSON.parse(raw) as { iv: string; ct: string };
      const field: EncryptedField = { iv: this.fromB64(wire.iv), ct: this.fromB64(wire.ct) };
      const json = await this.crypto.decryptString(key, field);
      return JSON.parse(json) as DraftPayload;
    } catch {
      // corrupt or wrong key — discard
      this.clear(slot);
      return null;
    }
  }

  clear(slot: string): void {
    try { localStorage.removeItem(KEY_PREFIX + slot); } catch { /* ignore */ }
  }

  private b64(u8: Uint8Array): string {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  private fromB64(s: string): Uint8Array {
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  }
}
