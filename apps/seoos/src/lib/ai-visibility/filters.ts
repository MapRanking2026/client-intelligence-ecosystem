import type { AivObservationV1, AivProfileV1, MeasurementChannel, PromptGroup, ProviderId } from "./types";
import { applyFilter, type MetricFilter } from "./metrics";
import { clientFinding, effectiveEntities, validity } from "./effective";
import { hostMatchesDomain } from "./url";
import { toCsv } from "./util";

/**
 * One filter model shared by the dashboard, the results table and the CSV
 * export, so an export always contains exactly the rows behind the numbers.
 */
export interface ViewFilter extends MetricFilter {
  /** Drill-down to the observations behind a metric. */
  flag?: string;
}

const CHANNELS: MeasurementChannel[] = ["official_api", "consumer_search", "manual"];

export function parseViewFilter(sp: Record<string, string | string[] | undefined> | URLSearchParams): ViewFilter {
  const get = (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const channel = (get("channel") as MeasurementChannel) ?? "official_api";
  return {
    channel: CHANNELS.includes(channel) ? channel : "official_api",
    branded: get("branded") === "1",
    providerId: (get("provider") as ProviderId) || undefined,
    model: get("model") || undefined,
    serviceId: get("service") || undefined,
    locationId: get("location") || undefined,
    promptId: get("prompt") || undefined,
    promptGroup: (get("group") as PromptGroup) || undefined,
    scanId: get("scan") || undefined,
    from: get("from") || undefined,
    // A bare date "to" includes that whole day.
    to: (() => {
      const t = get("to");
      return t ? (/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T23:59:59.999Z` : t) : undefined;
    })(),
    flag: get("flag") || undefined,
  };
}

export function filterToQuery(f: Partial<ViewFilter>): string {
  const q = new URLSearchParams();
  if (f.channel && f.channel !== "official_api") q.set("channel", f.channel);
  if (f.branded) q.set("branded", "1");
  if (f.providerId) q.set("provider", f.providerId);
  if (f.model) q.set("model", f.model);
  if (f.serviceId) q.set("service", f.serviceId);
  if (f.locationId) q.set("location", f.locationId);
  if (f.promptId) q.set("prompt", f.promptId);
  if (f.promptGroup) q.set("group", f.promptGroup);
  if (f.scanId) q.set("scan", f.scanId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to.slice(0, 10));
  if (f.flag) q.set("flag", f.flag);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function matchesFlag(o: AivObservationV1, flag: string | undefined): boolean {
  if (!flag) return true;
  const v = validity(o);
  const c = clientFinding(o);
  if (flag === "valid") return v === "valid";
  if (flag === "excluded") return v !== "valid";
  if (["not_collected", "refusal", "no_answer", "not_analyzed"].includes(flag)) return v === flag;
  if (flag === "mentioned") return v === "valid" && Boolean(c?.mentioned);
  if (flag === "not_mentioned") return v === "valid" && !c?.mentioned;
  if (flag === "recommended") return v === "valid" && Boolean(c?.recommended);
  if (flag === "owned_cited") return v === "valid" && Boolean(c?.ownedDomainCited);
  if (flag === "ordered") return v === "valid" && Boolean(o.analysis?.orderedList);
  if (flag === "top3") return v === "valid" && Boolean(o.analysis?.orderedList) && Boolean(c?.mentioned) && c?.position != null && c.position <= 3;
  if (flag.startsWith("position:")) return v === "valid" && c?.mentioned === true && c.position === Number(flag.slice(9));
  if (flag.startsWith("entity:")) {
    const key = flag.slice(7);
    return v === "valid" && effectiveEntities(o).some((e) => e.entityKey === key && e.mentioned);
  }
  if (flag.startsWith("cites:")) {
    const d = flag.slice(6);
    return o.citations.some((x) => hostMatchesDomain(x.domain, d));
  }
  if (flag.startsWith("url:")) {
    const u = flag.slice(4);
    return o.citations.some((x) => x.normalizedUrl === u);
  }
  return true;
}

export function filterObservations(all: AivObservationV1[], f: ViewFilter): AivObservationV1[] {
  return applyFilter(all, f)
    .filter((o) => matchesFlag(o, f.flag))
    .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1));
}

export function observationsCsv(rows: AivObservationV1[], profile: AivProfileV1): string {
  const loc = (id?: string) => {
    const l = profile.locations.find((x) => x.id === id);
    return l ? `${l.city}${l.region ? `, ${l.region}` : ""}` : "";
  };
  const svc = (id?: string) => profile.services.find((s) => s.id === id)?.value ?? "";
  const header = [
    "observation_id", "collected_at", "channel", "surface", "provider", "model", "scan_id", "prompt_id", "prompt_version",
    "prompt_group", "branded", "submitted_text", "service", "location", "location_mode", "repetition", "collection_status",
    "validity", "search_executed", "client_mentioned", "client_recommended", "client_sentiment", "client_position",
    "ordered_list", "owned_domain_cited", "businesses_mentioned", "citation_count", "citation_domains", "cost_usd",
    "cost_basis", "latency_ms", "request_id", "manually_corrected", "answer_text",
  ];
  const data = rows.map((o) => {
    const c = clientFinding(o);
    const ents = effectiveEntities(o).filter((e) => e.mentioned && e.entityKey !== "client");
    return [
      o.id, o.collectedAt, o.channel, o.surface, o.providerId ?? "", o.model ?? "", o.scanId ?? "", o.promptId ?? "", o.promptVersion ?? "",
      o.promptGroup, o.branded, o.submittedText, svc(o.serviceId), loc(o.locationId), o.locationMode, o.repetition ?? "", o.collectionStatus,
      validity(o), o.searchExecuted === null ? "not reported" : o.searchExecuted, c?.mentioned ?? false, c?.recommended ?? false,
      c?.mentioned ? c.sentiment : "", c?.mentioned && c.position !== null ? c.position : o.analysis?.orderedList ? "" : "no ordered list",
      o.analysis?.orderedList ?? false, c?.ownedDomainCited ?? false, ents.map((e) => e.name).join("; "), o.citations.length,
      [...new Set(o.citations.map((x) => x.domain))].join("; "), o.costUsd.toFixed(6), o.costBasis, o.latencyMs ?? "", o.requestId ?? "",
      o.overrides.length > 0, o.answerText,
    ];
  });
  return toCsv(header, data);
}
