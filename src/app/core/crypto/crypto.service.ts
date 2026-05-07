import { Injectable } from '@angular/core';

export interface EncryptedField {
  iv: Uint8Array;
  ct: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class CryptoService {

  generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  async deriveKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
    const raw = new TextEncoder().encode(passcode);
    const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async encrypt(key: CryptoKey, data: ArrayBuffer): Promise<EncryptedField> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv, ct: new Uint8Array(ct) };
  }

  async decrypt(key: CryptoKey, field: EncryptedField): Promise<ArrayBuffer> {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: field.iv }, key, field.ct);
  }

  async encryptString(key: CryptoKey, str: string): Promise<EncryptedField> {
    return this.encrypt(key, new TextEncoder().encode(str).buffer as ArrayBuffer);
  }

  async decryptString(key: CryptoKey, field: EncryptedField): Promise<string> {
    const buf = await this.decrypt(key, field);
    return new TextDecoder().decode(buf);
  }

  async encryptBlob(key: CryptoKey, blob: Blob): Promise<EncryptedField> {
    return this.encrypt(key, await blob.arrayBuffer());
  }

  async decryptToBlob(key: CryptoKey, field: EncryptedField, mimeType = 'application/octet-stream'): Promise<Blob> {
    const buf = await this.decrypt(key, field);
    return new Blob([buf], { type: mimeType });
  }

  // OPFS wire format: 12-byte IV prepended to ciphertext
  async encryptToBinary(key: CryptoKey, blob: Blob): Promise<Blob> {
    const { iv, ct } = await this.encryptBlob(key, blob);
    return new Blob([iv, ct]);
  }

  async decryptFromBinary(key: CryptoKey, blob: Blob, mimeType: string): Promise<Blob> {
    const buf = await blob.arrayBuffer();
    const iv = new Uint8Array(buf, 0, 12);
    const ct = new Uint8Array(buf, 12);
    return this.decryptToBlob(key, { iv, ct }, mimeType);
  }
}
