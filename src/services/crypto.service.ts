import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();
  private readonly ITERATIONS = 100_000;
  private readonly SALT_LENGTH = 16; // 128 bits
  private readonly IV_LENGTH = 12;   // 96 bits for GCM

  // Helper to convert ArrayBuffer to Base64 string
  private bufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  // Helper to convert Base64 string to ArrayBuffer
  private base64ToBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Derives a cryptographic key from a password using PBKDF2
  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      this.textEncoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypts a JSON object and returns a formatted string
  async encrypt(data: object, masterKey: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const key = await this.deriveKey(masterKey, salt);

    const dataString = JSON.stringify(data);
    const encryptedData = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      this.textEncoder.encode(dataString)
    );
    
    // Combine salt, iv, and ciphertext into a single string
    return `${this.bufferToBase64(salt)}.${this.bufferToBase64(iv)}.${this.bufferToBase64(encryptedData)}`;
  }

  // Decrypts a formatted string back to a JSON object
  async decrypt<T>(encryptedString: string, masterKey: string): Promise<T | null> {
    try {
      const parts = encryptedString.split('.');
      if (parts.length !== 3) throw new Error('လိုင်စင်ကီး၏ format မှားယွင်းနေပါသည်');

      const salt = this.base64ToBuffer(parts[0]);
      const iv = this.base64ToBuffer(parts[1]);
      const data = this.base64ToBuffer(parts[2]);

      const key = await this.deriveKey(masterKey, new Uint8Array(salt));

      const decryptedData = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        data
      );

      const decryptedString = this.textDecoder.decode(decryptedData);
      return JSON.parse(decryptedString) as T;
    } catch (error) {
      console.error('လိုင်စင်ကီးအား ကုဒ်ဖြည်ရာတွင် အမှားအယွင်းဖြစ်ပေါ်သည်:', error);
      return null;
    }
  }

  // Hashes a password with a new salt and returns a storable string
  async hashPassword(password: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const key = await this.deriveKey(password, salt);
    // Export the derived key as raw data to be our hash
    const rawKey = await window.crypto.subtle.exportKey('raw', key);
    return `${this.bufferToBase64(salt)}.${this.bufferToBase64(rawKey)}`;
  }

  // Verifies a password against a stored hash (which includes the salt)
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    try {
      const parts = storedHash.split('.');
      if (parts.length !== 2) return false;

      const salt = this.base64ToBuffer(parts[0]);
      const hash = this.base64ToBuffer(parts[1]);

      const key = await this.deriveKey(password, new Uint8Array(salt));
      const rawKey = await window.crypto.subtle.exportKey('raw', key);

      // Constant-time comparison is not strictly necessary here, but good practice.
      // However, a simple buffer comparison is sufficient for this context.
      if (rawKey.byteLength !== hash.byteLength) return false;

      const view1 = new Uint8Array(rawKey);
      const view2 = new Uint8Array(hash);
      for (let i = 0; i < rawKey.byteLength; i++) {
        if (view1[i] !== view2[i]) return false;
      }
      return true;
    } catch (error) {
      console.error("Password verification failed", error);
      return false;
    }
  }
}
