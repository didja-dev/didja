/**
 * Encryption at rest (SCR-101): AES-256-GCM for the columns that hold screen text — observation
 * text, the lines kept around open tasks (`task_context.lines`), and an email task's note (its
 * sender and subject). Node's built-in crypto, no dependency.
 *
 * A sealed value is "enc1:" + base64(nonce 12 bytes | ciphertext | tag 16 bytes): the same layout
 * as CryptoKit's `AES.GCM.SealedBox.combined`, so the app and the engine read each other's values.
 *
 * The key is made by the app and kept in your login Keychain; the app hands it to the engine it
 * starts, in the environment (`DIDJA_DB_KEY`, base64). It is never written to disk by Didja.
 * Without the key (an engine started from a terminal), a sealed value reads as nothing: never
 * guessed, never overwritten.
 */
import { chmodSync, existsSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const SEALED_PREFIX = 'enc1:';

/** The key the app handed over, or null. Anything but 32 bytes of base64 is no key. */
export function keyFromEnv(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.DIDJA_DB_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

export function seal(text: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return SEALED_PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
}

/**
 * The text of a value: as it is when it was never sealed, opened when it was. Null when it is
 * sealed and there is no key, or the key is not the one it was sealed with (fail closed).
 */
export function unseal(value: string, key: Buffer | null): string | null {
  if (!isSealed(value)) return value;
  if (!key) return null;
  try {
    const raw = Buffer.from(value.slice(SEALED_PREFIX.length), 'base64');
    if (raw.length < 28) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Only you can read Didja's folder and files: 0700 on the folder, 0600 on the database and logs. */
export function tightenModes(dir: string): void {
  try {
    if (existsSync(dir)) chmodSync(dir, 0o700);
    for (const name of ['didja.db', 'didja.db-wal', 'didja.db-shm', 'shell.log', 'agent-hooks.jsonl', 'mcp-log.jsonl']) {
      const path = join(dir, name);
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  } catch {
    // Not ours to change (a test folder, another owner): leave it.
  }
}
