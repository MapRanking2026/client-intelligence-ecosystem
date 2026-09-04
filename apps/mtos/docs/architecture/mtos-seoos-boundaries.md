# MTOS ↔ SEOOS Boundaries, Lifecycle, Security & Rollout

Companion to `current-mtos-inventory.md`. Defines ownership, the request/package lifecycle,
security, rollout, and rollback for evolving MTOS into a two-app Client Intelligence Ecosystem.

## 1. Product ownership

- **MTOS** owns account management & client communication: Command Center, client health/retention/growth, Monthly Touch (schedule → prep → run → post → QA), Call Intelligence & lead-quality conversation, the **full account-manager Lead & Call Verification experience**, client-ready story/reports/emails, and the commercial handling of the proposed one-time **$499** optimization (SEOOS may identify eligibility + scope; MTOS owns the client conversation/approval — never auto-bill).
- **SEOOS** owns internal SEO operations: project intake, scans/rescans, keyword research→approval→Rank Tracker sync, rankings/grids/market-share, GBP performance, Map Check-Ins/reviews ops, monthly SEO audit book, (staged) technical audits, recommendation→work-order→QA→delivery, and **structured SEO Intelligence packages for MTOS**. SEOOS gets an **authorized** Lead & Call Verification section using the *same canonical records* (not a copy).
- **Shared Client Intelligence Core** (extracted incrementally): tenant/client identity, user identity + app membership + permission scopes, provider IDs + server-side adapter interfaces, external-record mappings, evidence/freshness/lineage/confidence/data-gap contracts, knowledge + AI runtime contracts, SEO capability/request/package/event/audit contracts, canonical lead/call verification contracts (incl. sort/query + recording-playback authorization), and idempotency/correlation/outbox utilities. Secrets and mature adapters stay behind the MTOS server boundary initially, exposed via a narrow compatibility service.

## 2. Lead & Call Verification (shared, one canonical model)

One canonical lead/call record + service. MTOS keeps its existing full experience unchanged; SEOOS gets a read/authorized-edit section via the same service. An authorized verification/classification change in either app updates the same record and is audited (actor, app, prev→new, reason, timestamp) and visible in the other app. Recording playback stays behind the existing protected GoHighLevel proxy — no agency tokens or durable raw URLs to any browser. Intelligence Packages carry only redacted/aggregate evidence references, never call audio or full PII.

**Sorting (both apps):** `Newest first` (default) / `Oldest first`, sorted by a normalized `occurredAt` (call start for calls; creation/receipt for other leads), stable secondary sort by canonical record id, applied **server-side before pagination/cursor**, timezone shown, missing/invalid timestamps sorted after valid ones with a visible `Date unavailable` state.

## 3. Request → Package lifecycle

`SeoIntelligenceRequestV1` (Zod, versioned): status `draft→submitted→queued→processing→needs_input→qa_review→ready→delivered` (+ `failed`/`cancelled`). Idempotency key = tenant + client + monthlyTouch + package preset/version + reporting period, so duplicate Monthly-Touch prep does not create duplicate orders. `SeoIntelligencePackageV1` is immutable + versioned; corrections make a new version and keep the prior. Capability catalog (`full-monthly-package`, `keyword-ranking-summary`, `grid-heatmap-analysis`, `gbp-performance`, `custom-question`, …) declares inputs, windows, filters, data sources, cache-vs-scan, side-effect/cost, required approval. Events (`SeoRequestSubmitted`, `SeoPackageReady`, `SeoSignificantChangeDetected`, …) delivered via a durable **Firestore outbox** (retry count, next-attempt, last error, correlation id, idempotency key, dead-letter). A **legacy adapter** maps `SeoIntelligencePackageV1` → the existing MTOS prep-pack (`SeoPerformancePack`) so MTOS keeps working during migration; the legacy live-source path stays until shadow-mode parity + rollback criteria pass.

## 4. Security & side effects

Every API/server action validates authn + tenant membership + client visibility + app membership + specific permission (`seo.request.create`, `seo.package.qa`, `lead_call.play_recording`, …). UI visibility ≠ authorization. New app memberships/scopes are **additive** — existing users keep MTOS access; nobody gets SEOOS implicitly. All external writes (ClickUp, email, listings, paid scans, billing) stay behind explicit human approval. App-to-app delivery uses signed service-to-service requests (short-lived JWT/HMAC, replay protection, tenant validation, least privilege) if the apps deploy separately.

## 5. Feature flags (server-evaluated, tenant-aware; defaults preserve MTOS)

`SEOOS_ENABLED`, `SEOOS_REQUESTS_ENABLED`, `SEOOS_AUTO_REQUEST_MONTHLY_TOUCH`, `SEOOS_PROACTIVE_PACKAGES_ENABLED`, `SEOOS_SHADOW_MODE`, `SEOOS_READ_MODE=legacy|shadow|seoos`. Default = current MTOS behavior. Shadow mode generates/compares new packages without changing what users see, recording parity diffs without sensitive data in logs.

## 6. Rollout & the structural decision (blocks Phase 1)

The assignment targets a monorepo (`apps/mtos`, `apps/seoos`, `packages/*`). **Reality: the git repo IS `apps/web` and Vercel deploys from it** (see inventory §git). Two safe options, both preserving MTOS:

- **A. Monorepo restructure (matches the target):** re-root the repo at `E:\motsv7` (apps/mtos + apps/seoos + packages/*, npm root workspace), change **Vercel Root Directory `apps/web` → `apps/mtos`**, re-verify crons/env/redirect URIs. Highest structural + production-pipeline risk; requires human Vercel reconfiguration before the next deploy works.
- **B. In-repo evolution (lowest risk, spirit-compatible):** keep the existing repo as MTOS untouched; add shared contracts + SEOOS surfaces + flags **inside** it first (compatibility layers, additive), and physically extract to a monorepo later as its own authorized infra step.

This decision is a production-infra choice and is left to the operator (rule: no live Vercel/production change without authorization).

## 7. Rollback

Every SEOOS surface is behind flags defaulting off. To return MTOS to legacy: set `SEOOS_READ_MODE=legacy` (MTOS prep uses the existing live-source path), leave `SEOOS_ENABLED=false`. Requests/packages already stored are retained (immutable) and simply not consumed. No Firestore collection is renamed/removed, so legacy readers keep working. If the monorepo restructure (option A) is ever done and needs reverting, the pre-change state is captured in `E:\motsv7\backups\web-backup-*.tar.gz` and in git history on `origin/main`.
