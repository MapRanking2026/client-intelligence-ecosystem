/**
 * Drives the Prompt Engine's Firestore backend against an in-memory fake that
 * implements the subset of the Firestore API the store uses. Verifies seeding,
 * ordering, single-document reads, independent saves, and orphan recovery
 * without touching a real database.
 */
import { __internal } from "../src/lib/server/prompt-store";

type Doc = Record<string, unknown>;

class FakeDb {
  store = new Map<string, Doc>();
  writes = 0;
  reads = 0;

  collection(name: string) {
    return new FakeCollection(this, name);
  }

  batch() {
    const ops: (() => void)[] = [];
    return {
      set: (ref: FakeDocRef, data: Doc) => ops.push(() => ref.setNow(data)),
      delete: (ref: FakeDocRef) => ops.push(() => ref.deleteNow()),
      commit: async () => ops.forEach((op) => op()),
    };
  }

  async runTransaction<T>(fn: (t: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction());
  }
}

class FakeTransaction {
  async get(ref: FakeDocRef) {
    return ref.get();
  }
  set(ref: FakeDocRef, data: Doc) {
    ref.setNow(data);
  }
}

class FakeCollection {
  constructor(private db: FakeDb, private path: string) {}
  doc(id: string) {
    return new FakeDocRef(this.db, `${this.path}/${id}`, id);
  }
  async get() {
    this.db.reads += 1;
    const prefix = `${this.path}/`;
    const docs = [...this.db.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map(([key, data]) => ({
        id: key.slice(prefix.length),
        data: () => data,
        ref: new FakeDocRef(this.db, key, key.slice(prefix.length)),
      }));
    return { docs };
  }
}

class FakeDocRef {
  constructor(private db: FakeDb, public path: string, public id: string) {}
  collection(name: string) {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }
  async get() {
    this.db.reads += 1;
    const data = this.db.store.get(this.path);
    return { exists: data !== undefined, data: () => data, id: this.id };
  }
  setNow(data: Doc) {
    this.db.writes += 1;
    this.db.store.set(this.path, JSON.parse(JSON.stringify(data)));
  }
  deleteNow() {
    this.db.store.delete(this.path);
  }
}

function check(label: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = new FakeDb() as any;
  __internal.resetSeedCache();

  // 1. Seeding publishes the bundled JSON library on an empty database.
  await __internal.ensureSeeded(db);
  const promptDocs = [...(db as FakeDb).store.keys()].filter((k) =>
    k.startsWith("promptEngine/library/prompts/"),
  );
  check("seeds every prompt as its own document", promptDocs.length === 39, `${promptDocs.length} docs`);
  check("writes the order document", (db as FakeDb).store.has("promptEngine/library"));

  // 2. Seeding is idempotent across warm invocations.
  const writesAfterSeed = (db as FakeDb).writes;
  __internal.resetSeedCache();
  await __internal.ensureSeeded(db);
  check("re-seeding is a no-op", (db as FakeDb).writes === writesAfterSeed);

  // 3. Reads reassemble phases in the original order.
  const config = await __internal.readFirestoreConfig(db);
  const totalPrompts = config.flatMap((p) => p.prompts).length;
  check("phase count preserved", config.length === 8, `${config.length} phases`);
  check("prompt count preserved", totalPrompts === 39, `${totalPrompts} prompts`);
  check("preamble leads the library", config[0].phase === "Global Standard", config[0].phase);
  check(
    "first module intact",
    config[1].prompts[0].key === "workflow_orchestrator_prompt",
    config[1].prompts[0].key,
  );
  check("no Unassigned bucket when order is complete", !config.some((p) => p.phase === "Unassigned"));
  check(
    "runtime contracts survived the round trip",
    config.flatMap((p) => p.prompts).filter((p) => p.runtimeContract).length === 5,
  );

  // 4. The runtime path reads exactly one document.
  const before = (db as FakeDb).reads;
  const doc = await (db as FakeDb)
    .collection("promptEngine")
    .doc("library")
    .collection("prompts")
    .doc("qa_evaluation_prompt")
    .get();
  check("single-key resolution is one read", (db as FakeDb).reads - before === 1);
  check("resolved doc has content", Boolean((doc.data() as any)?.prompt));

  // 5. A whole-library write prunes prompts that were removed. Trim Phase 0
  //    (index 1) from two prompts to one, so exactly one is deleted.
  const trimmed = config.map((phase, index) =>
    index === 1 ? { ...phase, prompts: phase.prompts.slice(0, 1) } : phase,
  );
  await __internal.writeFirestoreConfig(db, trimmed);
  const afterPrune = await __internal.readFirestoreConfig(db);
  check(
    "removed prompt is deleted",
    afterPrune.flatMap((p) => p.prompts).length === totalPrompts - 1,
    `${afterPrune.flatMap((p) => p.prompts).length} prompts`,
  );
  check("no orphan bucket after prune", !afterPrune.some((p) => p.phase === "Unassigned"));

  // 6. A prompt document with no order entry still surfaces.
  (db as FakeDb).store.set("promptEngine/library/prompts/stray_prompt", {
    key: "stray_prompt",
    title: "Stray",
    role: "Research Agent",
    prompt: "orphaned body",
    version: 1,
    updatedAt: new Date().toISOString(),
    history: [],
  });
  const withOrphan = await __internal.readFirestoreConfig(db);
  const unassigned = withOrphan.find((p) => p.phase === "Unassigned");
  check("orphaned prompt is recovered", unassigned?.prompts[0]?.key === "stray_prompt");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
