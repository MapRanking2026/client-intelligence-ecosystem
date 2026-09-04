# MTOS — Firebase → Supabase Migration Plan

_Status: PLAN ONLY — no code changes until approved. Drafted 2026-08-16._

## 0. Read this first (honest framing)

- **Migrating will not, by itself, "make quota errors never happen."** Supabase has its own
  limits (DB size, egress/bandwidth, connections, and free projects pause after ~1 week idle).
  The durable fix for _quota_ on **either** platform is running on a plan with headroom.
- **The immediate outage fix is separate and cheap.** The error you hit
  (`RESOURCE_EXHAUSTED: Quota exceeded`) is almost certainly the Firebase **Spark (free) plan's
  50,000 reads/day cap**. Upgrading to **Blaze (pay-as-you-go)** removes it for cents/month.
  **Do this now regardless of the migration** — the migration is weeks of work and you need
  stability today.
- **Also worth diagnosing why 50K reads got burned** with only a few clients — likely the
  daily-sync cron or repeated full-collection reads. A wasteful read pattern will strain Supabase
  too, so fix the pattern either way.
- **Supabase is still a defensible long-term choice** — Postgres + SQL + real joins + row-level
  security + `pgvector` fit the "one canonical client record / Intelligence Hub" in the MTOS
  vision better than Firestore's document model, and pricing is predictable. This plan treats it
  as a deliberate architecture project, not a reaction to one error.

---

## 1. Current Firebase footprint (what we're moving)

### 1a. Firestore data model (`src/lib/server/firebase/collections.ts`)
All under `tenants/{tenantId}/…`:

| Firestore collection | Holds | Notes |
|---|---|---|
| `clients/{clientId}` | Client records | Rich, semi-structured (topRisks[], strategicAction{}, integrationMappings{}, rawPayload{}) |
| `monthlyTouches/{touchId}` | Monthly touch + **prepPack** | Large nested docs (scorecard, SEO, ads, callGuide, qaReview, aiRecommendations) |
| `commitments/*` | Commitments | Flat |
| `opportunities/*` | Opportunities | Flat |
| `integrations/{providerId}` | **OAuth connections/tokens** | SENSITIVE (access/refresh tokens) |
| `externalRecordMappings/*` | Integration profile ↔ client mappings | |
| `integrationSyncJobs/*` | Sync job runs | |
| `integrationSnapshots/{providerId}` | Latest synced provider data | |
| `leadVerifications/{clientId}` | Latest lead/call verification (GHL) | 1 doc/client, big JSON |
| `knowledgeChunks/{chunkId}` | **RAG embeddings** | Vector search → **pgvector is an upgrade** |
| `users/{userId}` + `syncedClients/*` + `clientSyncRuns/*` | User + their synced clients | |

### 1b. Firebase Auth
- Client SDK sign-in/up: `src/app/sign-in/page.tsx`, `sign-up/page.tsx`, `src/lib/firebase/client.ts`
- Server session: `api/auth/firebase-session/route.ts` (exchanges Firebase ID token → session
  cookie), `api/auth/firebase-signup/route.ts`, `session-cookie.ts`
- Enforcement: `src/proxy.ts` middleware checks the session cookie on every non-public route

### 1c. Files touching Firebase Admin (each needs porting) — ~13 services
`firestore-mtos-data-source.ts` · `lead-verification-service.ts` · `monthly-touch-prep-service.ts` ·
`client-mappings-service.ts` · `daily-sync-service.ts` · `knowledge-service.ts` ·
`live-call-guide-service.ts` · `post-meeting-service.ts` · `qa-review-service.ts` ·
`user-service.ts` · `integration-sync.ts` · `integrations.ts` · `clickup-client-sync.ts` ·
`prompt-store.ts` · `api/clients/[clientId]/recording/route.ts` · `firebase/admin.ts`

**Key architectural note:** only the 5 read methods go through the clean `MtosDataSource`
interface. Everything else calls `getFirebaseAdminDb()` directly — so this is a broad port, not a
one-class swap.

---

## 2. Target Supabase architecture

- **Postgres** with a schema-per-concern (below). Scalar/queried fields become **columns**; rich,
  variable, or nested blobs become **`JSONB`** (pragmatic hybrid — avoids over-normalizing the
  prepPack/verification payloads while keeping the queryable fields fast).
- **Row-Level Security (RLS)** keyed on `tenant_id` — enforces multi-tenant isolation at the DB,
  a real upgrade over app-enforced tenant scoping.
- **`pgvector`** extension for `knowledge_chunks` → native similarity search for RAG (replaces
  manual Firestore vector handling).
- **Supabase Auth** (`@supabase/ssr`) for sign-in + cookie sessions, replacing Firebase Auth.
- **Supabase Vault / encrypted column** for `integration_connections` OAuth tokens.
- **Access via a `SupabaseMtosDataSource implements MtosDataSource`** + a service layer using the
  Supabase server client — chosen at runtime by a new `MTOS_DB_BACKEND` env switch
  (`seed | firestore | supabase`), mirroring today's `MTOS_USE_SEED_DATA`.

### Schema sketch (illustrative)
```sql
create table tenants (id text primary key, name text, created_at timestamptz default now());

create table clients (
  id text, tenant_id text references tenants(id),
  name text, industry text, contact text, lifecycle_stage text,
  touch_id text, touch_date text,
  health_score int, relationship_score int, growth_readiness int, tone text,
  summary text, next_best_action text, account_manager text, location text,
  mrr text, sentiment text, tenure text,
  data jsonb,                         -- topRisks, topOpportunities, strategicAction, mappings, rawPayload
  updated_at timestamptz default now(),
  primary key (tenant_id, id)
);

create table monthly_touches (
  id text, tenant_id text, client_id text, status text,
  readiness_score int, confidence_score int, scheduled_at text,
  executive_brief text, prep_pack jsonb, call_guide jsonb, qa_review jsonb, payload jsonb,
  primary key (tenant_id, id)
);

create table lead_verifications (
  tenant_id text, client_id text, review jsonb, generated_at timestamptz,
  primary key (tenant_id, client_id)
);

create table knowledge_chunks (
  id text, tenant_id text, content text, embedding vector(1536), metadata jsonb,
  primary key (tenant_id, id)
);
-- + commitments, opportunities, integration_connections, external_record_mappings,
--   integration_sync_jobs, integration_snapshots, app_users, synced_clients, client_sync_runs
-- + RLS policies on every table (tenant_id = auth tenant claim)
```

---

## 3. Phased plan (effort + risk)

Order chosen so the **safe, reversible data work comes first** and the **risky auth cutover comes
last**, all behind a runtime switch so we can flip back instantly.

| Phase | Work | Effort | Risk |
|---|---|---|---|
| **A. Provision + schema** | Create Supabase project; write SQL migrations for all tables + RLS + pgvector. No app change. | ~1–2 days | Low |
| **B. Core data source** | Build `SupabaseMtosDataSource` (the 5 `MtosDataSource` reads/writes). Add `MTOS_DB_BACKEND` switch. Migrate + parity-check clients/touches/commitments/opportunities behind the flag. | ~3–5 days | Low–Med |
| **C. Port direct-admin services** | Rewrite the ~13 services (lead-verification, prep-pack, mappings, integrations, snapshots, sync jobs, knowledge/RAG, prompt-store, user-service, recording route) to Supabase — one at a time, each behind the flag. | ~1.5–2.5 wks | Med |
| **D. Data migration tooling** | Export Firestore → transform → import Postgres for every collection (script). Re-embed `knowledge_chunks` into pgvector. Run for real. | ~2–4 days | Med |
| **E. Auth cutover** | Supabase Auth via `@supabase/ssr`; rewrite sign-in/up + `firebase-session` route + `proxy.ts` middleware; import users. **Highest risk.** | ~3–5 days | **High** |
| **F. Cutover + cleanup** | Flip `MTOS_DB_BACKEND=supabase` as default; keep Firestore read-only fallback briefly; then remove Firebase deps. | ~1–2 days | Med |

**Rough total: ~3–5 weeks of focused work.** (Estimates, not commitments — the service port and
auth are where reality bites.)

---

## 4. Data migration approach
- One-off Node script per collection: read Firestore (admin) → map to the Postgres row shape →
  upsert via Supabase service-role client. Idempotent (re-runnable).
- **Dual-run window:** with the `MTOS_DB_BACKEND` flag we can point reads at Supabase while
  Firestore stays intact, compare outputs, and roll back by flipping the flag.
- **RAG:** `knowledge_chunks` embeddings can be copied as-is if dimensions match, else re-embedded.

## 5. Top risks & mitigations
1. **Auth lockout at cutover** → do auth last; keep Firebase Auth path behind the flag; test with a
   throwaway account; have a rollback runbook. Users likely need **one re-login** (acceptable) —
   confirm before we start.
2. **OAuth tokens (ClickUp/GHL/Google) breaking** → these are the most fragile. Plan for clients
   to **re-connect integrations** post-migration if tokens don't transfer cleanly.
3. **Document→column fidelity** → Firestore docs are loosely shaped; the `data jsonb` columns
   absorb variance so nothing is lost, and we normalize only what we query.
4. **Two systems live at once** → temporary extra cost + sync drift; keep the dual-run window
   short.

## 6. Cost
- **Supabase Pro ≈ $25/mo** (removes free-tier pausing; 8 GB DB; sane limits).
- **Firebase Blaze ≈ cents/mo** at this scale.
- Both are cheap; **the migration labor (~3–5 wks) is the real cost.** That's the number to weigh
  against simply enabling Blaze + adding read-resilience.

## 7. What I need from you to start
1. **Stabilize today regardless:** enable Firebase **Blaze** (or confirm you want me to add the
   graceful-error guards to the other pages first).
2. A **Supabase project** (you create it; you put the URL + keys in `.env` — I never handle secrets
   in plaintext).
3. Decisions:
   - OK for users to **re-login once** after auth cutover?
   - OK for clients to **re-connect integrations** if OAuth tokens don't transfer?
   - Keep the current **multi-tenant** model (RLS by `tenant_id`)?

## 8. My recommendation
Do **Phase A + B behind the flag** first (low-risk, reversible, proves the approach on your real
data) — but only **after** you've enabled Blaze so you're not running on a broken DB while we
migrate. Treat auth (Phase E) as its own carefully-gated step. If at any point the payoff doesn't
justify the remaining risk, we stop — the flag means Firestore keeps working the whole time.
