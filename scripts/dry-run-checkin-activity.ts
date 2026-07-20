/**
 * Dry run: reports last-post / next-scheduled for real check-in businesses. Writes nothing.
 * Cross-checks the bounded read against a full read of every page, so the page-limit optimisation
 * cannot silently report a stale date.
 */
import { readFileSync } from "node:fs";

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const BASE = (env.MAPRANKING_API_BASE_URL || "https://dashboardapi.mapranking.com").replace(/\/$/, "");

  async function post(path: string, body: unknown, token?: string) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as Record<string, any>;
  }

  const login = await post("/api/auth/login", {
    type: "email",
    email: env.MAPRANKING_LOGIN_EMAIL,
    password: env.MAPRANKING_LOGIN_PASSWORD,
  });
  const token = login?.data?.token as string;

  const businesses: Record<string, any>[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const r = await post("/api/checkin-business/get-business-paginated", { page, limit: 20 }, token);
    const rows = (r.data || []) as Record<string, any>[];
    businesses.push(...rows);
    if (rows.length < 20) break;
  }
  const withPosts = businesses.filter((b) => (b.totalPosts || 0) > 0);
  console.log(`businesses: ${businesses.length}, with posts: ${withPosts.length}`);

  const nowMs = Date.now();
  const toMs = (v?: string | null) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  };

  // Read every page for a business (ground truth).
  async function fullScan(id: string) {
    const all: Record<string, any>[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const r = await post("/api/checkin-business/get-posts", { checkin_id: id, page, limit: 20 }, token);
      const rows = (r.data || []) as Record<string, any>[];
      all.push(...rows);
      const total = r.pagination?.totalPages ?? 1;
      if (page >= total || rows.length < 20) break;
    }
    const done = all.filter((p) => p.status === "published" && (toMs(p.date) ?? 0) <= nowMs);
    const queued = all.filter((p) => (toMs(p.date) ?? 0) > nowMs && ["scheduled", "published"].includes(p.status));
    return {
      pages: Math.ceil(all.length / 20),
      lastPostAt: done.map((p) => p.date).sort().slice(-1)[0] ?? null,
      nextScheduledPostAt: queued.map((p) => p.date).sort()[0] ?? null,
    };
  }

  // The bounded read the sync actually performs.
  async function boundedScan(id: string, maxPages = 3) {
    let lastPostAt: string | null = null;
    let nextScheduledPostAt: string | null = null;
    let pagesRead = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const r = await post("/api/checkin-business/get-posts", { checkin_id: id, page, limit: 20 }, token);
      const rows = (r.data || []) as Record<string, any>[];
      pagesRead += 1;
      for (const row of rows) {
        const at = toMs(row.date);
        if (at === null) continue;
        if (row.status === "published" && at <= nowMs) {
          if (at > (toMs(lastPostAt) ?? 0)) lastPostAt = row.date;
        } else if (at > nowMs && ["scheduled", "published"].includes(row.status)) {
          const cur = toMs(nextScheduledPostAt);
          if (cur === null || at < cur) nextScheduledPostAt = row.date;
        }
      }
      const total = r.pagination?.totalPages ?? 1;
      if (lastPostAt || page >= total || rows.length < 20) break;
    }
    return { lastPostAt, nextScheduledPostAt, pagesRead };
  }

  let mismatches = 0;
  const sample = withPosts.slice(0, 20);
  console.log(`\n${"BUSINESS".padEnd(34)} ${"LAST POST".padEnd(12)} ${"AGE".padEnd(10)} NEXT SCHEDULED`);
  console.log("-".repeat(88));
  for (const b of sample) {
    const bounded = await boundedScan(b._id);
    const full = await fullScan(b._id);
    const age = bounded.lastPostAt
      ? `${Math.floor((nowMs - new Date(bounded.lastPostAt).getTime()) / 86400000)}d`
      : "-";
    console.log(
      `${String(b.business_name).slice(0, 33).padEnd(34)} ${String(bounded.lastPostAt ?? "never").slice(0, 10).padEnd(12)} ${age.padEnd(10)} ${String(bounded.nextScheduledPostAt ?? "-").slice(0, 10)}`,
    );
    if (bounded.lastPostAt !== full.lastPostAt) {
      mismatches += 1;
      console.log(
        `   !! bounded(${bounded.pagesRead}p)=${bounded.lastPostAt} vs full(${full.pages}p)=${full.lastPostAt}`,
      );
    }
  }
  console.log(`\nbounded-vs-full mismatches: ${mismatches} of ${sample.length}`);
}

void main();
