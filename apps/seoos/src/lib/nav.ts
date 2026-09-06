import type { PermissionScope } from "@cie/contracts";

export interface NavItem {
  href: string;
  label: string;
  glyph: string;
  /** Permission required to see/use this destination (read-level). */
  permission?: PermissionScope;
}

/** Primary SEOOS navigation — every entry is a real, protected destination. */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", glyph: "◆" },
  { href: "/clients", label: "Clients", glyph: "▣", permission: "seo.project.manage" },
  { href: "/requests", label: "Request Inbox", glyph: "✉", permission: "seo.package.read" },
  { href: "/keywords", label: "Keywords", glyph: "⌗", permission: "seo.package.read" },
  { href: "/rankings", label: "Rankings & Grids", glyph: "▚", permission: "seo.package.read" },
  { href: "/gbp", label: "GBP & Local Presence", glyph: "◉", permission: "seo.package.read" },
  { href: "/audits", label: "Website Audits", glyph: "⚙", permission: "seo.package.read" },
  { href: "/recommendations", label: "Recommendations", glyph: "✦", permission: "seo.package.read" },
  { href: "/work-orders", label: "Work Orders", glyph: "✓", permission: "seo.package.read" },
  { href: "/lead-verification", label: "Lead & Call Verification", glyph: "☎", permission: "lead_call.read" },
  { href: "/monthly-audits", label: "Monthly Audits", glyph: "▦", permission: "seo.package.read" },
  { href: "/reports", label: "Reports & Packages", glyph: "▧", permission: "seo.package.read" },
  { href: "/knowledge", label: "Knowledge / Niche Studies", glyph: "❖", permission: "seo.package.read" },
  { href: "/integrations", label: "Integrations & Data Health", glyph: "⇄", permission: "integrations.manage" },
  { href: "/team", label: "Team / Settings", glyph: "⚑", permission: "settings.manage" },
];
