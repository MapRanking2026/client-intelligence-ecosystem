import type { PrepDocumentSection } from "@/src/lib/contracts/prep-workflow";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  PREP_DOCUMENT_SECTIONS,
  type PrepSectionSpec,
} from "@/src/lib/server/prompts/prep-document-prompt";

/**
 * Deciding which sections this touch gets, and assembling them into the document.
 *
 * Pure, and separate from the service that calls the model, so the document's shape can be
 * exercised directly: that every required section survives a model that skipped it, that a
 * conditional section keeps its heading and its reason, and that sections 15 and 16 always close
 * the document. Those are requirements of the preparation SOP, not presentation details.
 */

/** Which conditional sections apply this month, decided from the evidence rather than by the model. */
export interface SectionApplicability {
  retention: boolean;
  googleAds: boolean;
  metaAds: boolean;
  /** Why each conditional section was left out, in the AM's words. */
  reasons: Record<string, string>;
}

function activeChannels(touch: MonthlyTouchRecord) {
  const packs = touch.prepPack?.adsPerformance ?? [];
  const connected = (channel: string) => packs.some((pack) => pack.channel === channel && pack.connected);
  return {
    googleAds: connected("Google Ads") || connected("Google LSA"),
    metaAds: connected("Meta Ads"),
  };
}

/**
 * Retention applies when the client-retention warning signs are present in what we already hold:
 * a risk health label, recorded churn signals, a risk note, or cancel/pause/payment language in the
 * risks. Deliberately conservative -- a retention section written for a healthy account wastes the
 * AM's attention and reads as alarmism to a QC.
 */
export function retentionApplies(client: ClientRecord, touch: MonthlyTouchRecord): boolean {
  if (client.tone === "at_risk" || client.tone === "critical" || client.tone === "needs_attention") return true;
  if ((client.churnSignals || []).length > 0) return true;
  if ((client.riskNote || "").trim().length > 0) return true;
  const risks = [...(touch.risks || []), ...(client.topRisks || [])].join(" ").toLowerCase();
  return /cancel|churn|pause|downgrade|refund|unhappy|complaint|not paying|withheld/.test(risks);
}

export function resolveApplicability(client: ClientRecord, touch: MonthlyTouchRecord): SectionApplicability {
  const channels = activeChannels(touch);
  const retention = retentionApplies(client, touch);
  const reasons: Record<string, string> = {};
  if (!retention) {
    reasons.R =
      "No retention warning signs were found in this account's health, risk notes or open items, so there is no retention section this month.";
  }
  if (!channels.googleAds) {
    reasons["9"] = "Google Ads and Local Services Ads are not connected for this client, so there is no ads review.";
  }
  if (!channels.metaAds) {
    reasons["10"] = "Meta Ads is not connected for this client, so there is no paid social review.";
  }
  return { retention, googleAds: channels.googleAds, metaAds: channels.metaAds, reasons };
}

export function appliesToThisTouch(spec: PrepSectionSpec, applicability: SectionApplicability): boolean {
  if (spec.required) return true;
  if (spec.id === "R") return applicability.retention;
  if (spec.id === "9") return applicability.googleAds;
  if (spec.id === "10") return applicability.metaAds;
  return true;
}

/** What the model returned for one section. */
export interface ModelSection {
  id: string;
  markdown: string;
  skippedReason?: string;
}

/**
 * Build every section the document should contain, in the original prompt's order, whether or not
 * the model returned it.
 *
 * A required section the model skipped is marked failed and reported -- it is not allowed to
 * vanish, because a document missing section 14 is not a usable preparation, and a short document
 * that looks finished is worse than one that says what is wrong with it.
 */
export function buildSections(
  returned: ModelSection[],
  applicability: SectionApplicability,
): { sections: PrepDocumentSection[]; missingSections: string[] } {
  const collected = new Map(returned.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const sections: PrepDocumentSection[] = [];
  const missingSections: string[] = [];

  for (const spec of PREP_DOCUMENT_SECTIONS) {
    if (!appliesToThisTouch(spec, applicability)) {
      sections.push({
        id: spec.id,
        title: spec.title,
        markdown: "",
        included: false,
        skippedReason: applicability.reasons[spec.id] || "Not applicable this month.",
      });
      continue;
    }

    const entry = collected.get(spec.id);
    const body = (entry?.markdown || "").trim();

    if (!body) {
      if (spec.required) {
        missingSections.push(spec.id);
        sections.push({ id: spec.id, title: spec.title, markdown: "", included: true, failed: true });
      } else {
        sections.push({
          id: spec.id,
          title: spec.title,
          markdown: "",
          included: false,
          skippedReason: entry?.skippedReason || applicability.reasons[spec.id] || "Not applicable this month.",
        });
      }
      continue;
    }

    sections.push({ id: spec.id, title: spec.title, markdown: body, included: true });
  }

  return { sections, missingSections };
}

/** `# Monthly Touch Preparation — Acme Plumbing — Nov 5, 2026` */
export function documentTitle(clientName: string, touchDateIso: string): string {
  const date = new Date(touchDateIso);
  const when = Number.isNaN(date.getTime()) ? new Date(touchDateIso || 0) : date;
  const formatted = Number.isNaN(when.getTime())
    ? "date not set"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(when);
  return `# Monthly Touch Preparation — ${clientName} — ${formatted}`;
}

/**
 * Assemble the document.
 *
 * The missing-evidence banner goes at the top, before section 0, because it is the first thing the
 * AM has to act on. A skipped conditional section keeps its heading and carries the one-line
 * reason: an AM scanning for "Google Ads" needs to find out it is not connected, not find a gap
 * where section 9 should be.
 */
export function assembleMarkdown(
  clientName: string,
  touchDateIso: string,
  sections: PrepDocumentSection[],
  missing: string[],
): string {
  const parts: string[] = [documentTitle(clientName, touchDateIso), ""];

  if (missing.length) {
    parts.push("> **Missing evidence — check or ask about these:**");
    for (const item of missing) parts.push(`> - ${item}`);
    parts.push("");
  } else {
    parts.push(
      "> No material evidence gaps were found in what MTOS could read for this touch. That is not the same as every system being complete — the sources checked are listed in section 0.",
      "",
    );
  }

  for (const section of sections) {
    parts.push(`## ${section.id}. ${section.title}`);
    if (!section.included) {
      parts.push("", `_${section.skippedReason || "Not applicable this month."}_`, "");
      continue;
    }
    if (section.failed) {
      parts.push("", "_This section could not be written. The preparation is incomplete until it is regenerated._", "");
      continue;
    }
    parts.push("", section.markdown, "");
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
