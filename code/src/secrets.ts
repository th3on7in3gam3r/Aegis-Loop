import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

/**
 * Encrypt secrets (e.g. GitHub OAuth tokens) before they are written to
 * Postgres or disk. AES-256-GCM; the key comes from TOKEN_ENCRYPTION_KEY,
 * or is derived from SESSION_SECRET when that isn't set.
 *
 * Values that aren't in the `enc:v1:` format are treated as legacy plaintext
 * and returned unchanged, so existing records keep working and get encrypted
 * on their next write.
 */

const PREFIX = 'enc:v1:';

function key(): Buffer {
  const material = process.env.TOKEN_ENCRYPTION_KEY || `${config.sessionSecret}:token-encryption`;
  return createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

/** Throws if the value was encrypted with a different key or was tampered with. */
export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split('.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
