import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { withVerifiedLeadMix } from "@/src/lib/contracts/lead-mix";

export async function getMonthlyTouchQueueView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const touches = await dataSource.getMonthlyTouches();

  const queue = await Promise.all(
    touches.map(async (touch) => ({
      touch,
      client: (await dataSource.getClientById(touch.clientId)) ?? null,
    })),
  );

  return {
    context,
    queue,
  };
}

export async function getMonthlyTouchWorkspaceView(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);

  if (!touch) {
    return null;
  }

  const [client, commitments, opportunities] = await Promise.all([
    dataSource.getClientById(touch.clientId),
    dataSource.getCommitments(touch.clientId),
    dataSource.getOpportunities(touch.clientId),
  ]);

  if (!client) {
    return null;
  }

  /*
    The scorecard's two lead-mix tiles, filled in from the verification review stored on this touch.

    Done on the way out as well as during the preparation, because every touch prepared before
    11 November 2026 has a stored scorecard whose "Form submissions" and "Calls missed" are null --
    they were hard-coded that way -- and an AM looking at one of those briefs should not have to
    sit through another account review to see numbers MTOS already holds. The review is already on
    the touch document (the review screen renders it below the brief), so this costs no extra read.

    Only ever adds: a scorecard that already carries these figures from its own preparation keeps
    them, and a touch with no review is left exactly as it is.
  */
  const touchWithLeadMix =
    touch.prepPack && touch.leadVerification
      ? {
          ...touch,
          prepPack: {
            ...touch.prepPack,
            businessScorecard: withVerifiedLeadMix(touch.prepPack.businessScorecard, touch.leadVerification),
          },
        }
      : touch;

  return {
    context,
    touch: touchWithLeadMix,
    client,
    commitments,
    opportunities,
  };
}
