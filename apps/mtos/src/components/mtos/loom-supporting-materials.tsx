import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { usableLoomUrl } from "@/src/lib/contracts/no-show";

export function LoomSupportingMaterials({ touch }: { touch: MonthlyTouchRecord }) {
  const loom = touch.noShow;
  if (loom?.resolution !== "loom") return null;
  return <section className="card mt-4 grid gap-3" aria-label="Loom supporting materials">
    <h2 className="h3">No-Show / Loom Video Update</h2>
    <p>No live meeting took place. Review the recording and supporting documents; no transcript is required for this path. All other Follow-Through and QA reviews still apply.</p>
    {usableLoomUrl(loom.url || "") ? <a href={loom.url} target="_blank" rel="noreferrer">Watch Loom recording</a> : <p>Loom recording is missing.</p>}
    <p>Email status: {loom.sendStatus || "not sent"}{loom.conversationId ? ` · Intercom ${loom.conversationId}` : ""}</p>
    <details><summary>Client email</summary><h3>{loom.email?.subject}</h3><p>To: {loom.email?.recipient}</p><pre className="whitespace-pre-wrap">{loom.email?.html}</pre></details>
    <details><summary>Presentation and reviewed speaking script</summary><pre className="whitespace-pre-wrap">{loom.script}</pre><pre className="whitespace-pre-wrap">{JSON.stringify(loom.presentation, null, 2)}</pre></details>
    <details><summary>Finalized preparation and account evidence</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ prepBrief: touch.prepBrief, prepPack: touch.prepPack, review: touch.review }, null, 2)}</pre></details>
    <details><summary>Follow-Through notes, tickets and action items</summary><pre className="whitespace-pre-wrap">{JSON.stringify(touch.followThrough, null, 2)}</pre></details>
  </section>;
}
