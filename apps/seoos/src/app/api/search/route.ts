import { NextResponse } from "next/server";

import { NAV } from "@/src/lib/nav";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export interface SearchHit {
  kind: "client" | "page";
  label: string;
  sub?: string;
  href: string;
}

/**
 * App-wide search, available to every authenticated user. Results are scoped:
 * clients are limited to what the viewer may see (listProjectsForViewer), and
 * navigation destinations to the ones the viewer has permission for. No data is
 * fabricated — it only surfaces records that already exist for this viewer.
 */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ data: [] as SearchHit[] });

  const hits: SearchHit[] = [];

  // Navigation destinations the viewer can reach.
  for (const item of NAV) {
    if (item.permission && !authz.permissions.includes(item.permission)) continue;
    if (item.label.toLowerCase().includes(q)) {
      hits.push({ kind: "page", label: item.label, sub: "Go to page", href: item.href });
    }
  }

  // Clients within the viewer's visibility.
  const projects = await listProjectsForViewer(authz);
  for (const p of projects) {
    const haystack = [p.businessName, p.website, p.niche, ...(p.targetLocations ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (haystack.includes(q)) {
      hits.push({
        kind: "client",
        label: p.businessName,
        sub: [p.niche, p.stage].filter(Boolean).join(" · ") || undefined,
        href: `/clients/${p.id}`,
      });
    }
    if (hits.length >= 40) break;
  }

  // Clients first (the common case), then pages; cap the payload.
  hits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "client" ? -1 : 1));
  return NextResponse.json({ data: hits.slice(0, 20) });
}
