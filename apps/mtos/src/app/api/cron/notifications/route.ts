import { NextResponse } from "next/server";

import { runNotificationsAllTenants } from "@/src/lib/server/services/notification-service";

/**
 * The notification run: every two hours, every AM in every tenant.
 *
 * Not daily, because two of the things it raises are time-sensitive -- a prep reminder set to "2
 * hours before" cannot be delivered by a job that runs at nine in the morning, and an AM in Madrid
 * and one in Phoenix do not share a morning. Not hourly either, and that is a cost decision: each
 * pass reads one AM's clients and touches, so an hourly run over a book of a couple of hundred
 * clients is tens of thousands of Firestore reads a day per tenant, and this app has already had
 * production deploys fail on the daily read quota. Twelve passes a day is the compromise, and
 * `RUN_INTERVAL_MS` in the notifications contract is where its consequence is worked out: a
 * reminder can arrive up to one interval early, never late.
 *
 * ## The two hours do not come from vercel.json any more
 *
 * They came from a two-hourly entry there, and that entry took the project's deploys down:
 * Vercel Hobby accepts one run per day per cron and rejects the rest at config validation, before
 * a line is built, so four production deploys failed on a schedule rather than on their code. The
 * cadence now lives in `.github/workflows/mtos-notifications.yml`, which calls this route every two
 * hours, and the cron entry stays as a once-a-day floor so the run still happens if that workflow
 * is ever disabled. Two callers, one route, and no change to what a pass does.
 *
 * Everything it writes is idempotent on a dedupe key, which is what makes repeating it safe -- and
 * it is what makes a best-effort external scheduler acceptable here: a trigger that fires twice
 * raises nothing twice.
 *
 * It reads each AM's touches and clients and writes only to their own notification feed, plus at
 * most one digest email per AM per day to their own address. Nothing reaches a client.
 */
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  // Vercel also marks its own cron invocations with this header; accept them if no secret is set.
  return request.headers.get("x-vercel-cron") === "1";
}

/** The origin links in an emailed digest are made absolute against. */
function baseUrl(request: Request): string | undefined {
  const configured = process.env.MTOS_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return undefined;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = baseUrl(request);
    const report = await runNotificationsAllTenants(url ? { baseUrl: url } : {});
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The notification run failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
