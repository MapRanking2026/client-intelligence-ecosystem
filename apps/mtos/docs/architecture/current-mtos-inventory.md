# Current MTOS Inventory (verified 2026-09-03)

Phase 0 baseline for the MTOS → MTOS + SEOOS ("Client Intelligence Ecosystem") separation.
Everything here was verified against the real repository, not the uploaded snapshot.

## Repository & git reality (IMPORTANT — differs from the assignment's assumption)

- **The git repository root is `E:\motsv7\apps\web` — the app IS the repo.** There is **no** git repo, `package.json`, workspace config, or `packages/` directory at `E:\motsv7`. `E:\motsv7` is just a working folder that also holds docs, backups, and `.trae/`.
- Remote: `origin → https://github.com/MapRanking2026/mtosv0.git`, branch `main`.
- **Vercel deploys from this repo**, so its Root Directory is effectively the repo root (`apps/web`'s contents). Crons live in `apps/web/vercel.json`:
  - `/api/cron/daily-sync` at `0 9 * * *` (09:00 UTC)
  - `/api/cron/refresh-tokens` at `0 3 * * *` (03:00 UTC)
- Consequence: the assignment's `git mv apps/web apps/mtos` (which assumes a monorepo git root at `E:\motsv7`) is **not directly possible**. Converting to the target monorepo means re-rooting/restructuring the live-deployed repo AND changing the Vercel Root Directory — a production-infra change that needs explicit human authorization. See `mtos-seoos-boundaries.md` §Rollout.

## Package & tooling

- Package name: `web` (no `workspaces` field). Package manager: **npm** (`apps/web/package-lock.json`; no root lockfile).
- Scripts: `dev`, `build` (`next build`), `start`, `lint` (`eslint .`), `check` (`tsc --noEmit && eslint .`), plus `seed:firestore`, `bootstrap:map-ranking`, `import:prompts`, `check:prompt-store` (all `tsx`).
- Stack: Next.js **16.2.9** (App Router), React **19.2.4**, TypeScript 5, Tailwind CSS 4, Firebase client + Firebase Admin (Firestore), Zod, Pino, OpenTelemetry, DOCX/ZIP utils. `next.config.ts`.

## Verified build / lint baseline (2026-09-03)

- `npm run build` → **success (exit 0)**, ~42 routes/pages compile (App Router; mostly dynamic `ƒ`, a few static `○`).
- `npm run lint` (`eslint .`) → **5 errors, 3 warnings — PRE-EXISTING**, not caused by this work:
  - `react-hooks/set-state-in-effect` errors in theme/annotation/tab/notification-style components (e.g. `src/components/mtos/theme-toggle.tsx:10`).
  - warnings incl. an unused `extractJsonObject` in `monthly-touch-prep-service.ts`.
- `npm run check` therefore currently fails on the ESLint step (pre-existing). Record this as baseline debt; new work must not add to it.
- Working tree at audit: near-clean — only in-flight edits to `post-meeting-workflow.tsx` and `client-intelligence-service.ts` (the current Client Intelligence work); the operator commits/pushes continuously.

## Product capabilities present (must remain functional)

- **Command Center**, **Clients** + client workspace (Overview/Performance/Intelligence/Plan/Promises/Leads & Calls), **Monthly Touch** (queue → prep `prep-pack-v4` → live run-sheet → post-meeting → QA), **Commitments**, **Opportunities**, **Call Intelligence / Lead & Call Verification**, **Emergency Retention** + branded DOCX, **Settings** (Integrations, Prompt Engine, Knowledge Base, Report Branding; staged Users/Flags/Audit/Security).
- **Post-meeting** (in `post-meeting-service.ts`): transcript → recap, commitments, draft ClickUp tickets (human approve/decline before any write), copyable client email (not auto-sent), **Client Intelligence** (report saved per client + risk-gated Risk Register / Stakeholder Map updates writing to the Health Tracker list, all approval-gated), 7-category QA + A–F grade, hard-coded Victor step; final filing manual.
- **AI provider fallback** Claude → OpenAI → Gemini (`mtos-ai.ts` `callLlmForJson`/`callLlmForText`), each caller validating with its own Zod schema.

## Integrations (`provider IDs`) & real sync status

Catalog: `clickup, google-business-profile, google-search-console, google-ads, meta-ads, google-analytics, google-calendar, google-meet, gohighlevel, google-drive, gmail, ahrefs, rank-tracker, geogrid, map-checkins, stripe, quickbooks, internal-database`.

Implemented sync paths: **ClickUp, Google Calendar, GBP, Google Search Console, Rank Tracker, Map Check-Ins, GoHighLevel, Google Ads**. Others are configured/represented only. GeoGrid is a shared integration without a completed sync branch. Only GBP has a full live connection test. A duplicate Google Ads switch branch exists in provider-sync (existing tech debt). Rank Tracker / GeoGrid / Map Check-Ins are tenant-wide shared; most others per-user. Credentials are encrypted via `MTOS_INTEGRATIONS_SECRET` — never log/move plaintext.

## Auth & tenancy (current limits)

Roles: `account_manager, manager, qa_reviewer, tenant_admin`. Enforcement is not comprehensive across every settings/API path; tenant isolation relies on tenant-scoped Firestore paths + app checks (no DB row-level security). New shared endpoints must add server-side auth (authn + tenant + client visibility + permission) and negative tests.

## Persistence

Firestore (tenant-scoped paths under `tenants/{tenantId}/…`). A Supabase/Postgres migration doc exists but is **plan-only / not approved** — out of scope here.
