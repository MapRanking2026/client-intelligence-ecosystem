/**
 * Dry run: reports last-post / next-scheduled for real check-in businesses. Writes nothing.
 * Cross-checks the bounded read the sync performs against a full read of every page, so the
 * page-limit optimisation cannot silently report a stale date.
 */
import { readFileSync } from "node:fs";

import { parseCheckinPostDate } from "@/src/lib/server/services/mapranking-dashboard";

type JsonRecord = Record<string, unknown>;

interface PostRow {
  date?: string;
  status?: string;
  platform?: string;
}

interface BusinessRow {
  _id?: string;
  business_name?: string;
  totalPosts?: number;
}

interface PostsResponse {
  data?: PostRow[];
  pagination?: { totalPages?: number };
}

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  const base = (env.MAPRANKING_API_BASE_URL || "https://dashboardapi.mapranking.com").replace(/\/$/, "");

  async function post<T>(path: string, body: JsonRecord, token?: string): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({}))) as T;
  }

  const login = await post<{ data?: { token?: string } }>("/api/auth/login", {
    type: "email",
    email: env.MAPRANKING_LOGIN_EMAIL,
    password: env.MAPRANKING_LOGIN_PASSWORD,
  });
  const token = login.data?.token;
  if (!token) {
    console.error("login failed");
    process.exit(1);
  }

  const businesses: BusinessRow[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await post<{ data?: BusinessRow[] }>(
      "/api/checkin-business/get-business-paginated",
      { page, limit: 20 },
      token,
    );
    const rows = response.data || [];
    businesses.push(...rows);
    if (rows.length < 20) break;
  }
  const withPosts = businesses.filter((business) => (business.totalPosts || 0) > 0);
  console.log(`businesses: ${businesses.length}, with posts: ${withPosts.length}`);

  const nowMs = Date.now();
  const isDone = (row: PostRow) => {
    const at = parseCheckinPostDate(row.date);
    return row.status === "published" && at !== null && at <= nowMs;
  };
  const isQueued = (row: PostRow) => {
    const at = parseCheckinPostDate(row.date);
    return at !== null && at > nowMs && (row.status === "scheduled" || row.status === "published");
  };

  async function readPosts(checkinId: string, maxPages: number) {
    const rows: PostRow[] = [];
    let pagesRead = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await post<PostsResponse>(
        "/api/checkin-business/get-posts",
        { checkin_id: checkinId, page, limit: 20 },
        token,
      );
      const pageRows = response.data || [];
      rows.push(...pageRows);
      pagesRead += 1;
      const totalPages = response.pagination?.totalPages ?? 1;
      // The bounded read stops as soon as a completed post is known.
      if ((maxPages <= 3 && rows.some(isDone)) || page >= totalPages || pageRows.length < 20) break;
    }
    const done = rows.filter(isDone).map((row) => row.date as string);
    const queued = rows.filter(isQueued).map((row) => row.date as string);
    return {
      pagesRead,
      lastPostAt: done.sort().slice(-1)[0] ?? null,
      nextScheduledPostAt: queued.sort()[0] ?? null,
    };
  }

  let mismatches = 0;
  const sample = withPosts.slice(0, 20);
  console.log(`\n${"BUSINESS".padEnd(36)} ${"LAST POST".padEnd(12)} ${"AGE".padEnd(8)} NEXT SCHEDULED`);
  console.log("-".repeat(84));

  for (const business of sample) {
    const id = String(business._id || "");
    if (!id) continue;
    const bounded = await readPosts(id, 3);
    const full = await readPosts(id, 20);

    const lastMs = parseCheckinPostDate(bounded.lastPostAt);
    const age = lastMs === null ? "-" : `${Math.floor((nowMs - lastMs) / 86400000)}d`;
    console.log(
      `${String(business.business_name).slice(0, 35).padEnd(36)} ${String(bounded.lastPostAt ?? "never").slice(0, 10).padEnd(12)} ${age.padEnd(8)} ${String(bounded.nextScheduledPostAt ?? "-").slice(0, 10)}`,
    );

    if (bounded.lastPostAt !== full.lastPostAt) {
      mismatches += 1;
      console.log(
        `   !! bounded(${bounded.pagesRead}p)=${bounded.lastPostAt} vs full(${full.pagesRead}p)=${full.lastPostAt}`,
      );
    }
  }

  console.log(`\nbounded-vs-full mismatches: ${mismatches} of ${sample.length}`);
  if (mismatches) process.exit(1);
}

void main();
