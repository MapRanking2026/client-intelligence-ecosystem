# SEOOS Build Status Ledger

Tracks every requirement from the SEOOS build assignment (Sections 5–12) against
implementation. Statuses: `not_started` · `in_progress` · `blocked_external` ·
`implemented` · `verified`.

Companion docs: `apps/mtos/docs/architecture/current-mtos-inventory.md`,
`apps/mtos/docs/architecture/mtos-seoos-boundaries.md`.

Baseline reconfirmed 2026-09-04 (Phase 0): repo root `E:\motsv7` (monorepo,
npm workspaces); apps at `apps/mtos` (pkg name still `web`) and `apps/seoos`
(pkg `seoos`); shared `packages/contracts` (`@cie/contracts`), `packages/core`
(`@cie/core`). MTOS `npm run build:mtos` → success (42 routes). SEOOS
`npm run build:seoos` → success. `npm run check` still fails on **pre-existing**
MTOS ESLint debt (5 `set-state-in-effect` errors + 3 warnings) — unrelated to
this work. Git branch: `feature/seoos-foundation`.

## Legend of evidence
Files are repo-relative. "verified" = exercised by a build and/or the
`@cie/core` runtime checks (`npm test -w @cie/core`).

---

## Phase 0 — Audit baseline
| Item | Status | Evidence |
|---|---|---|
| Confirm paths/workspace/build/lint/git | verified | this ledger; builds run |
| Inventory SEOOS routes/components/APIs | implemented | see this ledger |
| Boundaries + inventory docs | implemented | `apps/mtos/docs/architecture/*` |
| Record pre-existing lint debt separately | implemented | baseline note above |

## Phase 1 — Application foundation & navigation
| Item | Status | Evidence |
|---|---|---|
| Authenticated app shell + 15-destination nav | verified | `apps/seoos/src/components/app-shell.tsx`, `sidebar.tsx`, `src/lib/nav.ts` |
| Route protection (Next 16 `proxy`) | verified | `apps/seoos/src/proxy.ts` |
| Shared session verification (same cookie/secret) | verified | `apps/seoos/src/lib/auth/session-cookie.ts` |
| App membership + permission resolution | verified | `apps/seoos/src/lib/auth/context.ts`, `@cie/core` permissions |
| Loading/empty/unauthorized/blocked states | implemented | `apps/seoos/src/components/states.tsx`, `module-scaffold.tsx` |
| Migrate package-request form into Request Inbox | verified | `apps/seoos/src/app/requests/*`, `components/request-form.tsx` |
| Firebase Admin (shared creds; seed fallback) | implemented | `apps/seoos/src/lib/server/firebase/admin.ts`, `env.ts` |
| Seed/dev mode (credential-free) | verified | `apps/seoos/src/lib/server/seed.ts` |

## Phase 2 — Shared contracts & integration gateway
| Item | Status | Evidence |
|---|---|---|
| Identity / app-membership / permission contracts | verified | `packages/contracts/src/identity.ts`; core `permissions.ts` |
| Capability catalog (17 capabilities, metadata) | verified | `packages/contracts/src/capabilities.ts`; core `capabilities.ts` |
| Request contract (line items, periods, audience, priority) | verified | `packages/contracts/src/seo-request.ts` |
| Immutable package contract (sections, evidence, confidence) | verified | `packages/contracts/src/seo-package.ts` |
| Evidence / freshness / lineage / data-gap | verified | `packages/contracts/src/evidence.ts` |
| Events + durable outbox envelope | implemented | `packages/contracts/src/events.ts` (delivery loop: not_started) |
| Lead/call list-query + sort + verification contracts | verified | `packages/contracts/src/lead-call.ts` |
| Idempotency / correlation helpers | verified | `packages/core/src/idempotency.ts` |
| Legacy `SeoPerformancePack` compatibility adapter | not_started | — |
| **Integration gateway — signed S2S boundary** | verified | `packages/contracts/src/gateway.ts`, `packages/core/src/s2s.ts` (HMAC sign/verify + replay, tested), MTOS `apps/mtos/src/app/api/gateway/data/route.ts` + `lib/server/gateway/gateway-service.ts`, SEOOS `apps/seoos/src/lib/server/gateway/client.ts` |
| Gateway: integration-health resource (real MTOS connection state) | implemented | MTOS `getIntegrationHealth` → `listIntegrationViews` (secret-free); SEOOS Integrations page + Dashboard consume it |
| Gateway: per-provider data reads (Map Check-Ins/GHL/Rank Tracker/GBP/SC) | blocked_external | resource dispatch + data-gap in place; needs each MTOS normalized adapter exposed + `CIE_SERVICE_SECRET`/`MTOS_GATEWAY_URL` set |
| OAuth centralization / callback reuse | not_started | design in boundaries doc §OAuth |

## Phase 3 — Portfolio, projects, setup
| Item | Status | Evidence |
|---|---|---|
| Portfolio dashboard (totals, requests, data health) | implemented | `apps/seoos/src/app/page.tsx` |
| Client/project list | verified | `apps/seoos/src/app/clients/page.tsx` |
| Create project + duplicate prevention | verified | `projects-service.ts`, `api/seo/projects/route.ts`, `create-project-form.tsx` |
| Project stages + validated transitions | implemented | `apps/seoos/src/lib/domain/project.ts` |
| Repositories (in-memory seed + Firestore) | implemented | `apps/seoos/src/lib/server/repositories/*` |
| New-project wizard (resumable, autosave) | not_started | — |
| Source mapping / setup readiness / baseline scan | not_started | — |
| Project workspace tabs (Overview/Setup/Evidence/Activity) | not_started | — |

## Phase 4 — Scans, keywords, rankings, grids, competitors
| Item | Status | Evidence |
|---|---|---|
| Nav destinations + auth + states | implemented | `app/keywords`, `app/rankings` |
| Scan orchestration / snapshots / retries | not_started | — |
| Keyword CRUD/import/group/map/approve/sync | not_started | — |
| Rankings / coverage / market share / grids | not_started | — |
| Rank Tracker sync | blocked_external | Rank Tracker via gateway |
| GeoGrid grid data | blocked_external | no completed GeoGrid sync branch in audited source |
| Competitor management | not_started | — |

## Phase 5 — GBP, Map Check-Ins, reviews, Search Console, audits
| Item | Status | Evidence |
|---|---|---|
| Nav destinations + auth + states | implemented | `app/gbp`, `app/audits` |
| GBP performance/profile changes/reviews | blocked_external | GBP via gateway (only live conn test today) |
| Map Check-Ins activity/coverage | blocked_external | shared tenant-wide connection via gateway |
| Search Console / GA4 | blocked_external | SC/GA4 via gateway |
| Website technical audit adapter | blocked_external | Screaming Frog / crawl API (feasibility/licensing) |

## Phase 6 — Recommendations, work orders, delivery, QA
| Item | Status | Evidence |
|---|---|---|
| Nav destinations + auth + states | implemented | `app/recommendations`, `app/work-orders` |
| AI recommendation lifecycle (Prompt Engine) | not_started | — |
| Work-order lifecycle / QA / views | not_started | — |
| ClickUp reconciliation (human-approved writes) | blocked_external | ClickUp via gateway; approval gate preserved |
| Content/publication backlog | not_started | — |

## Phase 7 — Monthly audit book & shared Lead & Call Verification
| Item | Status | Evidence |
|---|---|---|
| Monthly SEO audit book | not_started | `app/monthly-audits` (shell) |
| MTOS Lead & Call experience preserved | verified | MTOS untouched; `apps/mtos/.../lead-verification/route.ts` (sorting added earlier) |
| SEOOS Lead & Call section (canonical records) | implemented | `apps/seoos/src/app/lead-verification/page.tsx` |
| Newest/Oldest sorting (server-side, stable, missing last) | verified | `@cie/core` `orderByOccurredAt` + checks; `lead-sort-toggle.tsx` |
| Authorized verification change + audit (cross-app) | implemented | `api/seo/lead-verification/[recordId]/route.ts`, `lead-call-repo.ts` |
| Secure recording playback (protected proxy) | blocked_external | shared GHL recording proxy via gateway |
| Canonical shared store (no divergent copy) | in_progress | interface canonical; live store via gateway `blocked_external` |

## Phase 8 — MTOS request ↔ SEOOS fulfillment loop
| Item | Status | Evidence |
|---|---|---|
| Request submit (validated, idempotent) | verified | `seo-engine.ts`, `api/seo/requests/route.ts` |
| SEOOS Request Inbox + fulfillment + package | verified | `app/requests/*`, `seo-engine.ts` |
| QA approve/reject/revise | in_progress | lifecycle present; QA UI not_started |
| Publish immutable package via outbox | in_progress | package immutable; outbox delivery not_started |
| MTOS request UI + consume via adapter | not_started | behind `SEOOS_*` flags |
| Auto-request on Monthly Touch (idempotent) | not_started | `SEOOS_AUTO_REQUEST_MONTHLY_TOUCH` |
| Stale/missing-package MTOS fallback | not_started | — |

## Phase 9 — Reports, admin, hardening, verification
| Item | Status | Evidence |
|---|---|---|
| Reports/packages history/preview/export | in_progress | `app/reports` (Request Inbox is the live loop) |
| Integrations & Data Health screen | verified | `app/integrations` wired to the gateway (real health when configured; honest data-gap otherwise) |
| Knowledge / Team / Settings screens | implemented | `app/knowledge`, `app/team` (shells) |
| Shadow-mode comparison | not_started | `SEOOS_SHADOW_MODE` flag wired in env |
| Full test suite (unit/contract/integration/authz/e2e) | in_progress | `@cie/core` checks cover sort/idempotency/permissions/catalog |

## Section 10 — Feature flags
| Flag | Status | Evidence |
|---|---|---|
| SEOOS_ENABLED / SEOOS_REQUESTS_ENABLED | verified | `apps/seoos/src/lib/flags.ts`, `env.ts` |
| SEOOS_AUTO_REQUEST_MONTHLY_TOUCH / PROACTIVE / SHADOW / READ_MODE | implemented | read in `env.ts` (consumers pending) |

## Section 8 — Authorization & tenancy
| Item | Status | Evidence |
|---|---|---|
| Additive app memberships + permission scopes | verified | `identity.ts`, `permissions.ts`, `context.ts` |
| Server-side authz on new endpoints | verified | all `apps/seoos/src/app/api/**` use `resolveSeoAuthz` + `requirePermission` |
| Client visibility enforcement | implemented | `requireClientAccess` on lead/call verify |
| Negative cross-tenant/unauthorized tests | in_progress | permission checks verified; e2e negative tests not_started |

## Known external blockers (summary)
- **Integration gateway boundary is now built** (signed S2S + `integration-health`
  wired to real MTOS connection state). What remains external: set
  `CIE_SERVICE_SECRET` (same value on both apps) + `MTOS_GATEWAY_URL` for the
  SEOOS project, and expose each provider's normalized MTOS adapter through
  `dispatchGatewayResource` (Map Check-Ins, ClickUp, GoHighLevel, Rank Tracker,
  GBP, Search Console).
- **Firebase Admin credentials** for SEOOS to share the live Firestore (seed
  mode works today without them).
- **GeoGrid** has no completed sync branch even in MTOS.
- **Website-audit source** (Screaming Frog / crawl API) pending feasibility.

## Explicitly NOT done (per rules)
- No production deploy, env change, migration, email, publish, or ClickUp write.
- No Supabase/Postgres migration (plan-only).
- MTOS behavior unchanged; all SEOOS consumption stays behind `SEOOS_*` flags.
