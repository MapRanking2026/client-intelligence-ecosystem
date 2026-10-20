import type { AivAttemptV1, AivAuditEventV1, AivObservationV1 } from "@/src/lib/ai-visibility/types";
import { listAudit } from "./audit";
import { attempts, observations } from "./store";

/** Evidence bundle for one observation, scoped to the project (caller has already authorized the project). */
export async function getEvidence(
  tenantId: string,
  projectId: string,
  obsId: string,
): Promise<{ obs: AivObservationV1; attempts: AivAttemptV1[]; corrections: AivAuditEventV1[] } | null> {
  const obs = await observations().get(tenantId, obsId);
  if (!obs || obs.projectId !== projectId || obs.isFixture) return null;
  const [atts, audit] = await Promise.all([
    obs.jobId ? attempts().listWhere(tenantId, "jobId", obs.jobId) : Promise.resolve([]),
    listAudit(tenantId, projectId, 1000),
  ]);
  return { obs, attempts: atts, corrections: audit.filter((a) => a.action === "observation.correct" && a.target === obsId) };
}
