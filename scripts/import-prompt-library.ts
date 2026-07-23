/**
 * Publish src/prompts/mtos-prompts.json into Firestore, overwriting the current
 * Prompt Engine library.
 *
 * The app self-seeds Firestore from this JSON only when the collection is empty,
 * so once a library exists in Firestore a new bundled version never takes effect
 * on its own. Run this to force the bundled library live:
 *
 *   npm run import:prompts
 *
 * It reuses the store's own write path (savePrompts → Firestore when configured),
 * so the result is byte-identical to what the app would write: one document per
 * prompt, the order document rebuilt, and any prompt removed from the JSON pruned
 * from Firestore. Requires FIREBASE_* credentials in .env.
 */
import fs from "fs";
import path from "path";

import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  // Imported after env is loaded so getFirebaseAdminDb() sees the credentials.
  const { savePrompts, getPrompts } = await import("../src/lib/server/prompt-store");
  const { getFirebaseAdminDb } = await import("../src/lib/server/firebase/admin");

  if (!getFirebaseAdminDb()) {
    throw new Error(
      "Firestore is not configured. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env.",
    );
  }

  const file = path.join(process.cwd(), "src", "prompts", "mtos-prompts.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const phaseCount = config.length;
  const promptCount = config.reduce((total: number, phase: { prompts: unknown[] }) => total + phase.prompts.length, 0);

  console.log(`Publishing ${promptCount} prompts across ${phaseCount} phases to Firestore…`);
  await savePrompts(config);

  // Read back through the store to confirm what actually landed.
  const readBack = await getPrompts();
  const landed = readBack.reduce((total, phase) => total + phase.prompts.length, 0);
  const preamble = readBack.flatMap((phase) => phase.prompts).find((p) => p.key === "global_system_preamble");

  console.log(`Done. Firestore now holds ${landed} prompts across ${readBack.length} phases.`);
  console.log(`Global System Preamble present: ${Boolean(preamble)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
