# MTOS Requirements Traceability

## Source Coverage

All source materials were reviewed:

- `MTOS Final Master Prompt.md`
- 25 section PDFs in `master-prompt-by-sections/`
- extracted validation inventory in `analysis/pdf-review.md`

This matrix maps each source section to implementation intent.

## Section Matrix

| Section | Focus | Implementation Treatment |
| --- | --- | --- |
| 1 | Executive summary, mission, product identity | Product constitution; enforced in copy, IA, and non-goals |
| 2 | Core design principles and philosophy | Global architecture and AI guardrails |
| 3 | Dual-agent intelligence architecture | Provider abstraction and AI routing foundation |
| 4 | System architecture | Layered modular-monolith baseline |
| 5 | Client Intelligence Package | Core immutable intelligence contract in phase 1 |
| 6 | Integration and connector architecture | Connector abstraction, validation, security, and health model |
| 7 | Workflow lifecycle | Primary product loop: Monitor -> Prepare -> Conduct -> Execute -> Evaluate -> Learn -> Optimize |
| 8 | Client intelligence framework | Client workspace information architecture and intelligence domains |
| 9 | Intelligence engine framework | AI service boundaries and specialized synthesis patterns |
| 10 | Decision intelligence engine | Deferred enterprise decision orchestration; phase 4+ |
| 11 | Goal intelligence engine | Deferred goal alignment engine; phase 4+ |
| 12 | Monthly Touch preparation engine | Phase 1 core build scope |
| 13 | Live meeting intelligence engine | Phase 2 core build scope |
| 14 | Execution engine | Phase 3 core build scope |
| 15 | QA and coaching engine | Phase 4 core build scope |
| 16 | Scoring framework | Phase 4 scoring and explainability scope |
| 17 | Human-centered experience principles | Primary UX constitution; active from day one |
| 18 | Operational workspace architecture | Workspace-first app structure; active from day one |
| 19 | Platform services architecture | Shared services roadmap; active in simplified form from day one |
| 20 | AI contract specification | Stable internal AI request/response contracts; active from phase 1 |
| 21 | Governance | Release, prompt, and quality guardrails; active from day one |
| 22 | Domain model | Source for entities, aggregates, and invariants |
| 23 | Data architecture | Firestore-first operational model with deferred advanced stores |
| 24 | API and event-driven architecture | Command/event workflow pattern; active from phase 1 |
| 25 | Infrastructure, security, deployment | Target stack and production hardening roadmap |

## Phase Mapping

### Phase 0

- Sections 1, 2, 4, 17, 18, 21, 22, 23, 24, 25

### Phase 1

- Sections 5, 7, 8, 12, 17, 18, 19, 20, 22, 23, 24

### Phase 2

- Sections 3, 7, 13, 17, 18, 20, 24

### Phase 3

- Sections 6, 7, 14, 19, 22, 24, 25

### Phase 4

- Sections 15, 16, 20, 21, 22, 23, 24, 25

### Phase 5

- Sections 9, 10, 11, 19, 21, 23, 24, 25

## Non-Negotiable Requirements

These rules must remain true across all phases:

- every recommendation is evidence-based
- AI never invents metrics, commitments, or unsupported upsells
- user experience remains calm, uncluttered, and role-aware
- work is organized into purpose-built workspaces, not disconnected pages
- client context is available without forcing users to hunt through reports
- commitments remain visible until resolved
- outputs preserve source transparency and confidence visibility
- high-impact outputs remain human-controlled
- tenant isolation and auditability are mandatory

## Phase-One Must-Haves

- Command Center answering "what deserves my attention right now?"
- Client Intelligence Workspace with a 360 client view
- Monthly Touch preparation workspace
- Executive brief generation
- Agenda generation
- wins, risks, opportunities, and recommendations
- preparation checklist and readiness indicators
- post-meeting summary and follow-up draft
- commitment tracking foundation
- tenant-aware architecture and role-aware navigation
- evidence and confidence display for AI outputs

## Deferred Until Later Phases

To avoid an overloaded first release, these capabilities are intentionally deferred:

- full enterprise decision engine
- full enterprise goal engine
- deep executive intelligence workspace
- full calibration, benchmarking, and recognition systems
- full connector catalog
- dedicated graph, vector, and search infrastructure
- advanced predictive and comparative scoring across the organization

## Review Evidence

- The markdown source defines the canonical requirements and section headings.
- The PDF review confirms all 25 section documents are present and aligned to the master prompt.
- The roadmap in `docs/mtos-roadmap-and-build-plan.md` is the active implementation guide derived from this traceability matrix.
