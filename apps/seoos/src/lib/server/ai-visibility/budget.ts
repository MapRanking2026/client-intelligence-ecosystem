import { nowIso } from "@/src/lib/ids";
import { round6 } from "@/src/lib/ai-visibility/cost";
import { monthKey } from "@/src/lib/ai-visibility/util";
import { spend, type SpendDocV1 } from "./store";

/**
 * Spending caps. Before every provider call the worker RESERVES the call's
 * worst-case cost against three ledgers (scan, client-month, agency-month). If
 * any reservation would exceed its cap the call is not made and the scan stops
 * safely. After the call the reservation is replaced by the cost calculated
 * from provider-reported usage.
 */

export interface Ledger {
  id: string;
  scope: string;
  month: string;
  capUsd: number;
}

export function ledgersFor(scan: { id: string; projectId: string; budgetCapUsd: number }, clientMonthlyCap: number, agencyMonthlyCap: number, now = new Date()): Ledger[] {
  const m = monthKey(now);
  return [
    { id: `scan__${scan.id}`, scope: `scan:${scan.id}`, month: "-", capUsd: scan.budgetCapUsd },
    { id: `client__${scan.projectId}__${m}`, scope: `client:${scan.projectId}`, month: m, capUsd: clientMonthlyCap },
    { id: `agency__${m}`, scope: "agency", month: m, capUsd: agencyMonthlyCap },
  ];
}

function blank(tenantId: string, l: Ledger): SpendDocV1 {
  return { schemaVersion: 1, tenantId, scope: l.scope, month: l.month, calculatedUsd: 0, reservedUsd: 0, updatedAt: nowIso() };
}

export async function reserve(tenantId: string, ledgers: Ledger[], amount: number): Promise<{ ok: true } | { ok: false; ledger: Ledger; used: number }> {
  const done: Ledger[] = [];
  for (const l of ledgers) {
    const res = await spend().transact<{ ok: boolean; used: number }>(tenantId, l.id, (cur) => {
      const doc = cur ?? blank(tenantId, l);
      const used = doc.calculatedUsd + doc.reservedUsd;
      if (used + amount > l.capUsd + 1e-9) return { next: null, result: { ok: false, used } };
      return { next: { ...doc, reservedUsd: round6(doc.reservedUsd + amount), updatedAt: nowIso() }, result: { ok: true, used } };
    });
    if (!res.ok) {
      await release(tenantId, done, amount, 0);
      return { ok: false, ledger: l, used: res.used };
    }
    done.push(l);
  }
  return { ok: true };
}

/** Replace a reservation with the calculated cost (0 when the call was not billed). */
export async function release(tenantId: string, ledgers: Ledger[], reserved: number, calculated: number): Promise<void> {
  for (const l of ledgers) {
    await spend().transact(tenantId, l.id, (cur) => {
      const doc = cur ?? blank(tenantId, l);
      return {
        next: {
          ...doc,
          reservedUsd: round6(Math.max(0, doc.reservedUsd - reserved)),
          calculatedUsd: round6(doc.calculatedUsd + calculated),
          updatedAt: nowIso(),
        },
        result: undefined,
      };
    });
  }
}

export async function monthSpend(tenantId: string, scope: "agency" | { projectId: string }, now = new Date()): Promise<{ calculatedUsd: number; reservedUsd: number }> {
  const m = monthKey(now);
  const id = scope === "agency" ? `agency__${m}` : `client__${scope.projectId}__${m}`;
  const doc = await spend().get(tenantId, id);
  return { calculatedUsd: doc?.calculatedUsd ?? 0, reservedUsd: doc?.reservedUsd ?? 0 };
}
