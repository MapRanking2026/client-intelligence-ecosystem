import fs from "node:fs";

const envText = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!(k in env)) env[k] = v;
}

const login = await fetch("https://dashboardapi.mapranking.com/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "email", email: env.MAPRANKING_LOGIN_EMAIL, password: env.MAPRANKING_LOGIN_PASSWORD }),
});
const token = (await login.json()).data.token;
const H = { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" };
const base = "https://dashboardapi.mapranking.com/api";

// Find GoldenView San Antonio business id
const biz = await (await fetch(`${base}/business/get-business`, { headers: H })).json();
const sa = biz.data.find((b) => /goldenview/i.test(b.business_name) && /san antonio/i.test(b.formatted_address || ""));
const anyGolden = biz.data.filter((b) => /goldenview/i.test(b.business_name));
console.log("GoldenView businesses:", anyGolden.map((b) => ({ id: b._id, name: b.business_name, addr: b.formatted_address })));
const target = sa || anyGolden[0];
console.log("\nUsing:", target.business_name, target._id);

// keyword-history for this business
const kh = await (await fetch(`${base}/heatmap/keyword-history`, { method: "POST", headers: H, body: JSON.stringify({ business_id: target._id }) })).json();
const rows = kh.data || [];
console.log(`\nkeyword-history rows: ${rows.length}`);
// group by keyword
const byKw = {};
for (const r of rows) {
  (byKw[r.keyword] ||= []).push({ heatmap_id: r.heatmap_id, report_id: r.report_id, created_at: r.created_at, avg: r.score?.avg });
}
for (const [kw, list] of Object.entries(byKw).slice(0, 2)) {
  console.log(`\n=== keyword "${kw}": ${list.length} rows`);
  for (const r of list) console.log(`   created_at=${r.created_at} heatmap=${r.heatmap_id} report=${r.report_id} avg=${r.avg}`);

  // For the first heatmap_id, pull get-heatmap to see the real history array
  const hmId = list[0].heatmap_id;
  const gh = await (await fetch(`${base}/heatmap/get-heatmap`, { method: "POST", headers: H, body: JSON.stringify({ heatmapId: hmId }) })).json();
  const hist = gh.data?.history || [];
  console.log(`   --> get-heatmap(${hmId}) history: ${hist.length} scans`);
  for (const h of hist.slice(0, 6)) console.log(`        timestamp=${h.timestamp} report_id=${h.report_id} status=${h.status} avg=${h.score?.avg}`);
}

process.exit(0);
