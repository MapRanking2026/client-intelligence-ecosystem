# SEOOS — Phase 0: Current-State Audit

> Deliverable-2 Phase 0 (spec rule A1.1 "Inspect first"). This maps the 397-entry
> implementation spec onto what the code **actually** implements today, so no one
> rebuilds working software to the spec's assumptions.
>
> Generated 2026-09-11. Source: direct code inventory of `apps/seoos`, `apps/mtos`,
> `packages/{engine,core,contracts}`.

## 0. The one thing to read first

The Deliverable-2 master prompt (Part A) is written for a **greenfield app on Postgres + row-level security**. That is **not** what exists. Executing Part A literally would try to re-platform two working apps. The real system is:

- **SEOOS** — Next.js 16 App Router, **Firestore-or-in-memory** repositories (per-tenant `tenants/{tenantId}/…`), its own session-cookie auth, and a large amount already built (client sync, tickets, tasks, monthly audits, keywords, recommendations, work orders, reports, prompt engine, specialist styles).
- **MTOS** — separate Next.js app, Firebase Auth, the Monthly-Touch / post-meeting engine.
- **CIE (`@cie/engine`)** — the shared **Supabase/Postgres** canonical-client store both apps reconcile into. RLS applies **only here**, not across the apps.

So the spec's "Postgres + RLS everywhere", "one Proposal table", "adapter capability matrix", and "execution engine that writes to GBP/WordPress" are **targets/gaps**, not existing scaffolding to extend. The genuine spine that already realizes the spec's intent is the **draft → review → approve** loop on tickets and tasks (draft-only, nothing published) plus the shared AI path (`composeAiSystem` = guardrails + editable prompt + per-specialist style).

## 1. Classification legend

- **working** — implemented and used end-to-end.
- **partial** — real implementation exists but narrower than the spec (e.g. read-only where spec wants write; one type where spec wants a generic engine).
- **scaffold** — structure/UI exists but the behavior is stubbed or read-only display.
- **missing** — no implementation.

## 2. Architecture reality (what actually exists)

| Concern | Reality | Files |
|---|---|---|
| Frontend | Next.js 16 App Router, ~19 pages | `app/**/page.tsx` |
| Persistence | Firestore (`tenants/{tenantId}/{collection}`) **or** in-memory, per-repo factory | `lib/server/repositories/*` |
| Shared canonical store | **Supabase/Postgres** CIE via `@cie/engine`; shared org key `engineTenantId()` (`ENGINE_TENANT_ID` \|\| `map-ranking`) | `lib/server/engine/*`, `packages/engine/*` |
| Auth | Session-cookie login/logout/signup; `SeoUserV1` users | `app/api/auth/*`, `lib/auth/*`, `lib/domain/user.ts` |
| Authz / isolation | `AuthzContextV1` (roles → permissions + `clientVisibility "all"\|[clientIds]`); per-specialist scoping in services | `lib/auth/context.ts`, `@cie/core/permissions`, `listProjectsForViewer` / `listTicketsForViewer` / `getTaskForViewer` |
| AI | Claude→OpenAI→Gemini fallback; JSON envelope; `composeAiSystem` = `GLOBAL_GUARDRAILS` + editable prompt + specialist style | `lib/server/ai/llm.ts`, `prompts-service.ts` |
| Integrations | ClickUp (read), GBP/GSC/Drive (read via Google OAuth), on-page audit (read), MTOS gateway (S2S read + one write-back) | `lib/server/sync/*`, `gateway/client.ts` |
| Jobs | One Vercel cron (`0 8 * * *`) → sync clients + task plans + tickets | `vercel.json`, `api/cron/sync-clients` |

**Isolation is enforced by mandatory repository filters, not Postgres RLS** — `clientVisibility` + per-viewer service filters. This satisfies spec A9.1/A9.2 by a different mechanism than A3 assumes; see ADR-0001.

## 3. Foundation (spec M1 + M12 + M2.74 vault) vs reality

| Spec capability | Status | Reality / gap |
|---|---|---|
| Org/tenant, users, roles/MFA | **partial** | Tenants + `SeoUserV1` + role→permission model exist. No MFA. |
| Assignment-scoped access, enforced in data layer | **working** | `clientVisibility` + `listProjectsForViewer`/`listTicketsForViewer`/`getTaskForViewer`/`podKeysForUser`. Isolation is repository-filter, not RLS. |
| **Proposal** lifecycle (single generic entity) | **partial** | No single `Proposal` table. The pattern is realized per-type: `TicketV1` and `PreparedTaskV1` carry `status: new→drafting→awaiting_approval/needs_info→approved/rejected`; `RecommendationV1` and `WorkOrderV1` have their own decide/QA flows. All **draft-only**. |
| Approval bound to version_hash | **missing** | Decisions are recorded (`decidedByUserId`, `decisionNote`) but there is no `version_hash` binding or `approval_invalidated` on edit. |
| Review queue (`/review`, `/admin/review`) | **partial** | Per-type boards (`/tickets`, `/tasks`, `/recommendations`, `/work-orders`) scoped per viewer; no unified review queue with SLA/bulk rules. |
| Execution engine (idempotent external writes, verify, conflict) | **missing (by design so far)** | Nothing writes to GBP/WordPress/ClickUp. Approve only records a decision; acting on it is a human step. The one external write anywhere is `deliverToMtos` (S2S). |
| Recurrence engine | **partial** | Vercel cron + `TaskCadence` (once/daily/weekly/monthly) materialized by `task-engine-service`. No per-client opt-out/dry-run admin screen. |
| Adapter framework + capability matrix | **partial** | `sync/*` are read adapters; no `Adapter` interface with `capabilities()/write()/verify()/manualStepSpec()`. |
| Vault for credentials | **partial** | `integrations-service` stores connection creds (encryption secret configured); not a per-client secret vault with the spec's binding. |
| Rule Library (M12) | **partial** | The **Prompt Engine** (`/prompts`, `prompts-service`, editable per-tenant prompts) covers editable AI instructions. The M12 numeric thresholds/conflict-resolution catalogue is **not** modeled as a versioned rule library. |
| ClickUp + Slack bridges | **partial** | ClickUp read-only (clients, pods, tickets, comments). No Slack. No approved write-back to ClickUp. |
| CIE sync boundary | **working** | `@cie/engine` ingest/reconcile; `/engine` + `api/engine/reconcile`; store = Supabase→Firestore→in-memory. |

## 4. Module-by-module (M2–M11) vs reality

| Module | Status | What exists | Biggest gaps vs spec |
|---|---|---|---|
| **M2 Onboarding & project setup** | **partial** | Client roster sync from ClickUp; project create/assign/external-ID mapping; stage transitions; `service-offering.ts`; task-plan materialization from `TASK_TEMPLATES`; monthly-audit checklists. | Most M2.x sub-workflows (Success Call reconciliation, category/NAP/hours decisions, variant handling, multi-location, upsell) are not modeled as workflows. |
| **M3 GBP & reputation** | **partial → scaffold** | `/gbp` reads GBP metrics/reviews; tickets infer GBP categories (audit/post/review) and draft in SEOOS; ranking view. | No GBP **write** (categories, description, services, posts, review replies); no spam/reverification flows; all GBP mutation is spec-missing. |
| **M4 Website/content/technical** | **scaffold** | `/audits` shows on-page audit results (`onpage-audit.ts`). | No content pipeline, no WordPress/Yoast, no schema/robots, no T-Optimization, no publish flow. |
| **M5 Citations/authority/links** | **missing** | — | NAP gate, BrightLocal, authority scoring — none. |
| **M6 Rank/grids/diagnosis** | **partial (read)** | `/rankings` displays geo-grid/ranking data; map-ranking + rank data read. | No grid-scan scheduling, heatmap rule engine, low-perf classifier, KPI snapshots. |
| **M7 CTR & behavioral** | **missing** | — | Agency Assassin / Traffic Dominator, compliance gate — none. |
| **M8 Performance/Low-Perf/Reset** | **partial** | `recommendations` (AI-generated, decide, convert to work order); work orders + QA. | No negative-month/streak engine, LP classifier, scenario drafts, retention risk. |
| **M9 Reporting/comms/delivery** | **partial** | `report-service` composes monthly reports; report email; **outbox** delivery to MTOS (`deliverToMtos`); app-wide search. | No SEO-Dashboard 22-signal model, Quick-Win engine, Monthly-Touch pack, ticket SLA engine. |
| **M10 Team ops & knowledge** | **partial** | Specialists + pods; **specialist-style engine (working)** incl. new ClickUp-comment seeding; niche studies imported from Drive; Prompt Engine. | No daily/weekly workload engine, KPI scoring, experiment registry, SPIP, certification. |
| **M11 Offboarding/cancellation** | **missing** | — | Cancellation cascade, asset teardown, transfers — none. |

## 5. What genuinely realizes the spec's core intent today

1. **Draft-only AI work with human approval** (spec A4/A6 intent): tickets and tasks are ingested read-only, drafted by AI inside SEOOS, and never published — approval records a decision, execution stays human. This is the spec's "nothing published until approved" guarantee, already live.
2. **Per-specialist scoping** (spec A3/A9.1): each specialist sees only their own clients/tickets/tasks; admins see all. Enforced in services, not just UI.
3. **Editable AI instruction layer** (spec M12 intent, partially): the Prompt Engine + `GLOBAL_GUARDRAILS` + per-specialist style directive.
4. **Shared canonical client store** (spec "CIE"): `@cie/engine` on Supabase, reconciled from ClickUp, shared with MTOS under one org key.

## 6. Recommended build order (reconciled with spec phases)

Given the above, the highest-leverage next steps that build on — not replace — what exists:

1. **Generalize the approval spine** (spec Phase 1): factor the ticket/task `draft→approve` pattern into a shared review surface + add `version_hash` binding + `approval_invalidated`. This is a refactor of working code, not a rewrite.
2. **Add an Adapter interface + first write-adapter** (GBP fields), so "approve" can optionally execute + verify (spec A6/A8) — starting with the GBP category/post/reply writes M3 needs.
3. **Model M12 as a real Rule Library** alongside the Prompt Engine (versioned thresholds, per-tenant overrides, conflict alternates).
4. Then module depth (M2 onboarding workflows → M3 GBP execution → M6 grids), each as its own draft→approve→(optionally)execute flow.

## 7. Credentials / config still needed (per spec A10)

- ClickUp personal token (per-tenant, via Integrations) — present when connected.
- Google OAuth (GBP/GSC/Drive) — `hasGoogleOAuth()`; per-project connect.
- LLM key (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/Gemini) — `hasAiConfig()`.
- Engine store: `ENGINE_SUPABASE_*` (else falls back).
- Not yet integrated (spec-required, absent): WordPress/Yoast, BrightLocal, Search Atlas, Agency Assassin, Traffic Dominator, Bing/Apple, Slack, GHL, Sheets, Miro.

See `01-domain-mapping.md` for entity mapping and `adr/0001-architecture-baseline.md` for the decisions that keep this on the real architecture.
