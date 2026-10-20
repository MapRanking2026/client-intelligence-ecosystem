/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed JSON from the API under test */
/**
 * End-to-end acceptance flow for the AI Visibility Tracker (runs against a
 * NON-PRODUCTION SEOOS + Firestore emulator). Uses a clearly fictional test
 * client; with a live provider this spends real (capped) money.
 *
 * Env: E2E_BASE_URL, E2E_PROVIDER (anthropic|openai|gemini|fixture), E2E_MODEL,
 *      E2E_PROMPTS (default 10), E2E_REPS (default 3), E2E_SCAN_CAP (default 2),
 *      CRON_SECRET, FIRESTORE_EMULATOR_HOST, FIREBASE_PROJECT_ID, MTOS_PILOT_TENANT_ID.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROVIDER = process.env.E2E_PROVIDER || "anthropic";
const MODEL = process.env.E2E_MODEL || "";
const N_PROMPTS = Number(process.env.E2E_PROMPTS || 10);
const REPS = Number(process.env.E2E_REPS || 3);
const CAP = Number(process.env.E2E_SCAN_CAP || 2);
const TENANT = process.env.MTOS_PILOT_TENANT_ID || "map-ranking-e2e";
const RUN = Date.now().toString(36);
const ADMIN = { email: `admin.${RUN}@e2e.test`, password: `Adm1n-${RUN}-pw` };
const SPEC = { email: `spec.${RUN}@e2e.test`, password: `Sp3c-${RUN}-pw` };
const LIVE = PROVIDER !== "fixture";

const report: Record<string, unknown> = { provider: PROVIDER, run: RUN };

function db() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("E2E requires FIRESTORE_EMULATOR_HOST (never production)");
  if (!getApps().length) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "demo-aiv" });
  return getFirestore();
}

async function api(req: APIRequestContext, method: string, url: string, data?: unknown) {
  const res = await req.fetch(url, { method, data, headers: data ? { "content-type": "application/json" } : undefined });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 });
}

test.describe.serial("AI visibility acceptance", () => {
  let clientA = "";
  let clientB = "";
  let clientAId = "";
  let scanId = "";
  let approvedCount = 0;

  test("0. bootstrap users and clients (signup → admin, second → specialist)", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const a = await api(anon, "POST", "/api/auth/signup", { ...ADMIN, displayName: "E2E Admin" });
    expect(a.status, "run against an empty emulator tenant").toBe(200);
    expect(a.body.role).toBe("tenant_admin");
    const admin = await playwright.request.newContext({ baseURL });
    expect((await api(admin, "POST", "/api/auth/login", ADMIN)).status).toBe(200);
    const s = await api(anon, "POST", "/api/auth/signup", { ...SPEC, displayName: "E2E Specialist" });
    expect(s.status).toBe(200);
    expect(s.body.role).toBe("seo_specialist");
    const ca = await api(admin, "POST", "/api/seo/projects", { clientId: `e2e_client_a_${RUN}`, businessName: `E2E Test Client Cleaning ${RUN}`, website: "https://e2e-test-client.example", niche: "House cleaning" });
    expect(ca.status).toBe(201);
    clientA = ca.body.data.id;
    clientAId = ca.body.data.clientId;
    const cb = await api(admin, "POST", "/api/seo/projects", { clientId: `e2e_client_b_${RUN}`, businessName: `E2E Isolation Client ${RUN}`, website: "https://e2e-iso.example" });
    expect(cb.status).toBe(201);
    clientB = cb.body.data.id;
    // Admin grants the specialist visibility to client A only (membership-style allow-list).
    const users = await db().collection("tenants").doc(TENANT).collection("seoUsers").where("email", "==", SPEC.email).get();
    await users.docs[0].ref.update({ clientVisibility: [clientAId] });
  });

  test("3. provider connection settings + test connection (real provider)", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/ai-visibility/settings");
    await expect(page.getByRole("heading", { name: "Perplexity" })).toBeVisible();
    const card = page.locator("section.panel", { has: page.getByRole("heading", { name: new RegExp(PROVIDER === "openai" ? "OpenAI" : PROVIDER === "gemini" ? "Gemini" : PROVIDER === "fixture" ? "Fixture" : "Anthropic") }) });
    await card.getByLabel("Enabled for scans").check();
    if (MODEL) await card.getByLabel("Model ID").fill(MODEL);
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Saved.")).toBeVisible();
    await card.getByRole("button", { name: "Test connection" }).click();
    const msg = card.locator(".aiv-msg").last();
    await expect(msg).toContainText(/Connected|Failed|Fixture/, { timeout: 45_000 });
    report.testConnection = await msg.innerText();
    expect(await msg.innerText()).toMatch(/Connected|Fixture provider ready/);
    // Unsupported providers are labelled, never silently substituted.
    await expect(page.locator("section.panel", { has: page.getByRole("heading", { name: "Perplexity" }) }).getByText("Unsupported").first()).toBeVisible();
  });

  test("1. create a client profile and approve services, locations and aliases", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/ai-visibility");
    await page.getByRole("link", { name: new RegExp(`E2E Test Client Cleaning ${RUN}`) }).click();
    await page.getByRole("button", { name: "Set up AI visibility for this client" }).click();
    await page.waitForURL(/\/setup$/);
    // Website extraction is suggestion-only; the example domain is not fetched here.
    await page.getByLabel("New Approved aliases").fill(`E2E Cleaning ${RUN}`);
    await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Approved aliases$/ }) }).getByRole("button", { name: "Add" }).click();
    await page.getByLabel("New Services").fill("Deep cleaning");
    await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Services$/ }) }).getByRole("button", { name: "Add" }).click();
    await page.getByLabel("New Services").fill("Move-out cleaning");
    await page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Services$/ }) }).getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Add location" }).click();
    await page.getByLabel("City").last().fill("La Vergne");
    await page.getByLabel("State/region").last().fill("TN");
    await page.getByLabel(new RegExp(PROVIDER === "openai" ? "OpenAI" : PROVIDER === "gemini" ? "Gemini" : PROVIDER === "fixture" ? "Fixture" : "Anthropic")).check();
    await page.getByLabel("Independent observations per prompt").fill(String(REPS));
    await page.getByLabel("Per-scan spending cap (USD)").fill(String(CAP));
    await page.getByLabel("Monthly spending cap for this client (USD)").fill(String(CAP * 3));
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Activate measurement" }).click();
    await expect(page.getByText("Profile activated.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Status: active" })).toBeVisible();
  });

  test("2. generate and edit unbranded prompts (versioned, no client name)", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto(`/ai-visibility/${clientA}/prompts`);
    await page.getByLabel("Service intent").check();
    await page.getByLabel("Comparison intent").check();
    await page.getByRole("button", { name: "Generate drafts" }).click();
    await expect(page.getByText(/Generated \d+ draft prompt/)).toBeVisible();
    await page.reload();
    const rows = page.locator("tbody tr");
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(Math.min(N_PROMPTS, 6));
    for (const t of await rows.allInnerTexts()) expect(t).not.toMatch(new RegExp(`E2E Test Client|E2E Cleaning|e2e-test-client`, "i"));
    // Edit the first prompt → version 2.
    await rows.first().getByRole("button", { name: "Edit" }).click();
    await rows.first().getByLabel("Prompt text").fill("Which local companies offer dependable deep cleaning in La Vergne, TN?");
    await rows.first().getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByText("Saved as version 2.")).toBeVisible();
    // A branded name inside an unbranded prompt is rejected server-side.
    await rows.nth(1).getByRole("button", { name: "Edit" }).click();
    await rows.nth(1).getByLabel("Prompt text").fill(`Is E2E Test Client Cleaning ${RUN} good for deep cleaning in La Vergne, TN?`);
    await rows.nth(1).getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByText(/Unbranded prompt names the client/)).toBeVisible();
    await page.reload();
    // Approve N prompts.
    for (let i = 0; i < Math.min(N_PROMPTS, n); i += 1) {
      const btn = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: "Approve" }) }).first().getByRole("button", { name: "Approve" });
      await btn.click();
      await expect(page.getByText("Prompt approved.")).toBeVisible();
      await page.reload();
    }
    approvedCount = Math.min(N_PROMPTS, n);
    await expect(page.getByRole("heading", { name: new RegExp(`Prompt library \\(${approvedCount} approved\\)`) })).toBeVisible();
    await expect(page.locator("td.num").filter({ hasText: /^v2/ }).first()).toBeVisible();
  });

  test("4–5. review matrix + estimate, run a scan within budget, persist evidence", async ({ page, playwright, baseURL }) => {
    await signIn(page, ADMIN);
    await page.goto(`/ai-visibility/${clientA}/scans`);
    await page.getByRole("button", { name: "Review plan and cost" }).click();
    await expect(page.getByText("Estimated cost")).toBeVisible();
    const planned = approvedCount * REPS;
    await expect(page.locator(".aiv-metric", { hasText: "Observations" }).locator(".aiv-metric-value")).toHaveText(String(planned));
    const estText = await page.locator(".aiv-metric", { hasText: "Estimated cost" }).innerText();
    report.estimate = estText;
    const start = page.getByRole("button", { name: /Start scan/ });
    await expect(start).toBeEnabled();
    await start.click();
    await page.waitForURL(/\/scans\/scan_/);
    scanId = page.url().split("/scans/")[1];
    report.scanId = scanId;
    // Wait for completion (background processing + chaining).
    const admin = await playwright.request.newContext({ baseURL, storageState: await page.context().storageState() });
    let scan: Record<string, unknown> = {};
    for (let i = 0; i < 240; i += 1) {
      const r = await api(admin, "GET", `/api/seo/ai-visibility/projects/${clientA}/scans/${scanId}`);
      scan = r.body.data.scan;
      if (!["queued", "running"].includes(String(scan.status))) break;
      await page.waitForTimeout(5000);
    }
    report.scan = { status: scan.status, counts: scan.counts, estimatedCostUsd: scan.estimatedCostUsd, actualCostUsd: scan.actualCostUsd };
    expect(["completed", "partial"]).toContain(scan.status);
    expect(Number(scan.actualCostUsd)).toBeLessThanOrEqual(CAP + 1e-9);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Status: (completed|partial)/ })).toBeVisible();
  });

  test("6. dashboard numbers equal stored observations; evidence drawer shows prompt/answer/citations", async ({ page, playwright, baseURL }) => {
    await signIn(page, ADMIN);
    const admin = await playwright.request.newContext({ baseURL, storageState: await page.context().storageState() });
    const r = await api(admin, "GET", `/api/seo/ai-visibility/projects/${clientA}/observations?scan=${scanId}`);
    const rows = r.body.data as Array<Record<string, any>>;
    const m = r.body.metrics;
    if (!LIVE) {
      expect(rows.length).toBe(0); // fixture rows never appear in live views
      return;
    }
    expect(rows.length).toBe(approvedCount * REPS);
    // Independent recomputation from the stored rows.
    const valid = rows.filter((o) => o.collectionStatus === "success" && o.analysis?.status === "analyzed" && !["refusal", "no_answer"].includes(o.analysis?.answerClass));
    const eff = (o: any) => {
      const base = o.analysis.entities.find((e: any) => e.entityKey === "client");
      const ov = (o.overrides ?? []).find((x: any) => x.entityKey === "client");
      return { ...base, ...(ov ?? {}) };
    };
    const mentioned = valid.filter((o) => eff(o)?.mentioned).length;
    const recommended = valid.filter((o) => eff(o)?.recommended).length;
    expect(m.sample.valid).toBe(valid.length);
    expect(m.mentionRate.num).toBe(mentioned);
    expect(m.recommendationRate.num).toBe(recommended);
    report.metrics = { total: m.sample.total, valid: m.sample.valid, mention: `${m.mentionRate.num}/${m.mentionRate.den}`, rec: `${m.recommendationRate.num}/${m.recommendationRate.den}`, owned: `${m.ownedCitationRate.num}/${m.ownedCitationRate.den}`, top3: `${m.top3.num}/${m.top3.den}`, share: m.shareOfMentions.slice(0, 8).map((s: any) => `${s.name}:${s.answers}`) };
    // Evidence persisted per observation.
    for (const o of rows.filter((x) => x.collectionStatus === "success")) {
      expect(o.submittedText.length).toBeGreaterThan(10);
      expect(o.model).toBeTruthy();
      expect(o.requestId).toBeTruthy();
      expect(o.usage.inputTokens).toBeGreaterThan(0);
      expect(o.costBasis).toBe("calculated_from_reported_usage");
      expect(typeof o.searchExecuted).toBe("boolean");
    }
    report.searchExecuted = rows.filter((o) => o.searchExecuted).length;
    report.withCitations = rows.filter((o) => o.citations.length).length;

    // UI shows the same numbers.
    await page.goto(`/ai-visibility/${clientA}?scan=${scanId}`);
    await expect(page.getByText(`${m.sample.valid}`, { exact: true }).first()).toBeVisible();
    await expect(page.locator(".aiv-metric", { hasText: "Mention rate" })).toContainText(`${m.mentionRate.num} of ${m.mentionRate.den} valid answers`);
    await expect(page.locator(".aiv-metric", { hasText: "Recommendation rate" })).toContainText(`${m.recommendationRate.num} of ${m.recommendationRate.den}`);
    // Drill-down + evidence drawer.
    await page.goto(`/ai-visibility/${clientA}/results?scan=${scanId}&flag=valid`);
    await expect(page.locator("tbody tr")).toHaveCount(valid.length);
    await page.locator("tbody tr").first().getByRole("link").first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Exact prompt")).toBeVisible();
    await expect(drawer.locator(".aiv-answer")).not.toBeEmpty();
    await expect(drawer.getByRole("heading", { name: /Citations \(\d+\)/ })).toBeVisible();
    await expect(drawer.getByText("Extraction findings")).toBeVisible();
    await page.screenshot({ path: "../.e2e-results/evidence-drawer.png", fullPage: false });
    await page.goto(`/ai-visibility/${clientA}?scan=${scanId}`);
    await page.screenshot({ path: "../.e2e-results/overview.png", fullPage: true });
    await page.goto(`/ai-visibility/${clientA}/competitors?scan=${scanId}`);
    await page.screenshot({ path: "../.e2e-results/competitors.png", fullPage: true });
    await page.goto(`/ai-visibility/${clientA}/citations?scan=${scanId}`);
    await page.screenshot({ path: "../.e2e-results/citations.png", fullPage: true });
  });

  test("7. results persist after refresh and a new sign-in", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, ADMIN);
    await page.goto(`/ai-visibility/${clientA}/scans`);
    await expect(page.getByRole("link", { name: /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/ }).first()).toBeVisible();
    await page.goto("/ai-visibility");
    await expect(page.getByRole("row", { name: new RegExp(`E2E Test Client Cleaning ${RUN}`) })).toContainText("active");
    await ctx.close();
  });

  test("11. CSV export matches dashboard filters", async ({ page, playwright, baseURL }) => {
    await signIn(page, ADMIN);
    const admin = await playwright.request.newContext({ baseURL, storageState: await page.context().storageState() });
    for (const flag of ["", "valid", "excluded", "not_mentioned"]) {
      const q = `?scan=${scanId}${flag ? `&flag=${flag}` : ""}`;
      const json = await api(admin, "GET", `/api/seo/ai-visibility/projects/${clientA}/observations${q}`);
      const csv = await (await admin.get(`/api/seo/ai-visibility/projects/${clientA}/export${q}`)).text();
      const lines = csv.replace(/^﻿/, "").split("\r\n").filter((l, i) => i === 0 || l.startsWith("job_") || l.startsWith("obs_"));
      expect(lines.length - 1, `flag=${flag}`).toBe(json.body.data.length);
    }
  });

  test("10. client isolation and unauthorized access are rejected server-side", async ({ page, playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    expect((await api(anon, "GET", `/api/seo/ai-visibility/projects/${clientA}/observations`)).status).toBe(401);
    expect((await anon.get(`/api/seo/ai-visibility/projects/${clientA}/export`)).status()).toBe(401);
    expect((await api(anon, "POST", "/api/seo/ai-visibility/worker")).status).toBe(401);
    expect((await anon.get("/api/cron/ai-visibility")).status()).toBe(401);
    expect((await anon.get("/api/cron/ai-visibility", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);

    await signIn(page, SPEC);
    const spec = await playwright.request.newContext({ baseURL, storageState: await page.context().storageState() });
    expect((await api(spec, "GET", `/api/seo/ai-visibility/projects/${clientA}/observations`)).status).toBe(200);
    expect((await api(spec, "GET", `/api/seo/ai-visibility/projects/${clientB}/observations`)).status).toBe(404);
    expect((await spec.get(`/api/seo/ai-visibility/projects/${clientB}/export`)).status()).toBe(404);
    expect((await api(spec, "POST", `/api/seo/ai-visibility/projects/${clientB}/profile`)).status).toBe(404);
    // Specialist cannot change provider settings (integrations.manage).
    expect((await api(spec, "PUT", "/api/seo/ai-visibility/providers", { providerId: "anthropic", patch: { enabled: false } })).status).toBe(403);
    await page.goto("/ai-visibility");
    await expect(page.getByText(`E2E Test Client Cleaning ${RUN}`)).toBeVisible();
    await expect(page.getByText(`E2E Isolation Client ${RUN}`)).toHaveCount(0);
    const res = await page.goto(`/ai-visibility/${clientB}`);
    expect(res?.status()).toBe(404);
  });

  test("12. scheduled scan executes through the cron scheduler", async ({ page, playwright, baseURL }) => {
    await signIn(page, ADMIN);
    const admin = await playwright.request.newContext({ baseURL, storageState: await page.context().storageState() });
    // Client B: one approved prompt, one repetition, weekly schedule.
    expect((await api(admin, "POST", `/api/seo/ai-visibility/projects/${clientB}/profile`)).status).toBe(201);
    const providerId = PROVIDER;
    const put = await api(admin, "PUT", `/api/seo/ai-visibility/projects/${clientB}/profile`, {
      services: [{ id: "svc_b1", value: "Deep cleaning", status: "approved", source: "user" }],
      locations: [{ id: "loc_b1", city: "Smyrna", region: "TN", country: "US", status: "approved", source: "user" }],
      providerIds: [providerId],
      repetitions: 1,
      perScanBudgetUsd: 0.5,
      monthlyBudgetUsd: 1,
      scanFrequency: "weekly",
    });
    expect(put.status).toBe(200);
    expect((await api(admin, "POST", `/api/seo/ai-visibility/projects/${clientB}/profile/status`, { status: "active" })).status).toBe(200);
    const created = await api(admin, "POST", `/api/seo/ai-visibility/projects/${clientB}/prompts`, { action: "create", text: "Who offers reliable deep cleaning in Smyrna, TN?", group: "unbranded_discovery", serviceId: "svc_b1", locationId: "loc_b1" });
    expect(created.status).toBe(201);
    expect((await api(admin, "PATCH", `/api/seo/ai-visibility/projects/${clientB}/prompts/${created.body.data.id}`, { status: "approved" })).status).toBe(200);
    const cron = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const run1 = await cron.get("/api/cron/ai-visibility", { timeout: 300_000 });
    expect(run1.status()).toBe(200);
    const body1 = await run1.json();
    const mine = body1.scheduled.find((s: any) => s.projectId === clientB);
    expect(mine.outcome).toBe("started");
    const run2 = await (await cron.get("/api/cron/ai-visibility", { timeout: 300_000 })).json();
    expect(run2.scheduled.find((s: any) => s.projectId === clientB).outcome).toBe("already_exists");
    let st = "";
    for (let i = 0; i < 60; i += 1) {
      const s = await api(admin, "GET", `/api/seo/ai-visibility/projects/${clientB}/scans/${mine.scanId}`);
      st = s.body.data.scan.status;
      if (!["queued", "running"].includes(st)) break;
      await page.waitForTimeout(5000);
    }
    report.scheduled = { scanId: mine.scanId, status: st };
    expect(["completed", "partial"]).toContain(st);
  });

  test.afterAll(async () => {
    console.log(`E2E_REPORT ${JSON.stringify(report)}`);
  });
});
