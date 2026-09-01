# Debug Session: clickup-oauth-team-auth [OPEN]

## Symptom
- User completes the ClickUp OAuth flow and lands on the workspace-selection screen.
- The page shows: `Whoops! Unable to authorize your teams. Please try again.`

## Expected
- The ClickUp OAuth callback should complete successfully.
- MTOS should store the ClickUp connection and return the user to the integrations page with a connected status.

## Falsifiable Hypotheses
1. The OAuth callback is arriving without a valid `state`, so MTOS rejects the callback before storing the connection.
2. The ClickUp token exchange request is malformed for ClickUp's OAuth requirements, so the code never becomes a usable access token.
3. The configured redirect URI in MTOS does not exactly match the one registered in ClickUp, causing the authorization to fail during callback completion.
4. ClickUp is returning a workspace/team authorization payload that this callback flow does not currently persist or interpret correctly.
5. The workspace-selection step succeeds in ClickUp, but the next redirect includes parameters that our legacy callback bridge fails to forward correctly.

## Initial Evidence
- The legacy callback route forwards all query params from `/api/integrations/clickup/callback` to `/api/integrations/oauth/callback` and injects `provider=clickup`.
- MTOS only treats the callback as successful when both `code` and `state` are present.
- The ClickUp OAuth flow in this codebase is special-cased with `transport: "clickup_query"` and omits `response_type=code` during authorization URL construction.
- The current env uses `CLICKUP_REDIRECT_URI="https://mtos.mapranking.com/api/integrations/clickup/callback"`.

## Suspected Root Cause
- ClickUp's OAuth authorize URL supports the standard authorization-code flow and returns users to the redirect URI with an authorization `code`.
- This codebase intentionally omits `response_type=code` for ClickUp, which makes the authorize request non-standard and can break the transition from workspace selection to callback completion.

## Findings (2026-08-30) [UPDATED]
- The stale hypothesis above is WRONG for the current code: `buildAuthorizationUrl` in
  `src/lib/server/integrations.ts` now sets `response_type=code` unconditionally for every provider,
  ClickUp included. So a missing `response_type` is not the cause.
- "Whoops! Unable to authorize your teams. Please try again." is rendered by **ClickUp**, on
  ClickUp's own Connect screen, BEFORE control returns to our callback. Our code never runs at that
  point, so it cannot be the source. This is an upstream (ClickUp app / account) failure.
- Most likely upstream causes, in order:
  1. Redirect URL registered in the ClickUp OAuth app does not EXACTLY match `CLICKUP_REDIRECT_URI`
     (`https://mtos.mapranking.com/api/integrations/clickup/callback`).
  2. `CLICKUP_CLIENT_ID` points at a deleted/mismatched ClickUp app.
  3. The authorizing ClickUp account lacks admin rights on the "Map Ranking" workspace, or
     third-party cookies are blocked in the browser.
- Cannot be verified from the repo: needs the ClickUp app dashboard + the deployed env values.

## Related change shipped
- Integration connections were tenant-shared (every user saw the same tokens). Now scoped per-user
  (except shared Map Ranking feeds: rank-tracker, geogrid, map-checkins). After deploy, each user
  reconnects their own ClickUp via a clean per-user flow, which removes the "already connected /
  can't reconnect" confusion. The ClickUp-side authorize error is separate and still needs the
  dashboard check above.

## Additional Evidence (2026-08-30)
- `.env` and `.env.local` both currently point `CLICKUP_REDIRECT_URI` to
  `https://mtos.mapranking.com/api/integrations/clickup/callback`.
- `.env` and `.env.local` contain DIFFERENT `CLICKUP_CLIENT_ID` and `CLICKUP_CLIENT_SECRET` values.
- In Next.js, `.env.local` overrides `.env` during local/dev execution, so the active local ClickUp
  app identity is the `.env.local` one, not the `.env` one.
- The screenshoted error is rendered on ClickUp's own authorize screen before MTOS receives the
  callback, which further supports that the break is in the specific ClickUp app/account config
  being used, not in the MTOS callback route.

## Updated Conclusion
- The remaining failure is most likely caused by the active ClickUp OAuth app configuration for the
  `.env.local` client id (`PHJD1JR6QV709WMBPPHTJE9XUBMCJVU7`) not matching the registered redirect URL
  or not being valid/authorized for the workspace account being used.
- No additional in-repo code change is justified until that upstream app configuration is verified.
