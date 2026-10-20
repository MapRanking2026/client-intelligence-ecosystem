/**
 * Publish named prompts from src/prompts/mtos-prompts.json into Firestore,
 * leaving every other prompt in the Prompt Engine untouched.
 *
 * `npm run import:prompts` republishes the WHOLE library and prunes anything the
 * JSON no longer carries, so it silently discards edits made through the Prompt
 * Engine UI since the last import. Use this instead when a change touches only a
 * few modules:
 *
 *   npm run publish:prompts -- monthly_touch_preparation_prompt
 *   npm run publish:prompts -- monthly_touch_preparation_prompt meeting_structure_run_sheet_prompt
 *   npm run publish:prompts -- --dry-run monthly_touch_preparation_prompt
 *   npm run publish:prompts -- --note "MT prep refresh" monthly_touch_preparation_prompt
 *
 * It writes through the store's own single-prompt path (savePromptRecord), so each
 * key lands exactly as a UI save would: one document, the version bumped, the
 * previous state snapshotted into history and rollback-able from
 * Settings → Prompt Engine. A key absent from Firestore is created from the
 * bundled library first, via the store's lazy-publish read.
 *
 * Requires FIREBASE_* credentials in .env. A dry run only reads, and a key whose
 * stored content already matches the JSON is reported and skipped.
 */
import fs from "fs";
import path from "path";

import { loadEnvConfig } from "@next/env";

// Type-only: erased at compile time, so the store is still loaded after the env is.
import type { PromptPatch } from "../src/lib/server/prompt-store";

/** The fields the Prompt Engine treats as editable -- `key` is the runtime binding. */
const PUBLISHED_FIELDS = [
  "title",
  "role",
  "prompt",
  "description",
  "provider",
  "difficulty",
  "runtimeContract",
  "workflows",
] as const;

type PublishedField = (typeof PUBLISHED_FIELDS)[number];
type BundledPrompt = Record<string, unknown> & { key: string };
type BundledPhase = { phase: string; prompts: BundledPrompt[] };

function parseArgs(argv: string[]) {
  const keys: string[] = [];
  let dryRun = false;
  let note: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
    } else if (arg === "--note") {
      note = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      keys.push(arg);
    }
  }

  return { keys, dryRun, note };
}

/**
 * The patch payload for one key: every editable field the JSON defines. The cast
 * carries the JSON's untyped values into PromptPatch; validatePromptDraft below is
 * what actually guards the content before anything is written.
 */
function publishedPatch(prompt: BundledPrompt): PromptPatch {
  const patch: Record<string, unknown> = {};
  for (const field of PUBLISHED_FIELDS) {
    if (prompt[field] !== undefined) patch[field] = prompt[field];
  }
  return patch as PromptPatch;
}

/** Which editable fields differ between the stored prompt and the bundled one. */
function changedFields(stored: Record<string, unknown>, patch: PromptPatch): PublishedField[] {
  return (Object.keys(patch) as PublishedField[]).filter(
    (field) => JSON.stringify(stored[field] ?? null) !== JSON.stringify(patch[field] ?? null),
  );
}

async function main() {
  loadEnvConfig(process.cwd());

  const { keys, dryRun, note } = parseArgs(process.argv.slice(2));

  // Imported after env is loaded so getFirebaseAdminDb() sees the credentials.
  const { getPrompts, getPromptRecord, savePromptRecord, validatePromptDraft } = await import(
    "../src/lib/server/prompt-store"
  );
  const { getFirebaseAdminDb } = await import("../src/lib/server/firebase/admin");

  const file = path.join(process.cwd(), "src", "prompts", "mtos-prompts.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as BundledPhase[];
  const bundled = new Map<string, BundledPrompt>();
  for (const phase of config) {
    for (const prompt of phase.prompts || []) bundled.set(prompt.key, prompt);
  }

  if (!keys.length) {
    console.error("Name at least one prompt key to publish.\n");
    console.error("  npm run publish:prompts -- <key> [<key> ...] [--dry-run] [--note \"why\"]\n");
    console.error(`Keys in the bundled library (${bundled.size}):`);
    for (const phase of config) {
      console.error(`  ${phase.phase}`);
      for (const prompt of phase.prompts || []) console.error(`    ${prompt.key}`);
    }
    process.exitCode = 1;
    return;
  }

  const unknown = keys.filter((key) => !bundled.has(key));
  if (unknown.length) {
    throw new Error(
      `Not in src/prompts/mtos-prompts.json: ${unknown.join(", ")}. ` +
        "Add the prompt to the bundled library first, or check the spelling.",
    );
  }

  if (!getFirebaseAdminDb()) {
    throw new Error(
      "Firestore is not configured. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env.",
    );
  }

  // Validate every key before writing any of them, so a bad draft can't leave the
  // library half-published.
  for (const key of keys) {
    const prompt = bundled.get(key)!;
    const errors = validatePromptDraft({
      prompt: prompt.prompt as string | undefined,
      runtimeContract: prompt.runtimeContract as string | undefined,
      title: prompt.title as string | undefined,
    }).filter((issue) => issue.level === "error");
    if (errors.length) {
      throw new Error(`${key} is not publishable:\n  ${errors.map((e) => e.message).join("\n  ")}`);
    }
  }

  console.log(
    `${dryRun ? "Dry run:" : "Publishing"} ${keys.length} prompt${keys.length === 1 ? "" : "s"} ` +
      `to Firestore. Every other prompt is left as it is.\n`,
  );

  // Read the whole library once rather than per key. getPromptRecord would be the
  // obvious call, but it lazily PUBLISHES a key that Firestore is missing -- which
  // would make a dry run write. This path only ever reads (bar the store's own
  // first-run seed of an empty database), so --dry-run is honestly read-only.
  const stored = new Map<string, { version: number; fields: Record<string, unknown> }>();
  for (const phase of await getPrompts()) {
    for (const prompt of phase.prompts) {
      stored.set(prompt.key, {
        version: prompt.version,
        fields: prompt as unknown as Record<string, unknown>,
      });
    }
  }

  let written = 0;
  let skipped = 0;

  for (const key of keys) {
    const prompt = bundled.get(key)!;
    const patch = publishedPatch(prompt);
    const current = stored.get(key);

    if (!current) {
      if (dryRun) {
        console.log(`  → ${key} — not in Firestore yet, would be created at v1`);
        written += 1;
        continue;
      }
      // savePromptRecord patches an existing document, so publish the bundled copy
      // first. The store's own read does exactly that for a key added to the library
      // after the initial seed.
      if (!(await getPromptRecord(key))) {
        throw new Error(`Couldn't create "${key}" in Firestore.`);
      }
      console.log(`  + ${key} — created from the bundled library`);
      written += 1;
      continue;
    }

    const changed = changedFields(current.fields, patch);
    if (!changed.length) {
      console.log(`  = ${key} — already matches the bundled library at v${current.version}, skipped`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  → ${key} — would go v${current.version} → v${current.version + 1} (${changed.join(", ")})`);
      written += 1;
      continue;
    }

    const saved = await savePromptRecord(key, patch, note || "Published from the bundled library");
    console.log(`  ✓ ${key} — v${current.version} → v${saved.version} (${changed.join(", ")})`);
    written += 1;
  }

  const verb = dryRun ? "would be published" : "published";
  console.log(
    `\nDone. ${written} ${verb}, ${skipped} unchanged.` +
      (dryRun ? " Nothing was written." : " Roll back any of them from Settings → Prompt Engine."),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
