import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for SEOOS credential login. scrypt with a per-user random
 * salt. Only the salt + derived hash are ever stored — never the plaintext.
 */
const KEYLEN = 64;

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, useSalt, KEYLEN).toString("hex");
  return { salt: useSalt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(password, salt, KEYLEN);
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
