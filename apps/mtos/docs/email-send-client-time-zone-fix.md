# Confirmation email and client time zones

## Reviewed behavior

The agenda approval screen reads its draft through agenda-email-service, then touch-approval-service reloads the same draft for sending through client-email-service and the existing per-user Gmail transport. The former content guard flattened all email HTML into one string and matched generic unfinished task titles. The agenda chose the calendar event zone or account manager profile zone. Stored draft HTML overrode newly generated schedule facts.

## Changes

- Client privacy checks operate on visible paragraphs/list items/table text, exclude markup/comments/styles/link destinations, and ignore generic task-title matches such as Google Ads. Real unfinished task descriptions and specific unfinished task titles remain blocked. The send error quotes the offending visible text.
- ClientRecord holds an optional timeZone. Resolution accepts a saved IANA region zone or explicit timezone fields in the imported account/ClickUp payload. It never infers the client zone from the AM, browser, calendar organizer or business location.
- The approval screen provides an explicit client time-zone save. Saving flushes draft edits, validates/scopes the client update and reloads schedule facts. It does not move the calendar event or send email. Missing client zones block sending even for edited/saved drafts.
- Server-owned schedule fields in unsent branded templates, including existing legacy headers, refresh in the client zone. Custom body text remains editable. Already-sent HTML remains unchanged. Arbitrary manually typed schedule text should still be reviewed by the AM.
- The preparation confirmation generator and follow-through recap use the same client zone. Changing a confirmation draft's zone requires regeneration before sending, rather than relabeling a previously generated clock value.
- Gmail transport, explicit send approval, support sender verification and duplicate-send protection remain in use.

## Verification

Synthetic tests only; no real client timezone was inferred and no live client email was sent.

- check:email-client-zone: account/custom-field resolution, missing/invalid/abbreviated zones, winter/summer clock changes, midnight date boundary, legacy header correction, repeat refresh, unknown-zone blocking and content privacy cases.
- check:email-send-fixes: mocked service reads and Gmail handoff, actionable blocked-content errors, scoped client-zone persistence, unchanged calendar instant and immutable sent HTML.
- check:no-show-ui: Chrome synthetic harness verifies explicit email approval, missing-zone disabled send, rejected EST input and explicit zone save without sending.
- Existing agenda, client content, Gmail transport, no-show, preparation and recap regression checks were run.

Deployment and real-account delivery are separate from these local checks. The screenshots alone do not establish Sparkle Plumbing's actual timezone or the full content of its stored draft.
