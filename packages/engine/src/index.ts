/**
 * @cie/engine — the Client Intelligence Engine. The single source of truth for
 * client data in the Client Intelligence Ecosystem: a canonical client store, an
 * ingest+reconcile engine, and the service apps read client truth through. No
 * secrets, no Firebase init (the store's Firestore is injected by the app).
 */
export { ClientEngine } from "./service";
export {
  type ClientEngineStore,
  InMemoryClientStore,
  FirestoreClientStore,
} from "./repo";
export { SupabaseClientStore } from "./supabase-repo";
export { reconcileClients, clientKey, type ReconcileResult } from "./reconcile";
