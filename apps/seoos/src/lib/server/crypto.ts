import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * AES-256-GCM encryption for stored integration credentials. Plaintext secrets
 * are NEVER persisted or returned to the browser — only this ciphertext is
 * stored, and decryption happens server-side at call time.
 */
function deriveKey(): Buffer {
  const secret = getServerEnv().integrationsEncryptionSecret;
  if (!secret) {
    throw new Error(
      "Integrations encryption secret missing (set SEOOS_INTEGRATIONS_SECRET or SESSION_COOKIE_SECRET).",
    );
  }
  return scryptSync(secret, "seoos-integrations-v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(ciphertext: string): string {
  const [ivB, tagB, dataB] = ciphertext.split(".");
  if (!ivB || !tagB || !dataB) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T = Record<string, string>>(ciphertext: string): T {
  return JSON.parse(decryptSecret(ciphertext)) as T;
}
