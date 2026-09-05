import { z } from "zod";
import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/** Per-item outcome. */
export const AuditResult = z.enum([
  "pending",
  "pass",
  "warning",
  "fail",
  "not_applicable",
  "data_unavailable",
]);
export type AuditResult = z.infer<typeof AuditResult>;

export const AuditCategory = z.enum([
  "connection",
  "schema",
  "reviews",
  "checkins",
  "deliverables",
  "risk",
  "nps",
]);
export type AuditCategory = z.infer<typeof AuditCategory>;

export const MonthlyAuditStatus = z.enum(["draft", "in_review", "qa", "published"]);
export type MonthlyAuditStatus = z.infer<typeof MonthlyAuditStatus>;

export const MONTHLY_AUDIT_TRANSITIONS: Record<
  MonthlyAuditStatus,
  ReadonlyArray<MonthlyAuditStatus>
> = {
  draft: ["in_review"],
  in_review: ["qa", "draft"],
  qa: ["published", "in_review"],
  published: [],
};

export const AuditItemV1 = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  category: AuditCategory,
  result: AuditResult.default("pending"),
  notes: z.string().max(2000).optional(),
  remediation: z.string().max(2000).optional(),
  sourceFreshness: z.enum(["live", "cached", "stale", "unknown"]).optional(),
  owner: zUserId.optional(),
  dueDate: zIsoTimestamp.optional(),
  workOrderId: z.string().optional(),
  /** True when carried forward unresolved from a prior period. */
  carriedForward: z.boolean().default(false),
});
export type AuditItemV1 = z.infer<typeof AuditItemV1>;

export const MonthlyAuditV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  projectId: z.string().min(1),
  clientId: zClientId,
  /** Reporting month as YYYY-MM. */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  status: MonthlyAuditStatus.default("draft"),
  items: z.array(AuditItemV1).default([]),
  reviewerUserId: zUserId.optional(),
  publishedAt: zIsoTimestamp.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type MonthlyAuditV1 = z.infer<typeof MonthlyAuditV1>;

/** The standard monthly SEO checklist (replaces the manual workbook). */
export const AUDIT_TEMPLATE: Array<Pick<AuditItemV1, "key" | "label" | "category">> = [
  { key: "conn_gbp", label: "Google Business Profile connected & returning data", category: "connection" },
  { key: "conn_search_console", label: "Search Console connected & usable", category: "connection" },
  { key: "conn_analytics", label: "Analytics (GA4) connected & usable", category: "connection" },
  { key: "conn_rank_tracker", label: "Rank Tracker / grids connected", category: "connection" },
  { key: "conn_map_checkins", label: "Map Check-Ins connected", category: "connection" },
  { key: "conn_ghl", label: "GoHighLevel connected", category: "connection" },
  { key: "conn_clickup", label: "ClickUp connected", category: "connection" },
  { key: "conn_facebook", label: "Facebook connected", category: "connection" },
  { key: "conn_instagram", label: "Instagram connected", category: "connection" },
  { key: "conn_youtube", label: "YouTube connected", category: "connection" },
  { key: "conn_website_widgets", label: "Website widgets present & firing", category: "connection" },
  { key: "schema_valid", label: "Schema markup present & valid", category: "schema" },
  { key: "auto_responses", label: "Automated responses configured", category: "reviews" },
  { key: "review_requests", label: "Review requests being sent", category: "reviews" },
  { key: "review_responses", label: "Reviews responded to (count checked)", category: "reviews" },
  { key: "checkins_count", label: "Map Check-In / checking counts logged", category: "checkins" },
  { key: "utilization_risk", label: "Utilization/risk indicators reviewed", category: "risk" },
  { key: "deliverables_done", label: "Deliverables completed for the period", category: "deliverables" },
  { key: "unresolved_issues", label: "Unresolved issues reviewed", category: "risk" },
  { key: "nps_context", label: "NPS context reviewed (where available)", category: "nps" },
];

/** Statuses that mean an item is unresolved and should carry forward. */
export const UNRESOLVED_RESULTS: AuditResult[] = ["pending", "warning", "fail"];
