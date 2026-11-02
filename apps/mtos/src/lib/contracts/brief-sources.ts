/**
 * Where a fact in the preparation brief came from.
 *
 * Every line an account manager reads on the review screen carries a chip: the logo of the system
 * the fact came out of, its label, and a link straight to it. The reason is not decoration. The
 * writing standard makes "how we know" part of every item, and an AM who has to go and find the
 * ticket, the conversation or the scan before they trust a number will read the brief once and
 * then stop reading it.
 *
 * Two rules here are the ones that get broken in practice:
 *
 *  - A transcript chip must name the call it belongs to. Linking this month's fact to last
 *    month's transcript is worse than no link: it looks checked and is wrong. So a transcript
 *    chip cannot be built without both the document and the date of that call.
 *  - Rank Tracker and heatmap chips go to the Map Ranking dashboard addresses below, not to a
 *    guessed per-client URL. The dashboard has no stable per-client scan address, and a dead link
 *    teaches the AM to ignore the chips.
 */

export type SourceKind =
  | "clickup"
  | "intercom"
  | "gmail"
  | "gbp"
  | "google-ads"
  | "analytics"
  | "search-console"
  | "map-checkins"
  | "stripe"
  | "quickbooks"
  | "calendar"
  | "drive"
  | "meet"
  | "meta"
  | "lsa"
  | "rank-tracker"
  | "ghl"
  | "mtos";

/**
 * Served from `public/`, referenced with `<img>` so an SVG can never run anything.
 *
 * GoHighLevel has no logo in the bundle, and the prototype pulled one from a third-party favicon
 * service -- which would send a request, and the client's identity with it, off to someone else on
 * every brief that cites a call. It carries no icon instead, and the chip draws a monogram.
 */
export const SOURCE_ICON: Record<SourceKind, string | undefined> = {
  clickup: "/logos/clickup.svg",
  intercom: "/logos/intercom.svg",
  gmail: "/logos/gmail.svg",
  gbp: "/logos/gbp.svg",
  "google-ads": "/logos/google-ads.svg",
  analytics: "/logos/ga.svg",
  "search-console": "/logos/gsc.svg",
  "map-checkins": "/logos/map-checkins.png",
  stripe: "/logos/stripe.svg",
  quickbooks: "/logos/quickbooks.svg",
  calendar: "/logos/calendar.svg",
  drive: "/logos/drive.svg",
  meet: "/logos/meet.svg",
  meta: "/logos/meta.svg",
  lsa: "/logos/lsa.png",
  "rank-tracker": "/brand/mapranking-mark.png",
  ghl: undefined,
  mtos: "/brand/mapranking-mark.png",
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  clickup: "ClickUp",
  intercom: "Intercom",
  gmail: "support@ Gmail",
  gbp: "Google Business Profile",
  "google-ads": "Google Ads",
  analytics: "Google Analytics",
  "search-console": "Search Console",
  "map-checkins": "Map Check-Ins",
  stripe: "Stripe",
  quickbooks: "QuickBooks",
  calendar: "Google Calendar",
  drive: "Google Drive",
  meet: "Google Meet",
  meta: "Meta Ads",
  lsa: "Local Services Ads",
  "rank-tracker": "Rank Tracker",
  ghl: "GoHighLevel",
  mtos: "MTOS",
};

/** Rank Tracker and every client heatmap scan. */
export const RANK_TRACKER_HEATMAP_URL = "https://dashboard.mapranking.com/LocalSEOHeatmap";
/** Finding a client in the Map Ranking dashboard. */
export const RANK_TRACKER_FIND_CLIENT_URL = "https://dashboard.mapranking.com/ManageLocalBusiness";

export interface SourceChip {
  kind: SourceKind;
  /** What the chip says, e.g. `Ticket · Mobile form` or `Jun 5 call · 18:20`. */
  label: string;
  /** Absent when the system has no addressable page for this fact; the chip still names it. */
  url?: string;
}

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && value in SOURCE_ICON;
}

/** A chip for a ClickUp task, by its id. */
export function clickupTaskChip(taskId: string, label: string): SourceChip | undefined {
  const id = taskId.trim();
  if (!id) return undefined;
  return { kind: "clickup", label, url: `https://app.clickup.com/t/${encodeURIComponent(id)}` };
}

/** A chip for one Intercom conversation. */
export function intercomConversationChip(conversationId: string, label: string): SourceChip | undefined {
  const id = conversationId.trim();
  if (!id) return undefined;
  return {
    kind: "intercom",
    label,
    url: `https://app.intercom.com/a/inbox/_/inbox/conversation/${encodeURIComponent(id)}`,
  };
}

/**
 * `mm:ss` or `h:mm:ss` as a Google Docs transcript anchor (`#t=18m20s`).
 *
 * Returns undefined for anything that is not a timestamp, so a stray word in a model's output
 * cannot produce a link that scrolls to nowhere.
 */
export function transcriptAnchor(timestamp: string): string | undefined {
  const parts = timestamp.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (parts.some((part) => !/^\d{1,2}$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  const [hours, minutes, seconds] =
    numbers.length === 3 ? numbers : [0, numbers[0], numbers[1]];
  if (minutes > 59 || seconds > 59) return undefined;
  const totalMinutes = hours * 60 + minutes;
  return `#t=${totalMinutes}m${seconds}s`;
}

/**
 * A chip pointing at one moment in one call's transcript.
 *
 * Both the document and that call's date are required: the label has to name the call, because the
 * whole risk this chip guards against is a fact from this month pointing at last month's notes.
 */
export function transcriptChip(options: {
  docId: string;
  callDateIso: string;
  /** `18:20` within the call. Optional: a chip for the call as a whole is still useful. */
  timestamp?: string;
  timeZone?: string;
}): SourceChip | undefined {
  const docId = options.docId.trim();
  if (!docId) return undefined;
  const date = new Date(options.callDateIso);
  if (Number.isNaN(date.getTime())) return undefined;
  const day = new Intl.DateTimeFormat("en-US", {
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    month: "short",
    day: "numeric",
  }).format(date);
  const anchor = options.timestamp ? transcriptAnchor(options.timestamp) : undefined;
  const stamp = anchor ? ` · ${options.timestamp}` : "";
  return {
    kind: "drive",
    label: `${day} call${stamp}`,
    url: `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit?tab=transcript${anchor || ""}`,
  };
}

/** The Rank Tracker chips, which are fixed addresses rather than per-client pages. */
export function rankTrackerChip(label = "Rank Tracker"): SourceChip {
  return { kind: "rank-tracker", label, url: RANK_TRACKER_HEATMAP_URL };
}

export function findClientChip(): SourceChip {
  return { kind: "rank-tracker", label: "Find client · Rank Tracker", url: RANK_TRACKER_FIND_CLIENT_URL };
}

/** A chip naming a source with no page to open -- still better than an unsourced number. */
export function unlinkedChip(kind: SourceKind, label?: string): SourceChip {
  return { kind, label: label || SOURCE_LABEL[kind] };
}

/**
 * Chips as they arrive from the model or from a stored brief: anything unrecognisable is dropped
 * rather than rendered as a broken chip.
 */
export function normalizeChips(value: unknown): SourceChip[] {
  if (!Array.isArray(value)) return [];
  const chips: SourceChip[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { kind?: unknown; label?: unknown; url?: unknown };
    if (!isSourceKind(row.kind)) continue;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    const url = typeof row.url === "string" && /^https?:\/\//i.test(row.url.trim()) ? row.url.trim() : undefined;
    chips.push({ kind: row.kind, label, ...(url ? { url } : {}) });
  }
  return chips;
}
