/**
 * @cie/brain — the Client Brain. The single source of truth for client data in
 * the Client Intelligence Ecosystem: a canonical client store, an ingest+
 * reconcile engine, and the service apps read client truth through. No secrets,
 * no Firebase init (the store's Firestore is injected by the app).
 */
export { ClientBrain } from "./service";
export {
  type ClientBrainStore,
  InMemoryClientStore,
  FirestoreClientStore,
} from "./repo";
export { reconcileClients, clientKey, type ReconcileResult } from "./reconcile";
