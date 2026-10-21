/**
 * Reset the password of an EXISTING SEOOS login user, entirely on this machine.
 * The new password is typed into a hidden prompt — it is never stored in a file,
 * printed, or sent anywhere except as a scrypt hash to Firestore.
 *
 *   npm run reset:password -w apps/seoos -- you@mapranking.com
 *
 * Uses the SAME tenant the app uses: env files are read like Next.js does
 * (.env.local over .env, and the LAST duplicate key wins).
 * Only passwordSalt / passwordHash / mustResetPassword / disabled / updatedAt change.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnv(): void {
  const merged: Record<string, string> = {};
  for (const rel of [".env", ".env.local"]) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      merged[m[1]] = v; // later lines / .env.local win, like Next.js
    }
  }
  for (const [k, v] of Object.entries(merged)) if (process.env[k] === undefined) process.env[k] = v;
}

let pending = "";
function askHidden(question: string): Promise<string> {
  return new Promise((resolveAnswer) => {
    stdout.write(question);
    let value = "";
    const consume = (text: string): boolean => {
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "\r" || ch === "\n") {
          // Keep whatever follows (piped input may deliver several lines at once).
          pending = text.slice(i + (ch === "\r" && text[i + 1] === "\n" ? 2 : 1));
          return true;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
      return false;
    };
    const finish = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      resolveAnswer(value);
    };
    const onData = (buf: Buffer) => {
      if (consume(buf.toString("utf8"))) finish();
    };
    const buffered = pending;
    pending = "";
    if (buffered && consume(buffered)) {
      stdout.write("\n");
      return resolveAnswer(value);
    }
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  loadEnv();
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Usage: npm run reset:password -w apps/seoos -- you@example.com");
  const tenantId = process.env.MTOS_PILOT_TENANT_ID || "map-ranking";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) throw new Error("Firebase admin env vars are missing.");
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });
  }
  const col = getFirestore().collection("tenants").doc(tenantId).collection("seoUsers");
  const snap = await col.where("email", "==", email).limit(1).get();
  if (snap.empty) throw new Error(`No SEOOS user ${email} in tenant "${tenantId}".`);
  console.log(`Resetting ${email} in tenant "${tenantId}".`);
  const pw = await askHidden("New password (min 8 chars): ");
  const again = await askHidden("Repeat new password: ");
  if (pw.length < 8) throw new Error("Password must be at least 8 characters.");
  if (pw !== again) throw new Error("Passwords do not match.");
  const salt = randomBytes(16).toString("hex");
  await snap.docs[0].ref.update({
    passwordSalt: salt,
    passwordHash: scryptSync(pw, salt, 64).toString("hex"),
    mustResetPassword: false,
    disabled: false,
    updatedAt: new Date().toISOString(),
  });
  console.log("Done. Sign in with the new password (and update your keychain entry).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`reset-seoos-password: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
