# Google Meet workflow

Implemented in the Monthly Touch original and v2 workspaces. This integrates with Google Meet's external call interface; it does not embed Meet inside MTOS.

## Enable after deployment

1. Enable Google Calendar API, Google Meet REST API and Google Drive API in the existing OAuth Cloud project (Docs API remains used by legacy parsing).
2. Update the OAuth consent configuration for Calendar read, Meet read, Meet app-created room management and full Drive access. Reconnect each user's Google Meet integration to grant the new scopes. Full Drive scope is needed to share existing Meet-generated files, and is a restricted Google scope; comply with Google's verification requirements for the deployment.
3. Configure `CRON_SECRET`. The meetings endpoint fails closed without it. The cron in vercel.json is scheduled daily at 08:00 UTC to support Vercel Hobby. Hobby execution may occur later within that hour. Use Retrieve files & analyze after a call for immediate manual processing; frequent automatic checks require a compatible hosting plan or a separately configured external scheduler. This is polling, not a Google push subscription; files are processed after Google generates them, on the next successful sweep. No background work runs merely because these source changes exist locally.
4. Open a Monthly Touch, click Sync Google meetings, optionally save the client's actual attendee emails, and select the correct Calendar occurrence. Title matches are explicitly labeled and should be checked. If the Meet link has multiple recent calls, select the exact conference.
5. Start Live Meeting opens Google Meet in another tab and opens the MTOS guide. Meet's Join now / admission and browser device permissions still apply. Open guide only keeps the existing guide available without Google.
6. End meeting for everyone uses spaces.endActiveConference for an MTOS-created room. Google documents meetings.space.created as its required scope. Existing Calendar calls must be ended in Meet. The server rechecks the active conference before issuing the end request.

## Matching and data

Calendar history covers one year back and 90 days ahead on the connected primary calendar, with pagination. The UI labels historical appointments separately from completed conferences verified over the last 29 days. Google deletes conference records 30 days after the call; these counts are not all-time attendance totals. No inference of attendance from a calendar event.

Automatic transcript analysis requires a client-visible touch, selected meeting code and a conference from today/yesterday in the connected primary calendar's timezone. Recurring links do not uniquely identify a conference. No broad Drive title lookup is used by the interactive transcript endpoint. Explicit selection resolves multiple redials; all generated transcript sessions within the chosen conference are combined chronologically with speaker names and timestamps. An existing post-meeting transcript/analysis is preserved, and transcript-less notes are not passed off as dialogue.

The scheduled sweep shares generated native Meet transcript Docs and recording MP4s across all accessible conferences started in the last three days for each connected registered user, including meetings not linked to a client. This retries processing delays but is not a historical backfill. Only selected/linked recent client touches are analyzed. Native artifact identifiers come directly from the conference's transcript/recording resources. support@mapranking.com receives direct Editor (`writer`) permission; permission failures remain visible and are retried. Sharing notifications are disabled. Organization restrictions and the connected account's actual sharing rights still apply. A recording's Editor permission is file access, not a video editor.

Transcript analysis creates reviewable drafts only. Existing approval gates for emails, ClickUp tickets and other follow-up actions remain in force. Recording/transcription must have been enabled in Meet with an eligible account; this feature does not silently start recording.

## Validation

Run `npm run check:google-meet`, `npm run check:transcript-parsing`, and `npm run check`. The matching fixtures are synthetic. Live verification requires OAuth consent and an actual recorded/transcribed test call. Test delayed transcript and recording readiness separately, access denied, two calls on one link, timezone midnight/DST, duplicate sync requests, preservation of reviewed analysis, client visibility, cron authentication and Editor access to both files. Do not claim a live grant, ended call, or successful analysis without inspecting those actual results.

Official references:
- https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list
- https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/endActiveConference
- https://developers.google.com/workspace/meet/api/guides/artifacts
- https://developers.google.com/workspace/drive/api/guides/manage-sharing
