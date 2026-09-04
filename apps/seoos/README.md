# SEOOS

SEO Operations System — the second app in the Client Intelligence Ecosystem
monorepo. Owns internal SEO operations and produces structured **SEO
Intelligence packages** for MTOS. See
`apps/mtos/docs/architecture/mtos-seoos-boundaries.md`.

## First vertical slice (this scaffold)

Request → Package, built entirely on the shared packages:

- `@cie/contracts` — `SeoIntelligenceRequestV1`, immutable `SeoIntelligencePackageV1`,
  capability catalog, evidence/confidence/data-gap.
- `@cie/core` — deterministic idempotency keys, request status machine.

Flow: submit a request (`POST /api/seo/requests`) → the engine dedupes by
idempotency key → runs the status lifecycle (`submitted → queued → processing →
qa_review → ready`) → produces an immutable package. UI at `/requests`.

### Slice limitations (intentional, to be replaced)

- **In-memory store** (`src/lib/server/seo-engine.ts`): resets on restart, not
  shared across serverless instances. Swap for the Firestore-backed adapter +
  durable outbox behind the SEOOS server boundary.
- **Stubbed auth** (`src/lib/server/context.ts`): a demo tenant from a header.
  The real app enforces authn + tenant + client visibility + app membership +
  permission before any engine call.
- **Stub capability producers**: deterministic placeholder package data.

## Flags

`SEOOS_ENABLED` / `SEOOS_REQUESTS_ENABLED` (server-evaluated). Default ON within
this app; set to `false` to disable. MTOS-side consumption stays off by default.

## Scripts

```bash
npm run dev -w apps/seoos      # or: npm run dev:seoos   (from repo root)
npm run build -w apps/seoos
```
