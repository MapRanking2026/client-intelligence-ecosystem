/**
 * How complete a Google Business Profile listing is, judged from the location record itself.
 *
 * This lives in its own module, apart from the sync that calls it, for one reason: what it
 * decides is read out to clients. The monthly touch turns `missing` into "still missing: Primary
 * phone number, Primary category, Business hours..." and hands the account manager that list to
 * take into the call. A wrong answer here is not a wrong number on a dashboard, it is an AM
 * asking a client for details the client filled in months ago. A pure module can be pinned by
 * `npm run check:prep-workflow` without Firestore or a Google credential, and it is.
 */

type JsonRecord = Record<string, unknown>;

/**
 * The detail fields the check reads, named here so a record that carries none of them can be
 * recognised as unloaded rather than empty.
 */
export const GBP_DETAIL_FIELDS = [
  "phoneNumbers",
  "categories",
  "storefrontAddress",
  "regularHours",
  "serviceArea",
  "profile",
  "openInfo",
  "serviceItems",
] as const;

export interface GbpCompleteness {
  percent: number;
  missing: string[];
  primaryCategory: string;
  additionalCategoryCount: number;
  serviceItemCount: number;
  openState: string;
}

/**
 * Returns null when the record carries none of the detail fields, rather than scoring it.
 *
 * Such a record is a slim projection, or a list response fetched with a narrow read mask -- not
 * an empty listing. Scoring one anyway is how a fully filled-in profile came to be reported as
 * "13% complete -- still missing: Primary phone number, Primary category, Additional categories,
 * Business hours, Business description, Address or service area, Services list", every one of
 * which was set on the listing and visible in Google's own UI. A gap the AM cannot see on the
 * listing in front of them is worse than no figure at all, so say nothing instead.
 */
export function buildGbpCompleteness(location: JsonRecord): GbpCompleteness | null {
  const detailLoaded = GBP_DETAIL_FIELDS.some((field) => location[field] !== undefined);
  if (!detailLoaded) {
    return null;
  }

  const categories = (location.categories || {}) as JsonRecord;
  const phoneNumbers = (location.phoneNumbers || {}) as JsonRecord;
  const regularHours = (location.regularHours || {}) as JsonRecord;
  const profile = (location.profile || {}) as JsonRecord;
  const openInfo = (location.openInfo || {}) as JsonRecord;
  const serviceArea = (location.serviceArea || {}) as JsonRecord;
  const primaryCategory = (categories.primaryCategory || {}) as JsonRecord;
  const additionalCategories = Array.isArray(categories.additionalCategories)
    ? (categories.additionalCategories as JsonRecord[])
    : [];
  const serviceItems = Array.isArray(location.serviceItems) ? (location.serviceItems as JsonRecord[]) : [];
  const primaryCategoryName = String(primaryCategory.displayName || primaryCategory.name || "").trim();

  const checks: Array<{ label: string; filled: boolean }> = [
    { label: "Website link", filled: Boolean(String(location.websiteUri || "").trim()) },
    { label: "Primary phone number", filled: Boolean(String(phoneNumbers.primaryPhone || "").trim()) },
    { label: "Primary category", filled: Boolean(primaryCategoryName) },
    { label: "Additional categories", filled: additionalCategories.length > 0 },
    { label: "Business hours", filled: Array.isArray(regularHours.periods) && regularHours.periods.length > 0 },
    { label: "Business description", filled: Boolean(String(profile.description || "").trim()) },
    {
      label: "Address or service area",
      filled: Boolean(location.storefrontAddress) || Boolean(serviceArea.businessType || serviceArea.places),
    },
    { label: "Services list", filled: serviceItems.length > 0 },
  ];

  const filled = checks.filter((check) => check.filled).length;

  return {
    percent: Math.round((filled / checks.length) * 100),
    missing: checks.filter((check) => !check.filled).map((check) => check.label),
    primaryCategory: primaryCategoryName,
    additionalCategoryCount: additionalCategories.length,
    serviceItemCount: serviceItems.length,
    openState: String(openInfo.status || ""),
  };
}
