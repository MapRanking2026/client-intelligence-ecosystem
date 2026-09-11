/**
 * ============================================================================
 * TEMPORARY GOVERNING RULE — OUTBOUND LOCK (read-only mode)
 * ============================================================================
 * While this lock is ON, SEOOS must NOT change anything in any external system:
 *   - no emails sent (Resend),
 *   - no deliveries/writes to MTOS (the S2S gateway),
 *   - no writes to ClickUp, GBP, or any third party.
 *
 * Reads/pulls IN are unaffected — ClickUp/GBP/GSC/Drive/Map-Ranking reads, OAuth
 * token exchange, the client auto-sync, and AI drafting all keep working. Data
 * comes in and stays inside this application; nothing goes out.
 *
 * NON-BYPASSABLE BY DESIGN:
 *   - The lock is ON by DEFAULT.
 *   - It can only be lifted by the operator setting the environment variable
 *     SEOOS_OUTBOUND_UNLOCKED=true (and redeploying). No user, admin, role, or
 *     in-app control can turn it off — there is deliberately no UI toggle.
 *
 * Any NEW outbound/egress action added in the future MUST call
 * assertOutboundAllowed(...) (or check isOutboundLocked()) so it stays covered.
 * ============================================================================
 */

/** Thrown by outbound actions while the lock is ON. Message is user-facing. */
export class OutboundBlockedError extends Error {
  constructor(action?: string) {
    super(
      `Blocked — SEOOS is in read-only mode (outbound lock is ON)${
        action ? `: "${action}" would change an external system` : ""
      }. Nothing is sent or changed outside this application until the lock is lifted.`,
    );
    this.name = "OutboundBlockedError";
  }
}

/**
 * True unless the operator has explicitly lifted the lock via the environment.
 * Read at call time (never cached) so a redeploy takes effect immediately.
 */
export function isOutboundLocked(): boolean {
  return process.env.SEOOS_OUTBOUND_UNLOCKED !== "true";
}

/** Throw if an outbound action is attempted while the lock is ON. */
export function assertOutboundAllowed(action: string): void {
  if (isOutboundLocked()) throw new OutboundBlockedError(action);
}
