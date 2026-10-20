# AI Visibility Tracker (SEOOS)

Measures how often a Map Ranking client appears in AI-generated answers to local
buying questions — with evidence for every number. Built inside SEOOS on the
existing client records, authorization and Firestore persistence (see
`adr/0002-ai-visibility-tracker.md`).

UI: **SEOOS → AI Visibility** (`/ai-visibility`). Providers & caps:
`/ai-visibility/settings`.

## 1. What it measures (and what it does not)

| Channel | What it is | Status |
|---|---|---|
| A. Official API | One fresh API request per observation, web search/grounding enabled | **Anthropic** (Messages + `web_search_20250305`), **OpenAI** (Responses + `web_search`), **Gemini** (Interactions + `google_search`). Perplexity: *Unsupported* (no credentials to verify). |
| B. Consumer search surface | Google AI Overviews / AI Mode, ChatGPT app… | *Not configured* — no supported integration that preserves the surface is connected. API results are **never** relabelled as consumer results. |
| C. Manual | A user pastes an answer (and optional screenshot ≤ 700 KB) seen in a consumer app | Working; always labelled “manual”, reported separately. |

Every observation is a **sample**: answers vary with time, model, search behaviour,
location support and personalization. The tracker never claims rankings,
consumer-app equivalence or complete coverage.

## 2. Workflow

1. **Setup** (per client): the profile is seeded from the SEOOS project (canonical
   CIE client: name, website). Add/approve aliases, owned domains, services,
   categories, target cities (ZIPs, neighbourhoods), competitors (+domains),
   providers, frequency, repetitions and spending caps. *Suggest from website*
   reads one public page (SSRF-guarded) and adds **suggestions** with evidence —
   nothing is used until approved; addresses/licences/ratings are never invented.
   Activate when at least one service and one location are approved.
2. **Prompts**: generate versioned drafts from approved services × locations
   (unbranded discovery, service intent, comparison, branded, optional Spanish).
   Unbranded/comparison prompts are rejected server-side if they contain the
   client name/aliases/domains, competitor names/domains, URLs or steering hints.
   Edits create a new version; scans record the exact version and text sent.
   “Near me” prompts use the provider’s documented location control
   (Anthropic/OpenAI `user_location`) or are labelled `near_me_ambiguous` (Gemini).
   A city written in a prompt is labelled `explicit_in_text` — not a GPS observation.
3. **Scan**: *Review plan and cost* shows the prompt × location × provider ×
   repetition matrix, expected and worst-case cost and remaining caps. Start
   requires confirming that estimate (the server re-plans and refuses if it rose).
   Default pilot: ≤ 10 approved unbranded prompts, 1 location, 1 provider, 3 reps.
4. **Results / evidence**: every row opens an evidence drawer with the exact
   prompt, provider/model/API version, requested vs. applied location, search
   queries (and whether search actually ran), the answer with highlighted
   mentions, citations with their answer spans, findings + confidence, attempts,
   usage, cost and the raw response. Findings can be corrected (reason required,
   audited); corrections overlay the extractor output.
5. **Overview / Competitors / Citations / Recommendations / Report / CSV**.

## 3. Metric definitions (also shown in the UI)

*Valid collected answer* = collection status `success` AND analysis succeeded AND
not a refusal/empty answer. Failures, timeouts, rate limits, grounding failures,
refusals, empty and unanalyzed answers are **excluded and shown separately** —
never converted to zero visibility. A valid answer that does not mention the
client counts as 0.

| Metric | Formula |
|---|---|
| Mention rate | valid answers mentioning the client ÷ valid answers |
| Recommendation rate | valid answers affirmatively recommending the client ÷ valid answers |
| Owned-domain citation rate | valid answers citing an approved client domain ÷ valid answers |
| Top-three inclusion | answers with an explicitly ordered list placing the client 1–3 ÷ valid answers that contain an explicitly ordered list |
| Ordered position distribution | count by list position, ordered-list answers only (prose = “Mentioned; no ordered position”) |
| Competitor share of mentions | answers mentioning business X (≤ 1 per answer) ÷ total business-answer mentions (client + competitors + discovered). **Not market share.** |
| Collection success rate | answers returned (incl. refusals/empty) ÷ attempted observations (budget-stopped slots excluded) |
| Analysis coverage | analyzed ÷ successfully collected |
| Composite (optional) | 100 × (0.5·recommendation + 0.3·mention + 0.2·owned citation), always shown with its components |
| Uncertainty | Wilson 95% interval per rate; < 30 valid answers flagged “small sample” |

Branded and unbranded prompts, and the three channels, are never mixed. Trends
are one point per scan; a change in prompt versions, provider/model or settings
(the scan’s config fingerprint) breaks the line and is flagged “not comparable”.
Every metric links to the exact observations behind it, and the CSV export uses
the same filters (verified by tests).

### Detection rules (deterministic extractor `det-1.2.0`)
- Whole-token matching of name, approved aliases (legal suffixes optional) and
  owned domains — never substrings (`Grace Cleaning` ≠ `Ace Cleaning`). Generic
  aliases (“Cleaning Services”) are ignored and flagged at setup.
- A name match placed in a passage with a city/state in **another state** is not
  counted (likely a different business); same-state cities outside the service
  area lower confidence.
- Mentioned ≠ recommended: recommended = listed as a provider option or described
  with a recommending cue, with no negative/hedged qualifier in the same clause.
  Negative and ambiguous mentions are kept and reported.
- Positions only for explicitly ordered lists of businesses (`1.` / `### 1.`);
  “steps” lists and bullets have no position. Citation order is never a rank.
- Third-party citations that support a business (span overlap or title/snippet
  naming it) are attached to that business. Businesses named in list items that
  are not configured are reported as *discovered (unverified)*.

## 4. Architecture

- `src/lib/ai-visibility/*` — pure domain: schemas, extractor, metrics, prompts,
  recommendations, cost model, filters/CSV (unit-tested).
- `src/lib/server/ai-visibility/*` — store (Firestore `tenants/{t}/aiv*`, memory
  fallback for dev), provider adapters, queue, scheduler, budget ledger, services.
- Durable jobs: one doc per planned slot (`aivJobs`), transactional leases,
  bounded per-provider concurrency, requests-per-minute spacing, exponential
  backoff with full jitter (respects `Retry-After`), max 4 attempts (retry adds 3).
  Observation id = job id ⇒ retries/reclaims cannot double-count; every attempt
  (with cost) is kept in `aivAttempts`; attempts are written *before* the call so
  an interrupted call is recorded as `interrupted` and its budget reservation
  released.
- Triggers: `after()` processing when a scan starts; self-chained
  `POST /api/seo/ai-visibility/worker` (CRON_SECRET); daily Vercel cron
  `GET /api/cron/ai-visibility` (scheduler + queue + lease recovery);
  `npm run aiv:worker -w apps/seoos` for non-serverless hosts.
- Budget: each call reserves its worst-case cost against **scan**, **client-month**
  and **agency-month** ledgers; a call that would exceed any cap is not made and
  the scan stops as `budget_stopped`. After the call the reservation is replaced
  by the cost **calculated from provider-reported usage** at the documented rates
  (`cost.ts`, sources + dates). Pre-scan figures are labelled *estimates*.

## 5. Security

- Every page, API route, export, evidence file and correction checks
  `seo.package.read` / `seo.project.manage` / `integrations.manage` **and** that the
  project is in `listProjectsForViewer` (ADR-0001 invariant). Other clients → 404.
- Cron/worker routes accept only `Authorization: Bearer $CRON_SECRET`
  (constant-time compare); they are the only AI-visibility paths exempted from the
  session middleware.
- Provider keys stay in server env; the UI only shows “configured / not
  configured”. Errors and audit details pass through `redact()`.
- Model answers and fetched pages are untrusted: rendered as text (no HTML), links
  restricted to http(s) with `rel="noopener noreferrer nofollow"`, CSV cells
  neutralize formula injection, measurement requests have no tools beyond the
  provider’s own search, and nothing in an answer can trigger writes.
- Website fetch: http(s) only, default ports, no credentials, private/loopback/
  link-local/metadata ranges refused at DNS-resolution time (rebinding-safe),
  manual redirects re-validated, 2 MB / 10 s caps.
- JSON-only mutating endpoints (CSRF-resistant with SameSite=Lax cookies).
- Important changes are written to `aivAuditEvents` (Setup → Audit log).

## 6. Setup & deployment

1. Env: see `apps/seoos/.env.example`. Provider keys are the existing SEOOS keys
   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) or `AIV_*` overrides.
   `CRON_SECRET` is required for the worker chain and cron.
2. Deploy SEOOS as today. `vercel.json` adds a daily cron
   (`20 9 * * *` UTC → `/api/cron/ai-visibility`, safe on all plans). On Vercel
   Pro you may raise the frequency (e.g. `*/15 * * * *`) for faster recovery of
   interrupted scans. If Deployment Protection is on, the self-chaining worker
   call needs a protection-bypass (set `AIV_WORKER_ORIGIN` accordingly) — otherwise
   long scans resume at the next cron run.
3. No migration: Firestore collections are created on first write; queries use
   single-field equality (no composite indexes).
4. In SEOOS: AI Visibility → Providers & caps → enable a provider → *Test
   connection* (makes a 1-token call where needed to detect billing problems) →
   set the agency monthly cap (default $50).

## 7. Operating costs (rates verified 2026-10-19)

| Provider · default model | Rates used | Typical modeled cost / observation* |
|---|---|---|
| Anthropic · claude-sonnet-5-5 | $2 / $10 per 1M tok; search $0.01 | ≈ $0.076 |
| Anthropic · claude-haiku-5-5 | $0.10 / $0.50; search $0.01 | ≈ $0.023 |
| OpenAI · gpt-5.4-mini | $0.75 / $4.50; search $0.01 + search tokens | ≈ $0.041 |
| Gemini · gemini-3.8-flash | $0.75 / $3.75 (rises 2027-01-01); search $0.014/query (free allowance ignored) | ≈ $0.049 |

\*Modeled: 2 searches × ~12k input tokens + ~700 output tokens. After ≥ 5
observations the estimate switches to the client’s historical average. The pilot
(10 prompts × 3 reps = 30 observations) costs roughly $0.70–$2.30 depending on
model. Firestore usage is small (≈ 3–4 writes per observation).

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Provider “Not configured” | Key env var missing on the server. |
| *Test connection* “Account/billing problem” | Provider account has no credit/quota. Fix billing; nothing is retried automatically. |
| Scan `budget_stopped` | A cap would have been exceeded. Raise the cap, then *Retry failed* (re-queues budget-blocked slots in place). |
| Scan stuck `running` | The chain stopped (e.g. Deployment Protection, no `CRON_SECRET`). Click *Resume processing* or wait for the cron; expired leases are reclaimed automatically. |
| Many `rate_limited` | Lower *Requests per minute* / *Max concurrent requests*. |
| `grounding_unavailable` | All searches failed; the answer is stored but excluded from metrics. |
| Mentions look wrong | Check aliases / competitor names, then *Re-run analysis* (collected answers are unchanged) or correct the finding (audited). |
| “Persistence is not configured” banner | Firebase admin env missing → memory store (dev only). |

## 9. Tests

```bash
npm run test:aiv -w apps/seoos                 # unit + integration (memory store)
# against the Firestore emulator:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_PROJECT_ID=demo-aiv \
FIREBASE_CLIENT_EMAIL=x@demo-aiv.iam.gserviceaccount.com FIREBASE_PRIVATE_KEY="$(cat dummy.pem)" \
  npm run test:aiv -w apps/seoos
# E2E (needs `next start` against the emulator; never production):
E2E_PROVIDER=fixture npm run test:aiv:e2e -w apps/seoos
```

Fixture data (`AIV_ENABLE_FIXTURE_PROVIDER=true`) is flagged `isFixture`, is
excluded from every dashboard/metric/export, and must never be enabled in production.

## 10. Known limitations

- Only one tenant is processed by cron (the SEOOS pilot tenant), matching how
  SEOOS sign-in works today.
- Detection is rule-based (English + basic Spanish text); it can miss unusual
  phrasings and does not use LLM extraction. Corrections are the safety valve.
- Gemini has no documented location control for Google Search grounding.
- Provider dollar figures are calculated from reported usage, not invoices.
- Screenshots are stored in Firestore (≤ 700 KB each); move to object storage if
  manual volume grows.

## 11. Verification results (2026-10-19/20, non-production: Firestore emulator + `next start`)

| # | Acceptance criterion | Result | How |
|---|---|---|---|
| 1 | Create client; approve services, locations, aliases | ✅ | Playwright UI (Setup page) |
| 2 | Generate and edit unbranded prompts | ✅ | UI: 12 drafts, edit → v2, branded name rejected server-side (422) |
| 3 | Connect a real provider | ✅ | Anthropic `claude-haiku-5-5`, Test connection incl. 1-token billable call |
| 4 | Small live scan within budget | ✅ | 10 prompts × 1 location × 3 reps = 30 observations; estimate $0.68, cap $2, **calculated $0.474** |
| 5 | Persist answers, citations, usage, evidence | ✅ | 30/30 stored; search executed 30/30; citations on 24; request ids, tokens, cost per row |
| 6 | Dashboard = stored observations | ✅ | Test recomputes valid/mention/recommendation from raw rows and compares API + rendered cards |
| 7 | Refresh / sign back in | ✅ | New browser context, data present |
| 8 | Retry failed job without duplicates | ✅ | Integration test (emulator): 4 failed attempts → retry → 1 observation, 6 attempts kept |
| 9 | Resume interrupted processing | ✅ | Integration test: crash after write + crash mid-call → lease reclaimed, attempt `interrupted`, no leaked reservation |
| 10 | Client isolation / unauthorized | ✅ | Specialist sees only allowed client; other client → 404 (API, export, page); anon → 401; cron/worker without secret → 401; specialist can’t change providers → 403 |
| 11 | Export = dashboard filters | ✅ | CSV row counts equal API rows for 4 filters/drill-downs |
| 12 | Scheduled scan via scheduler | ✅ | `GET /api/cron/ai-visibility` with CRON_SECRET started 1 scan, second call `already_exists`, scan completed (live, $0.012). Vercel’s own cron trigger is not exercised outside a deployment. |
| 13 | Missing credentials, rate limits, timeouts, partial failures | ✅ | UI shows Not configured / Unsupported; fixture tests for 429 + Retry-After backoff, timeout, auth/billing (non-retryable), malformed response, partial scan, budget stop; a real Anthropic “credit balance too low” 400 is classified as non-retryable billing error |

Other checks: 45 unit/integration tests pass on memory store and on the Firestore
emulator; `tsc --noEmit` clean; ESLint clean for all new/changed files (the 8
pre-existing SEOOS lint errors are unchanged); `next build` succeeds.
OpenAI and Gemini adapters are implemented against current docs and covered by
response-parsing tests, but were **not** live-called (no spend authorized for those
accounts). Perplexity is shown as Unsupported.

Live sample observation (fictional test client, La Vergne TN): 29 valid of 30
(1 excluded: answer truncated at max_tokens → default raised to 3,000); client
mentioned 0/29 (expected — fictional); most-mentioned businesses: Two Sisters Maid
to Clean 28, TotalCare Cleaning 22, M&A Cleaning Services 22; no answer used an
explicitly ordered list (so top-three has no denominator).
