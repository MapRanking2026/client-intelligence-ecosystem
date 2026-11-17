# Client visibility and first-brief quality

The attached Belza brief was used as a structural reference. Its names, metrics, explanations and embedded operational instructions were not copied into other accounts or executed.

## Audience policy

- Internal preparation retains open commitments, owners, dates, historical promises, QC/coaching, evidence gaps and proposed remedies. The review screen and open-items section label this material as team-only.
- Presentation/guide generators use a separate evidence projection: performance evidence and explicitly completed work. They do not receive the raw internal brief, ClickUp source pages, project chat, internal strategy or backlog. Approved tickets are not treated as completed tasks. Unknown/cancelled statuses do not qualify as completed work.
- Shared viewing guards cover saved decks, the client screen, live guide parts, the legacy live mode, presentation previews and exported PowerPoint slides/notes. Task rows require a completed status; pending/proposed rows are removed, and an unfinished-work heading is replaced with “Completed work” only when completed items remain. Empty task-only slides disappear. Available performance declines remain visible.
- Agenda and recap assembly excludes unfinished tasks and client-side task asks. Internal notes/tickets remain intact. The shared Intercom sender and confirmation-email sender reject unfinished-task text in edited drafts. Loom script/email saves apply the same policy. Existing already-sent emails and recorded videos are not retroactively changed.
- Existing stored decks are filtered on view/export. Existing internal briefs are not silently overwritten; regenerate preparation to obtain the richer new document.

## Brief structure

Generation instructions follow the reference's header/source/correction/gap notes, retention assessment, prior QC, detailed client snapshot, discovery questions, look-back, spoken agenda, internal open-items check, verified wins, issues, relevant service/performance reviews, goals, opportunities, content questions, close and client-safe agenda. The current MTOS section identifiers and review workflow remain intact.

The generator receives all fetched commitments/opportunities rather than only the first five. Completed commitments are gathered separately before the model call. The model output ceiling is increased for the detailed document. Missing or thin sections receive a clearly labeled evidence-only fallback; the performance section includes the available detailed source evidence. Missing facts remain missing, and no completion date, numeric goal, causal explanation, review or account fact is fabricated. No live model generation for a real account was performed during validation.

## Validation

- Full project validation passed: Next.js route type generation, TypeScript and ESLint. The content-policy suite and isolated browser suite passed. Regression checks passed for live-call timing/notes, touch progress/stages, preparation parsing/generation, agenda/recap email, Follow-Through notes/score/trackers/finish and QC submission. No-show orchestration checks also passed, including rejection of unfinished-task text in a Loom script.
- `npm run check:client-content`: synthetic screenshot scenario, unknown-status exclusion, preservation of real declines, client evidence separation, guide filtering, populated first-brief structure, internal backlog preservation, agenda/recap policy and actual PPTX XML/presenter-note inspection.
- `npm run check:client-content-ui`: actual presentation viewer in an isolated browser harness using synthetic content. Completed work renders; the screenshot's open/proposed rows and unfinished-work heading do not. Screenshot inspected; no browser page errors. The harness does not load the entire application's stylesheet or authenticate to a real client account.
- Regression fixtures now identify the general deck example as completed work and expect unfinished asks/commitments to remain internal. Two stale assertions were aligned with the existing source-first meeting-link and missing-signature behavior; no meeting-link precedence was changed.
- Original slide/guide generation positions are retained so filtering does not attach old AM capture notes or screen preferences to a different section.
- No client email, Calendar event or live account record was changed by these checks. Application deployment and credentialed generation of real-account briefs were not performed.
