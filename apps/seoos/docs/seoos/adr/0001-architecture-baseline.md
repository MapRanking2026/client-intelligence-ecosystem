# ADR-0001 — Architecture baseline: build on Firestore+CIE, do not re-platform to the spec's RLS assumptions

- Status: Accepted
- Date: 2026-09-11
- Context: Deliverable-2 Phase 0 audit (`../00-current-state.md`)

## Context

The Deliverable-2 master prompt (Part A) is written as if SEOOS were a greenfield app on **Postgres with row-level security**, a single `Proposal` table, an execution engine, and an adapter capability matrix. None of that is the current system. What exists is two shipped Next.js apps (SEOOS, MTOS) on **Firestore-or-in-memory** repositories, a shared **Supabase/Postgres CIE** (`@cie/engine`) both reconcile into, a working per-specialist authorization model, and a large amount of built product (client sync, tickets, tasks, audits, keywords, recommendations, work orders, reports, prompt engine, specialist styles).

Taking Part A literally would drive an executor to rewrite two working apps.

## Decision

1. **Persistence stays Firestore-per-app + Supabase CIE.** We do NOT migrate the apps to Postgres. RLS applies only inside the CIE engine store (where the Supabase repo already enforces it and the service role bypasses for server use). The spec's "Postgres+RLS" is read as "the CIE store", not "every app table".

2. **Isolation stays a mandatory repository-filter model, not app-level RLS.** `clientVisibility ("all" | [clientIds])` + per-viewer service filters (`listProjectsForViewer`, `listTicketsForViewer`, `getTaskForViewer`, `podKeysForUser`) satisfy spec A9.1/A9.2. This is the invariant that must never regress: an account manager/specialist sees only their own clients. Any new read path must route through these filters.

3. **The "Proposal lifecycle" is generalized from the existing draft→approve pattern, not rebuilt.** The real spine is `TicketV1`/`PreparedTaskV1` (`status: new→drafting→awaiting_approval/needs_info→approved/rejected`, draft-only, nothing published) plus `RecommendationV1`/`WorkOrderV1`. Future work factors a shared review surface and adds `version_hash` binding + `approval_invalidated` on top of this, rather than introducing a new generic table that orphans the working boards.

4. **Reuse the existing job, adapter, and LLM frameworks.**
   - Jobs: the Vercel cron + `task-engine-service` cadence model is the recurrence engine; extend it (opt-out, dry-run) rather than adding a second scheduler.
   - Adapters: the `sync/*` read adapters are the base. A first-class `Adapter` interface (`capabilities/read/write/verify/manualStepSpec`) is added incrementally, starting with the first **write** adapter (GBP fields) when an approved action first needs to execute.
   - LLM: `composeAiSystem` (`GLOBAL_GUARDRAILS` + editable prompt + per-specialist style) is the single AI funnel; all new AI calls go through it.

5. **The M12 "Rule Library" is built alongside the existing Prompt Engine, not merged into it.** The Prompt Engine owns editable *instruction text*; a new versioned thresholds library (per-tenant overrides, documented conflict alternates) owns *numeric rules*. Keeping them separate avoids overloading prompts with config.

6. **Nothing publishes to a live external system until an execution layer is deliberately added**, per the product's non-negotiable approval gate. Today approval records intent only; that is a feature, not a bug, and the execution layer is opt-in per workflow.

## Consequences

- The spec's 397 entries are treated as a **gap backlog over the real system** (see `../00-current-state.md` §4), not a from-scratch build sheet. Most are `missing`/`partial` and will be built as draft→approve→(optionally)execute flows on the existing spine.
- Any contributor tempted to "follow the spec" and add Postgres/Prisma, RLS, or a new Proposal table must instead reconcile against this ADR and the domain mapping (`../01-domain-mapping.md`).
- The per-specialist visibility invariant is load-bearing and is called out separately so it is never traded away for spec fidelity.
