# CIE Platform Architecture (realignment)

Status: **Phase 1 (discovery) + Phase 2 (shared foundation) complete and additive.**
**Phase 3 (cutover of the live apps) is deliberately NOT done** — it changes production
auth/tenant/session and must be run supervised. This doc is the map + the resume plan.

## Platform hierarchy (target)

```
Client Intelligence Ecosystem (CIE)          ← the platform (one deployment, many tenants)
  └─ Tenant (e.g. Map Ranking, Brown Media)  ← an agency; isolated; owns users/clients/integrations
       └─ Client Intelligence Engine         ← shared data+domain layer for that tenant
            └─ Activated department apps      ← MTOS, SEOOS, future OS's (activated per tenant)
```

MTOS and SEOOS are **applications activated inside a tenant**, not tenant owners. The Engine
is the single source of truth for shared client data; apps keep only department-specific
records that reference the canonical `tenantId` + `clientId`.

## Phase 1 — what the discovery found (root cause)

- **Tenant was never a first-class record.** In both apps a "tenant" was just an id string
  used as a Firestore path prefix + a JWT claim baked in at signup. No `tenants` table, no
  server-side resolution against a canonical tenant record.
- **The demo/mismatch bug:** MTOS's `.env` defined `MTOS_PILOT_TENANT_ID` twice
  (`map-ranking`, then `tenant-map-ranking-demo` — the later wins). SEOOS **reuses that same
  env var name**, so SEOOS's tenant became `tenant-map-ranking-demo` while MTOS's runtime
  default fell back to the hardcoded `map-ranking`. Different partitions → the Engine couldn't
  line them up. (The Engine now sidesteps this with a shared `ENGINE_TENANT_ID`, but the real
  fix is a resolved TenantContext — Phase 3.)
- **Two separate Firebase projects.** MTOS and SEOOS each have their own Firestore, so shared
  entities (tenant, membership, clients, integrations) can only truly be shared in a neutral
  store. **Supabase is that store** (already holds canonical clients).
- **Identity layer half-shared.** `@cie/contracts` already has `AppMembershipV1`,
  `AuthzContextV1`, `PermissionScope`, and `@cie/core` has the `ROLE_PERMISSIONS` table.
  **SEOOS uses them; MTOS does not** — MTOS still uses its own `TenantContext`/`Role`.
- **Integrations duplicated** per app (MTOS `integrations.ts`, SEOOS `seoIntegrations`), each
  with its own encryption, in each app's own Firebase project.
- **No app registry, no platform roles** (no `platform_super_admin`).

## Phase 2 — what was built (additive; nothing cut over)

Decision: **Supabase is the CIE platform DB** for shared entities. Firestore stays each app's
store for its own department data.

New in `@cie/contracts` (`tenant.ts`): `TenantV1` (slug, branding, timezone, locale, plan,
featureFlags), `PlatformRole` (`platform_super_admin`), `AppDefinitionV1`,
`TenantAppInstallationV1`, `AuditEventV1`, `KNOWN_APP_DEFINITIONS`.

New in `@cie/engine`:
- `PlatformStore` (interface) + `InMemoryPlatformStore` + `SupabasePlatformStore` — tenants,
  memberships (`AppMembershipV1`), app registry, installations, audit.
- `PlatformService` — the shared gate. `resolveTenantAccess({userId, sessionTenantId, appKey})`
  returns tenant+membership **only** when the user holds a membership in that tenant for that
  app; enforces the isolation invariant (a browser-supplied tenant id is never trusted; a
  member of tenant A can never resolve tenant B). Plus `isAppEnabled`/`setAppEnabled`
  (per-tenant, default off; disable never deletes data), `ensureAppDefinitions` (idempotent),
  `recordAudit`/`listAudit`.
- `sql/001_platform.sql` — additive tables (`tenants`, `tenant_memberships`, `app_definitions`,
  `tenant_app_installations`, `audit_events`, plus the existing `canonical_clients`/
  `engine_reports`), RLS enabled (service role bypasses), and a seed for the Map Ranking tenant
  + mtos/seoos app defs + installations.
- `__checks__/platform.ts` — tenant-isolation + app-gating tests (all passing).

Run once against the engine's Supabase project (service-role SQL editor): `sql/001_platform.sql`.

## Tenant resolution (target, Phase 3)

Replace env-driven / cookie-baked tenant ids with a server-side resolver:
1. Authenticate the user (existing session).
2. `PlatformService.resolveTenantAccess({ userId, sessionTenantId, appKey })` against the
   platform DB — verified membership, active tenant.
3. Compute permissions from roles via `@cie/core`.
4. (Later) verified custom domain/subdomain may supply the tenant instead of the session.

`CIE_DEFAULT_TENANT_SLUG=map-ranking` is acceptable ONLY as a dev/bootstrap default; it must
never override authenticated resolution in production. Deprecate `MTOS_PILOT_TENANT_ID` /
`SEOOS` tenant env vars once the resolver is adopted.

## Phase 3 — cutover (DEFERRED, needs supervised execution)

1. Seed the Map Ranking tenant + memberships in the platform DB (SQL above / a backfill from
   each app's existing users). Preserve the `map-ranking` id.
2. MTOS: adopt `AuthzContextV1` + `resolveTenantAccess` (retire its own `TenantContext`/`Role`
   divergence); read client truth from the Engine (the `SEOOS_READ_MODE=engine` overlay).
3. SEOOS: resolve tenant via the platform DB instead of `MTOS_PILOT_TENANT_ID`.
4. Migrate SEOOS's own data off `tenant-map-ranking-demo` → `map-ranking` (queued task).
5. Move integration connections to the tenant level in the platform DB (or a shared
   integrations table) so both apps reuse one set of tenant credentials.
6. Add the update-propagation path: department change → PlatformService validates → canonical
   write + audit event → outbox notify. (`OutboxEventV1` already exists.)

Each step is flag-gated and reversible; do NOT run against production auth without a go-ahead.

## Adding another department app (future)

Register an `AppDefinition` (key/name/status), create a `TenantAppInstallation` for the tenant,
and the app inherits tenant context, membership/permissions, Engine access, integrations, audit,
and branding through the shared layer — no new tenant, no duplicated client identity.
