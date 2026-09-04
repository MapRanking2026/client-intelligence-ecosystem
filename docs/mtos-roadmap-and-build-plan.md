# MTOS Roadmap And Build Plan

## 1. Source Review Status

This build plan is based on a full review of:

- `d:\motsv7\MTOS Final Master Prompt.md`
- All 25 section PDFs in `d:\motsv7\master-prompt-by-sections\`
- Cross-check inventory in `d:\motsv7\analysis\pdf-review.md`

The PDFs align to the master prompt sections and act as section-level validation artifacts. The master prompt remains the canonical implementation source.

## 2. Build Decision

MTOS should be built as one product delivered in structured phases, not as a one-shot enterprise release.

Why:

- The specification defines an enterprise operating system, not a narrow single feature.
- The highest-value user outcome is immediate Account Manager readiness before, during, and after each Monthly Touch.
- A phased approach preserves architecture quality, avoids a bloated first release, and lets the platform earn trust with evidence-backed workflows before adding deeper scoring, coaching, and governance layers.

## 3. Product North Star

Monthly Touch OS exists to help Account Managers:

- understand client status quickly
- prepare every monthly meeting with confidence
- run better client conversations with less cognitive load
- capture commitments, risks, and opportunities without losing flow
- execute follow-up actions with accountability
- improve performance over time through evidence-backed coaching

MTOS is not a reporting dashboard, generic chatbot, CRM replacement, or document repository. It is a decision-support and execution operating system for client touchpoints.

## 4. Product Experience Strategy

### Design Principles

- Reduce thinking. Increase understanding.
- Show the right information at the right time.
- Put client context before raw metrics.
- Keep AI assistive, explainable, and dismissible.
- Optimize for calm, focused, professional workflows.
- Use progressive disclosure instead of information overload.

### Primary MVP Navigation

- Command Center
- Clients
- Monthly Touch
- Commitments
- Opportunities
- Global Search / Command Palette

### Core MVP Workspaces

- `Command Center`: priorities, risks, upcoming meetings, follow-ups, next best actions
- `Client Intelligence Workspace`: 360 client understanding, health, relationship, roadmap, history
- `Monthly Touch Workspace`: preparation, agenda, live meeting support, transcript, summary, follow-up
- `Commitment Workspace`: all promises, owners, due dates, reliability, overdue work
- `Opportunity Workspace`: upsell, expansion, education, and strategic growth opportunities

### Role Strategy

- Account Manager is the primary day-one role
- Manager and QA views are included as scoped supporting surfaces
- Admin and system operations remain behind permission-aware areas
- Executive intelligence is deferred until after core AM adoption

## 5. Product Scope By Phase

### Phase 0: Foundations

Goal: establish the platform constitution, domain boundaries, design system, auth model, and tenant-safe data model.

Deliver:

- product roadmap and technical build plan
- domain model and collection structure
- design system tokens and workspace shell
- authentication and role model
- audit and observability foundations
- seed data model for demo and development

### Phase 1: AM Core OS

Goal: make every Account Manager fully prepared and operationally organized for Monthly Touch.

Deliver:

- Command Center
- Client Intelligence Workspace
- Monthly Touch Preparation Engine v1
- Executive Brief generation
- Agenda generation
- Wins, risks, opportunities, and strategic recommendations
- preparation checklist and readiness score
- Commitment Workspace v1
- post-meeting summary and follow-up drafting
- immutable Client Intelligence Package v1

Success:

- Account Managers can prepare and complete a meeting cycle without external spreadsheets or scattered notes.

### Phase 2: Live Meeting Copilot

Goal: provide real-time assistance without distraction.

Deliver:

- live meeting dashboard
- agenda progress
- structured live notes
- subtle talking-point support
- question recommendations
- commitment capture during meeting
- live risk and opportunity reminders
- graceful fallback when transcription is unavailable

Success:

- meeting quality improves while the interface remains calm and non-intrusive

### Phase 3: Execution And Automation

Goal: ensure nothing discussed during the meeting is forgotten.

Deliver:

- execution engine v1
- structured action routing
- commitment assignment and tracking
- opportunity creation from meeting outcomes
- follow-up tasks and notifications
- integration adapters for external systems
- workflow status tracking

Success:

- every commitment becomes accountable work with clear ownership

### Phase 4: QA, Coaching, And Scoring

Goal: continuously improve Account Manager performance and explain quality outcomes.

Deliver:

- 17-point QA workflow
- transcript evidence viewer
- coaching recommendations
- performance trends
- meeting quality and preparation scores
- commitment reliability scores
- Explain Mode for major scores

Success:

- every evaluation is evidence-backed, reviewable, and useful for coaching

### Phase 5: Enterprise Expansion

Goal: scale MTOS into a full operating system.

Deliver:

- broader connector catalog
- deeper knowledge search and retrieval
- executive intelligence workspace
- governance automation
- advanced analytics and benchmarking
- platform services hardening
- deployment automation, canaries, DR drills, and compliance workflows

## 6. Technical Architecture

### Recommended Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui
- Backend runtime: Next.js server actions and route handlers for the app surface, with room to split workers later
- Platform services: Firebase Auth, Firestore, Cloud Storage
- Background execution: Cloud Tasks, Cloud Scheduler, Cloud Run workers in later phases
- AI layer: provider abstraction for Gemini and Claude, routed through stable internal contracts
- Infrastructure target: GCP + Cloudflare + GitHub Actions

### Delivery Shape

Start as a modular monolith with clear domain modules and evented workflows.

Do not start with microservices.

Why:

- the spec requires strong boundaries, not immediate service sprawl
- the current repository has zero implementation code, so speed with quality matters
- modular monolith first keeps the platform testable, deployable, and easier to evolve

### High-Level Layers

- `presentation`: workspace UI, interaction states, accessibility, responsive shell
- `application`: commands, use cases, workflow orchestration, role-aware actions
- `domain`: entities, aggregates, invariants, scoring models, business rules
- `infrastructure`: persistence, auth, connector adapters, AI providers, queues
- `platform`: audit, notifications, search, configuration, observability

## 7. Core Domain Model

### Primary Aggregates

- Tenant
- User
- Client
- MonthlyTouch
- ClientIntelligencePackage
- Commitment
- Opportunity
- QAEvaluation

### Key Supporting Entities

- Roadmap
- Deliverable
- MeetingNote
- Transcript
- Risk
- Recommendation
- ScoreSnapshot
- Notification
- AuditEvent

### Domain Invariants

- every object is tenant-scoped
- Client Intelligence Packages are immutable snapshots
- approved QA evaluations are immutable
- commitments remain visible until resolved
- every AI recommendation must carry evidence and confidence
- critical outputs require human review or explicit user acceptance

## 8. Initial Data Architecture

### Operational Storage

Use Firestore for:

- tenants
- users
- clients
- monthly touches
- commitments
- opportunities
- QA evaluations
- notifications
- connector accounts
- workflow jobs
- event envelopes

Use Cloud Storage for:

- transcripts
- recordings
- generated artifacts
- uploaded documents
- prompt assets

### Phase 1 Collections

- `/tenants/{tenantId}`
- `/tenants/{tenantId}/users/{userId}`
- `/tenants/{tenantId}/clients/{clientId}`
- `/tenants/{tenantId}/monthlyTouches/{touchId}`
- `/tenants/{tenantId}/cips/{cipId}`
- `/tenants/{tenantId}/commitments/{commitmentId}`
- `/tenants/{tenantId}/opportunities/{opportunityId}`
- `/tenants/{tenantId}/qaEvaluations/{qaId}`
- `/tenants/{tenantId}/events/{eventId}`
- `/tenants/{tenantId}/jobs/{jobId}`

### Deferred Data Systems

These are valid future layers, but not phase-one requirements:

- dedicated vector store
- dedicated knowledge graph database
- dedicated event store product
- dedicated search engine

## 9. Workflow Architecture

The product should follow the client success lifecycle defined in the spec:

- Monitor
- Prepare
- Conduct
- Execute
- Evaluate
- Learn
- Optimize

### Phase 1 System Loop

- connector and internal data refresh
- generate Client Intelligence Package
- produce Monthly Touch prep package
- support meeting and capture outcomes
- create commitments and follow-up outputs
- update client state and dashboard priorities

### Event Model

Core events for initial delivery:

- `client.created`
- `cip.generated`
- `monthly_touch.created`
- `monthly_touch.prepared`
- `meeting.started`
- `meeting.completed`
- `commitment.created`
- `commitment.completed`
- `opportunity.created`
- `qa.drafted`
- `qa.approved`

## 10. AI Architecture

### AI Product Rules

- retrieve before reasoning
- validate before generation
- explain every recommendation
- show confidence, source freshness, and evidence
- allow users to accept, modify, dismiss, or request explanation
- never invent metrics, commitments, or unsupported recommendations

### Practical Phase 1 AI Use Cases

- executive brief generation
- agenda generation
- wins / risks / opportunities synthesis
- readiness explanation
- post-meeting summary drafting
- follow-up drafting

### Deferred AI Use Cases

- fully dynamic live coaching
- complex sentiment analysis
- predictive scoring at enterprise depth
- automated decision routing across departments without review

## 11. Integration Strategy

### Phase 1 Priorities

- internal data model and seedable mock integration layer
- connector abstraction compatible with future external systems
- support for manual and scheduled refresh patterns

### Phase 2+ Priorities

- ClickUp
- Google ecosystem
- CRM
- knowledge sources
- communication systems
- future MCP-compatible resources

### Connector Rules

- connectors retrieve and normalize only
- connectors do not perform business reasoning
- every connector supports retry, health, audit, and secure secrets handling
- all inbound integration traffic must be signed, validated, and tenant-safe

## 12. Security And Governance Guardrails

- resource-level RBAC
- MFA-ready auth model
- strict tenant isolation
- encryption in transit and at rest
- immutable audit events
- prompt and scoring versioning
- transcript privacy controls
- deletion and export paths
- explainable scores
- human approval for high-impact outputs

Release blockers:

- cross-tenant data leaks
- missing auditability
- secrets in logs
- unverified inbound integrations
- scores without evidence
- AI outputs that cannot surface source support

## 13. Initial Repository Target

The repository should evolve into:

```text
apps/
  web/
packages/
  ui/
  domain/
  workflows/
  ai/
  config/
docs/
  mtos-roadmap-and-build-plan.md
  requirements-traceability.md
analysis/
  pdf-review.md
```

## 14. Immediate Implementation Plan

### Sprint 1

- scaffold the app shell and workspace architecture
- establish design tokens and navigation
- implement auth scaffolding and tenant-aware app layout
- model core domain types
- create seed data and repository adapters

### Sprint 2

- build Command Center
- build Client Intelligence Workspace
- build Monthly Touch Preparation Workspace
- implement CIP mock generation pipeline
- render executive brief, agenda, wins, risks, and opportunities

### Sprint 3

- build Commitment Workspace
- build post-meeting summary flow
- add AI recommendation cards with evidence and confidence
- add global search and command palette
- add activity history and notifications scaffolding

### Sprint 4

- introduce live meeting workspace v1
- add meeting notes, talking points, and commitment capture
- add workflow states and job progress surfaces
- harden loading, error, and empty states

## 15. Build Standard

The implementation should optimize for:

- exceptional UX before feature count
- evidence-backed intelligence before automation depth
- stable information hierarchy before analytics expansion
- scalable architecture before connector volume
- trustworthy AI before aggressive autonomy

That is the correct interpretation of the MTOS specification.
