/**
 * @cie/core — shared runtime for the Client Intelligence Ecosystem.
 *
 * Pure logic and boundary definitions only: the canonical Lead & Call sorting,
 * idempotency/correlation helpers, and hexagonal ports. No I/O, no secrets, no
 * Firestore/HTTP here — those live behind each app's server boundary.
 */
export * from "./lead-call-sort";
export * from "./idempotency";
export * from "./permissions";
export * from "./capabilities";
export * from "./s2s";
export * from "./ports";
