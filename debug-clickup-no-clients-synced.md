# Debug Session: clickup-no-clients-synced [OPEN]

## Symptom
- User clicks `Sync` for ClickUp.
- No clients appear to be synced into MTOS.

## Expected
- Manager-assigned active ClickUp Health Tracker tasks should persist as MTOS client records.
- The logged-in user should see those synced clients in the app.

## Falsifiable Hypotheses
1. The ClickUp sync endpoint is returning an error before persistence and the UI is swallowing or not surfacing enough detail.
2. The sync runs successfully, but manager filtering rejects every task because the current logged-in identity does not match the ClickUp `Account Manager` field or assignee data.
3. The sync runs successfully, but it is pulling the wrong ClickUp task set because `CLICKUP_HEALTH_TRACKER_LIST_ID` is missing or incorrect.
4. Clients are being persisted, but the per-user Firestore roster under `users/{userId}/syncedClients` is empty or mismatched, so `/api/clients` returns no visible clients.
5. The ClickUp connection exists, but the workspace/list/task payload shape differs from the assumptions in `serializeTaskToClient()` and the tasks are being skipped or failing silently.

## Evidence To Collect
- Response payload from `POST /api/integrations/clickup/sync`
- Current server logs during sync
- Whether any Firestore writes are happening for `clients`, `monthlyTouches`, or `users/{userId}/syncedClients`
- The logged-in user identity used for manager filtering
- Whether the ClickUp task payload contains expected manager/status/custom-field data

## Evidence Collected
- Reproduced from the running UI at `/settings/integrations`.
- Exact failing request: `POST /api/integrations/clickup/sync`
- Exact response: `400 Bad Request`
- Exact error:
  - `Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value (found in field "selectedIds").`
- Failure occurs before ClickUp client persistence logic runs.

## Confirmed Root Cause
- The sync run audit record was always attempting to write `selectedIds`.
- When the sync button posts an empty body, `selectedIds` is `undefined`.
- Firestore rejects documents containing `undefined`, so the route exits before any ClickUp tasks are processed.
