# SEOOS — Phase 0: Domain Mapping

> Maps the spec's canonical domain (Deliverable-2 A2) onto the entities that
> actually exist, so spec references resolve to real code instead of a new schema.

## Entity mapping

| Spec entity (A2) | Real entity / mechanism | Where | Notes / gap |
|---|---|---|---|
| `Organization` (tenant) | `tenantId` partition + `AuthzContextV1.tenantId` | `tenants/{tenantId}/…`; `lib/auth/context.ts` | CIE uses a shared org key `engineTenantId()` (`ENGINE_TENANT_ID` \|\| `map-ranking`) so MTOS↔SEOOS share one partition. |
| `User` | `SeoUserV1` | `lib/domain/user.ts`, `repositories/*user*` | Fields incl. email, displayName, roles, `clientVisibility`. MTOS users live separately under Firebase + `tenants/{t}/users/{uid}`. |
| `Client` | **`SeoProjectV1`** + CIE canonical client | `lib/domain/project.ts`; `packages/engine` (`canonicalClients`) | SEOOS **conflates client and project** into `SeoProjectV1` (has `clientId`, `businessName`). CIE holds the cross-app canonical client facts. |
| `Project` | `SeoProjectV1` | `lib/domain/project.ts` | Carries stage, health, assignments, `externalIds` (`clickupTaskId`, `seoSpecialist`), metrics. `service_type` ≈ `service-offering.ts` + `stage`. |
| `Assignment` | `SeoProjectV1.assignedSpecialistId` + `effectiveSpecialistId()`; pods | `projects-service.ts:309`; `pods-service.ts` | No standalone `Assignment` entity with `effective_from/to`/`assigned_by`. Effective specialist = explicit assignment else `matchSpecialistId(externalIds.seoSpecialist)`. |
| `Proposal` / `ProposalVersion` | **`TicketV1`**, **`PreparedTaskV1`** (draft+status), plus `RecommendationV1`, `WorkOrderV1` | `lib/domain/{ticket,prepared-task,recommendation,work-order}.ts` | No single `Proposal` table and **no `version_hash`/`approval_invalidated`**. Status: `new→drafting→awaiting_approval/needs_info→approved/rejected`. All draft-only. |
| `Approval` | decision fields on those entities | `decidedByUserId`, `decidedAt`, `decisionNote` | No `Approval` record with `approved_actions` / `version_hash`. A rejection note feeds `addCorrectionRule` (style learning). |
| `ExecutionRun` / `ExecutionStep` | — | — | **Missing.** Nothing executes to an external system; approve records intent only. |
| `Evidence` | `needsInfo[]`, `draft`, `detail` | ticket/task | Informal. No structured evidence panel with snapshots/screenshots/prompt logs. |
| `Job` / `JobRun` | Vercel cron + `task-engine-service` materialization | `vercel.json`, `task-engine-service.ts` | No `Job`/`JobRun` records or dry-run/opt-out admin screen. |
| `Ticket` | `TicketV1` | `lib/domain/ticket.ts` | Working: ClickUp read-only ingest, routed to specialist, AI-drafted, decide. |
| `Notification` | — | — | **Missing.** No notification entity/service. |
| `AuditEvent` | — | — | **Missing.** Decisions are stamped on entities; there is no append-only audit log. |
| `Rule` (Rule Library, M12) | `PromptV1` (editable prompts) | `lib/domain/prompt.ts`, `prompts-service.ts`, `/prompts` | Covers editable **instruction text** per tenant. The M12 numeric thresholds / conflict alternates are **not** modeled. |
| `Snapshot` | `performance-snapshots` repo; `client-data` repo | `repositories/*` | Partial: holds pulled GBP/GSC/audit + KPI rows; not the full read-only external-state capture the spec describes. |
| Keyword portfolio | `KeywordV1` | `lib/domain/keyword.ts` | Working: table, import, bulk. |
| Service types / templates | `ServiceOffering` + `TaskTemplate` | `lib/domain/service-offering.ts`, `task-templates.ts` | Plain TS catalogs, not the full `service_type` enum + variant model. |

## Authorization mapping (spec A3)

| Spec concept | Real mechanism |
|---|---|
| `authz.assert(principal, action, resource)` | `requirePermission(authz.permissions, key)` + `requireClientAccess`/`canAccessClient(clientVisibility, clientId)` (`@cie/core/permissions`) |
| Roles (specialist/pod_manager/admin) | `@cie/core` `ROLE_PERMISSIONS` — `seo_specialist`, `seo_lead`, `seo_manager`, `seo_qa`, `qa_reviewer`, `account_manager`, `manager`, `tenant_admin` (all perms) |
| Data-layer RLS **or** mandatory repo filter | **Mandatory repo filter** — `clientVisibility "all" \| [clientIds]` + per-viewer service filters (`listProjectsForViewer`, `listTicketsForViewer`, `getTaskForViewer`, `podKeysForUser`). No Postgres RLS in the apps. |
| System principal (jobs create but not approve) | Cron runs sync/draft; approval is a human route requiring `seo.project.manage`. |

## Naming note

Where the spec says **"Proposal"**, read **"the ticket/task/recommendation/work-order draft + its status + decision"**. Where it says **"CIE"**, read **`@cie/engine` canonical store (Supabase)**. Where it says **"Rule Library"**, read **Prompt Engine (instruction text) today; a thresholds Rule Library is still to be built.**
