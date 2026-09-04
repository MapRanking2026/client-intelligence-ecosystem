# MTOS ClickUp Integration Plan

## Goal

Integrate ClickUp into the MTOS pilot so Account Managers can work from Monthly Touch OS while still benefiting from the operational task system already used by the team.

The pilot integration should support:

- pulling relevant client and task context into MTOS
- showing open work tied to a client or monthly touch
- creating and updating follow-up tasks from post-call actions
- keeping commitments synchronized enough for pilot use

## Pilot Role Of ClickUp

ClickUp is not the MTOS user interface.

ClickUp is the pilot system of record for:

- operational tasks
- assignees
- due dates
- existing open work

MTOS is the system of record for:

- Monthly Touch workflow state
- prep package
- live meeting notes
- AI-generated meeting outputs
- extracted commitments and opportunities

## Pilot Sync Strategy

### Inbound To MTOS

Pull from ClickUp into MTOS:

- task title
- task description
- status
- assignee
- due date
- linked client
- linked account manager
- comments or last update timestamp where useful

Use inbound sync for:

- open commitments already tracked in ClickUp
- unresolved implementation items affecting the next touch
- context for prep and risk review

### Outbound From MTOS

Push from MTOS into ClickUp:

- new post-call commitments
- internal follow-up actions
- updates to existing commitment status
- due dates and owners confirmed during or after the meeting

## Pilot Mapping Model

### ClickUp To MTOS

- ClickUp task -> MTOS Commitment
- ClickUp assignee -> MTOS owner
- ClickUp due date -> MTOS due date
- ClickUp status -> MTOS commitment status
- ClickUp custom field or tag for client -> MTOS client linkage
- ClickUp custom field or tag for monthly touch -> optional MTOS touch linkage

### MTOS To ClickUp

- MTOS extracted action item -> ClickUp task
- MTOS commitment update -> ClickUp task update
- MTOS follow-up completion -> ClickUp status update where appropriate

## Required Data Model Additions

### Connector Account

- tenant id
- provider = clickup
- workspace id
- connected by
- access token reference
- refresh token reference if needed
- sync status
- last sync time

### External Record Mapping

- MTOS object id
- external provider
- external object id
- object type
- tenant id
- last synced at

### Sync Job

- job id
- provider
- direction
- status
- started at
- finished at
- cursor
- error summary

## Pilot User Flow

### 1. Connect ClickUp

- Tenant admin connects ClickUp workspace
- MTOS stores the connector account
- initial sync runs

### 2. Sync Client Work

- MTOS pulls ClickUp tasks relevant to each client
- tasks are mapped into client commitments and operational context

### 3. Prep Monthly Touch

- MTOS uses ClickUp-linked commitments as part of:
  - unresolved work
  - risk review
  - roadmap progress
  - meeting talking points

### 4. Complete Post-Call Workflow

- AI extracts new commitments
- AM edits and confirms them
- MTOS creates or updates ClickUp tasks

## Pilot Assumptions

- one ClickUp workspace is enough for the first pilot
- one mapping pattern for client linkage is enough initially
- commitments are the first object to sync deeply
- comments, attachments, and full thread sync can wait

## Technical Plan

### First Implementation Slice

- create ClickUp connector contract
- create connector account model
- create sync job model
- build manual sync endpoint
- build normalized task mapper
- expose synced commitments in MTOS

### Second Slice

- create outbound task creation from post-call commitments
- add update flow for due date, owner, and status changes

### Third Slice

- add scheduled sync
- add webhook ingestion if stable and needed

## Non-Goals For Pilot

- full bidirectional mirror of all ClickUp data
- complete project management replacement
- syncing every ClickUp entity type
- workflow automation across all departments

## Success Criteria

- AM can see relevant open ClickUp-linked work for a client
- AM can use that work during prep
- AM can create post-call follow-up tasks into ClickUp
- commitment ownership and due dates stay consistent enough for weekly pilot usage
