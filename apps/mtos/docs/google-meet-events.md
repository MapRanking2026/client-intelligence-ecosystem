# MTOS Google event notifications

The original deployment failure was caused by an every-minute cron expression on Vercel Hobby. Commit `2f68026` changes the meetings fallback to daily at 08:00 UTC. Vercel confirmed the resulting production deployment Ready and assigned it to https://mtos.mapranking.com.

## What the new integration does

Google Workspace Events sends conference-ended and transcript, recording and Gemini smart-note file-generated events to Pub/Sub. Pub/Sub sends an authenticated request to MTOS. MTOS verifies Google's signature, issuer, audience and exact service-account email, checks its own subscription registry, and deduplicates successful deliveries in Firestore. Processing failures return a retry response to Pub/Sub.

MTOS retrieves the exact conference named by the event. Generated transcript, recording and note files receive Editor access for support@mapranking.com when Google permits that change. Analysis uses native transcript entries, and only proceeds for a matching client touch from today or yesterday in the connected user's Calendar timezone. It preserves existing analysis and human approval steps. User-wide subscriptions cover meetings whose space is owned by the connected Google user; they do not cover every meeting that user attends.

The daily job renews enabled seven-day subscriptions and checks missed artifacts. Google notifications can arrive after Google finishes file generation; this does not eliminate Google's processing time or promise instant delivery.

## Remaining activation steps

1. Restore the Google Cloud login on this computer: run `gcloud auth login francisco@mapranking.com`. The last read-only check failed because reauthentication was required.
2. Confirm the Cloud project that owns MTOS's Google OAuth client. Use that same project for Pub/Sub and Workspace Events. The CLI currently selects `mtos-new`, but this must be checked against a working OAuth client. The previous MTOS token refresh returned `deleted_client`; this requires repairing or replacing the configured OAuth client before the Google connection can work.
3. In the confirmed project, keep the existing billing account enabled. The setup helper checks billing but does not create or link a billing account. Free allowances are not a guarantee of a zero bill.
4. From `E:\motsv7\apps\mtos`, run:

   ```powershell
   .\scripts\setup-google-meet-events.ps1 -ProjectId YOUR_CONFIRMED_PROJECT -Origin https://mtos.mapranking.com
   ```

   The script enables the needed APIs, creates a topic and dedicated push identity, grants the Meet event publisher permission on that topic, grants the Pub/Sub service agent permission to mint tokens for that identity, and creates or updates an authenticated push subscription. It uses a 600-second acknowledgement deadline, retries and seven-day message retention. It does not create service-account keys.

5. Add the four values printed by the script to Vercel's **Production** environment:

   - `GOOGLE_MEET_EVENTS_TOPIC`
   - `GOOGLE_MEET_EVENTS_AUDIENCE`
   - `GOOGLE_MEET_EVENTS_PUSH_EMAIL`
   - `GOOGLE_MEET_EVENTS_PUSH_SUBSCRIPTION`

   Redeploy after changing environment variables. Preserve `CRON_SECRET`; Vercel's daily cron uses it independently of Google push authentication. If deployment protection covers the production webhook, permit Google push delivery to this exact route; the route still requires Google's signed identity.

6. Repair the Google OAuth credentials in Vercel if needed. Authorize the production callback URL already used by MTOS. Add the consent scopes requested by the integration, including Calendar read, Drive, Meet read, app-created Meet room controls, Docs read and Google profile. Reconnect Google Meet in MTOS Settings > Integrations.
7. Open a Monthly Touch, load Google meetings, then click **Enable Google file-ready notifications**. The button creates or renews the signed-in user's subscription and displays Google's returned state and expiration. Each connected user must enable their own subscription.
8. Verify a real meeting: end an owned meeting with transcription enabled, then confirm MTOS's subscription status, event journal, correct conference match, retrieved files and support permissions. Verify transcript analysis produces reviewable drafts. Live Google delivery and sharing have not yet been tested.

## Verification and limits

Synthetic checks cover exact conference extraction, event types, invalid source rejection and wrong Pub/Sub subscription rejection. TypeScript and changed-file lint checks passed. Those checks do not establish that Cloud permissions, OAuth credentials or real Google delivery are configured correctly.

Cloud activation has not been completed. No real Google file permissions were changed by the event implementation checks.

## Original documentation

- [Meet event types, payloads and ownership restrictions](https://developers.google.com/workspace/events/guides/events-meet)
- [Subscription creation and billing prerequisite](https://developers.google.com/workspace/events/guides/create-subscription)
- [CloudEvent structure and seven-day lifetime without resource data](https://developers.google.com/workspace/events)
- [Authenticated Pub/Sub push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
- [Subscription renewal](https://developers.google.com/workspace/events/reference/rest/v1/subscriptions/patch)
- [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing)
