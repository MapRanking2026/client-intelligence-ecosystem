# ADR-0002 — AI Visibility Tracker: built inside SEOOS on the existing Firestore + authz spine

- Status: Accepted
- Date: 2026-10-19
- Context: request to build a multi-client AI visibility tracker for Map Ranking.

## Context

The brief suggests a relational database plus a durable job system *for an empty
project*. SEOOS is not empty: ADR-0001 fixes persistence as Firestore-per-app
(with an in-memory dev fallback) plus the Supabase CIE store for canonical client
identity, and isolation as a mandatory repository/service filter
(`listProjectsForViewer`). The tracker must not create a competing client
source of truth.

## Decision

1. **Client identity = `SeoProjectV1`** (which carries the canonical CIE
   `clientId`). The tracker stores an `AivProfileV1` keyed by `projectId` holding
   only measurement configuration (aliases, owned domains, services, locations,
   competitors, budgets). It never duplicates the client record.
2. **Persistence = Firestore** collections under `tenants/{tenantId}/aiv*`, with
   an in-memory implementation for credential-free dev, following the existing
   repository pattern. Queries use only single-field equality filters so no
   composite indexes are required; sorting/aggregation happens in the service
   (observation volumes per client are in the low thousands per year).
3. **Durable jobs = one Firestore document per planned observation slot**
   (`aivJobs`), claimed with a transactional lease. Processing is driven by
   (a) `after()` work immediately after a scan starts, (b) self-chained worker
   invocations (`/api/seo/ai-visibility/worker`, CRON_SECRET), (c) a daily Vercel
   cron (`/api/cron/ai-visibility`) that also runs the scheduler and reclaims
   expired leases, and (d) an optional long-running worker script for non-Vercel
   hosts. Nothing depends on a browser session or one long HTTP request.
4. **Idempotency:** job id = hash(scanId, slot); observation id = job id, written
   with create-if-absent semantics. Retries add `aivAttempts` (with cost) but can
   never create a second observation for the same slot. Scheduled scans use a
   deterministic id per (project, period) so the scheduler cannot double-fire.
5. **Measurement calls bypass `composeAiSystem`.** ADR-0001 routes *drafting* AI
   through guardrails + style. Measurement must not be steered, so collection
   requests send the prompt text alone (no system prompt, no history, no client
   context). There is also **no provider fallback**: a failure is recorded as a
   failure for that provider, never silently answered by another model.
6. **Analysis is deterministic** (versioned extractor) with manual corrections
   stored as an audited overlay; it runs after collection and never feeds back
   into collection.
7. **Authorization reuses existing scopes**: read = `seo.package.read` + project
   visible via `listProjectsForViewer`; configure/run = `seo.project.manage`;
   provider settings and agency caps = `integrations.manage`. Cron/worker routes
   require `CRON_SECRET`.
8. **Outbound lock:** provider calls and public website reads are inbound reads
   (same class as AI drafting and the on-page audit), so they are allowed under
   the SEOOS outbound lock. The tracker never writes to any external system.

## Consequences

- No new database or vendor is introduced; production rollout needs no schema
  migration (Firestore collections are created on first write). Firestore TTL or
  retention policies can be added per collection later.
- Very large historical windows would need pre-aggregation; documented as a
  known limit.
