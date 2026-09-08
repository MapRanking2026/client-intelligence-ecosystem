import { createClient } from "@supabase/supabase-js";
import {
  FirestoreClientStore,
  InMemoryClientStore,
  SupabaseClientStore,
  type ClientEngineStore,
} from "@cie/engine";

import { getEngineFirebaseDb, getEngineProjectId } from "@/src/lib/server/firebase/engine-admin";

/**
 * Select the shared Client Intelligence Engine store. Preference order:
 *   1. Supabase (Postgres) — the neutral shared home — when ENGINE_SUPABASE_* is set.
 *   2. A dedicated Firebase project (ENGINE_FIREBASE_*), else this app's own Firestore.
 *   3. In-memory (local dev with no persistence).
 * The store is a swappable adapter behind ClientEngineStore, so the engine, the
 * reconcile logic, and both apps stay identical regardless of the backend.
 */
let store: ClientEngineStore | null = null;

export function getEngineStore(): ClientEngineStore {
  if (store) return store;

  const url = process.env.ENGINE_SUPABASE_URL;
  const serviceKey = process.env.ENGINE_SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    store = new SupabaseClientStore(createClient(url, serviceKey, { auth: { persistSession: false } }));
    return store;
  }

  const db = getEngineFirebaseDb();
  store = db ? new FirestoreClientStore(db) : new InMemoryClientStore();
  return store;
}

/** Human-readable label for the active engine store (for the admin UI/report). */
export function getEngineStoreLabel(): string {
  const url = process.env.ENGINE_SUPABASE_URL;
  if (url) {
    try {
      return `supabase:${new URL(url).host}`;
    } catch {
      return "supabase";
    }
  }
  const projectId = getEngineProjectId();
  return projectId ? `firebase:${projectId}` : "in-memory";
}
