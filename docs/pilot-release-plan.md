# MTOS Pilot Release Plan

## Goal

Ship the first usable Monthly Touch OS release for Account Managers as quickly as possible without waiting for the full enterprise platform.

This pilot release is successful when an Account Manager can:

- sign in
- see upcoming monthly touches
- open a client and current touch
- prepare using AI-generated meeting support
- run the live meeting workflow
- capture commitments and notes
- generate post-call follow-up
- sync tasks and related work with ClickUp

## Current Step

We are currently in the transition from mock MVP to pilot-release implementation.

Completed already:

- product roadmap and technical plan
- core workspace UI
- seeded API routes
- mock Monthly Touch workflow screens
- initial navigation and UX structure

In progress now:

- replace seeded-only data access with a service/data-source architecture
- define the pilot release sequence and cutline

## Pilot Release Scope

### Included

- Authentication for Account Managers
- Tenant-safe user and client access
- Client and Monthly Touch persistence
- ClickUp integration for task sync
- Command Center for upcoming monthly touches
- Pre-touch prep workflow
- Live-call workflow
- Post-call workflow
- AI-generated prep, summary, commitments, and follow-up draft
- Basic observability and audit logging

### Deferred

- advanced QA and coaching
- scoring engine
- executive intelligence
- deep analytics
- multi-connector catalog beyond pilot needs
- enterprise governance automation

## Pilot Workflow

### 1. Pre-Touch

- AM opens Command Center
- sees upcoming monthly touches
- selects the next client touch
- reviews synced client context and open commitments
- generates or refreshes the AI prep package
- edits brief, agenda, risks, opportunities, and talking points
- marks prep ready

### 2. Live Call

- AM opens live meeting mode
- tracks agenda progress
- captures structured notes
- captures commitments, questions, risks, and decisions
- uses AI assistance as a low-noise support layer

### 3. Post Call

- AM ends meeting
- AI drafts recap and follow-up
- commitments and next steps are extracted
- tasks sync into ClickUp
- touch is marked complete
- Command Center updates for the next workflow cycle

## Release Cutline

We ship the pilot when all of the following are real and working:

- login works
- client data persists
- monthly touches persist
- AM can run one full touch workflow end to end
- ClickUp sync works for the pilot mappings
- AI generates usable pre-call and post-call outputs
- audit trail and basic error monitoring are present

## Build Sequence

### Step 1. Data And Service Backbone

- introduce a real data-source abstraction
- move seeded data behind a seed adapter
- add service-layer access between UI/routes and data
- prepare the codebase for Firestore-backed repositories

### Step 2. Auth And Access

- add Firebase Auth
- add tenant and role context
- protect app routes and APIs
- gate AM access to their assigned clients and touches

### Step 3. Persistence

- add Firestore collections for tenants, users, clients, touches, commitments, opportunities, jobs, and events
- replace seed-backed adapters with repository implementations
- add pilot seed scripts

### Step 4. ClickUp Integration

- connect ClickUp
- map ClickUp tasks into MTOS commitments and workflow context
- create outbound task updates from post-call outputs
- add sync status and retry handling

### Step 5. Real Workflow Commands

- prepare monthly touch
- start live call
- save notes and commitments
- complete touch
- generate post-call outputs

### Step 6. AI Production Layer

- connect provider-backed generation
- add prompt contracts
- generate prep package
- generate recap and follow-up
- extract commitments and action items

### Step 7. Pilot Deployment

- deploy internal pilot environment
- enable AM onboarding
- run on real upcoming monthly touches
- collect feedback and stabilize

## Immediate Next Deliverables

- `docs/pilot-release-plan.md`
- `.env.example` with pilot config placeholders
- service/data-source abstraction under `apps/web/src/lib/server/`
- seed adapter moved behind the new abstraction
- first page and API route migrated to the service layer

## Guiding Rule

Do not broaden the product surface until the end-to-end AM workflow is real.

The pilot wins by being repeatable and useful, not by being enterprise-complete.
