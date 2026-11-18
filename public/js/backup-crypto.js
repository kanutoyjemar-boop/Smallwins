const BackupCrypto = (() => {
  const FORMAT = 'small-wins-encrypted-backup';
  const VERSION = 1;
  const ITERATIONS = 310000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function cryptoApi() {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error('This browser does not support secure backup encryption.');
    }
    return globalThis.crypto;
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function validatePassphrase(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < 12) {
      throw new Error('Use a backup passphrase with at least 12 characters.');
    }
  }

  async function deriveKey(passphrase, salt, usages) {
    const subtle = cryptoApi().subtle;
    const material = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async function encrypt(data, passphrase) {
    validatePassphrase(passphrase);
    const crypto = cryptoApi();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(data))
    );
    return {
      format: FORMAT,
      version: VERSION,
      kdf: 'PBKDF2-SHA-256',
      iterations: ITERATIONS,
      cipher: 'AES-256-GCM',
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
  }

  function isEncrypted(data) {
    return !!data && data.format === FORMAT;
  }

  async function decrypt(envelope, passphrase) {
    if (!isEncrypted(envelope) || envelope.version !== VERSION
      || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== ITERATIONS
      || envelope.cipher !== 'AES-256-GCM'
      || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string') {
      throw new Error('This is not a supported Small Wins encrypted backup.');
    }
    validatePassphrase(passphrase);
    const crypto = cryptoApi();
    const key = await deriveKey(passphrase, fromBase64(envelope.salt), ['decrypt']);
    let plaintext;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
        key,
        fromBase64(envelope.ciphertext)
      );
    } catch (error) {
      if (error.name === 'OperationError' || error.name === 'DataError') {
        throw new Error('The passphrase is incorrect or the backup file is damaged.');
      }
      throw error;
    }
    try {
      return JSON.parse(decoder.decode(plaintext));
    } catch {
      throw new Error('The decrypted backup is not valid JSON.');
    }
  }

  return { encrypt, decrypt, isEncrypted };
})();

if (typeof module !== 'undefined') module.exports = BackupCrypto;
