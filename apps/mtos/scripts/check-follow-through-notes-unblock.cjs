/* eslint-disable @typescript-eslint/no-require-imports -- A browser check: synthetic notes, mocked API. */
/**
 * The notes step must be able to clear what step 6 refuses.
 *
 * `finishBlockers` will not let a follow-through be processed while a client action has no
 * decision, an action line has no what/team/date, or a pending item has no source or chase date.
 * The compact notes editor renders only the summary and the goal, so if it does not also expose
 * those three things, the AM reaches step 6, reads a list of problems, and has nowhere to fix
 * them -- the draft prompt leaves a due date blank on purpose whenever the call did not establish
 * one, so this is the normal case rather than an edge one.
 *
 * This drives the real component in a real browser against a mocked API, and asserts on the body
 * it actually posts: first that the synthetic draft really is blocked, then that the screen alone
 * is enough to unblock it.
 *
 * Run with: npm run check:follow-through-notes-unblock
 */
require("tsx/cjs");
const assert = require("node:assert/strict");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

const { notesBlockers } = require("../src/lib/contracts/follow-through-notes.ts");
const { finishBlockers } = require("../src/lib/contracts/follow-through-finish.ts");

/** One of each blocked row, and nothing else that could be the reason a check fails. */
const notes = {
  title: "Synthetic Monthly Touch",
  nps: 8,
  npsJustification: "Synthetic evidence",
  goalQuarter: "Q4 2026",
  goalText: "Review performance",
  goalStatus: "On track",
  goalEvidence: "Synthetic evidence",
  summary: "We reviewed performance.",
  bullets: { metrics: "Original detail" },
  departments: [
    {
      department: "SEO",
      clientFeedback: "",
      // No date: the prompt leaves it blank when the call did not establish one.
      actions: [{ id: "a1", what: "Review location visibility", team: "SEO", due: "" }],
    },
  ],
  clientActions: [{ id: "c1", what: "Send the new service list", due: "2026-11-30" }],
  pending: [{ id: "p1", waitingOn: "Client", missing: "The updated photos", from: "", team: "SEO", owner: "AM", reminderDate: "" }],
};

/** The notes half of what step 6 refuses, which is the half this screen is responsible for. */
function notesSideBlockers(draft) {
  const all = finishBlockers({ notes: draft });
  return all.filter((line) => notesBlockers(draft).includes(line) || /client action/i.test(line));
}

async function main() {
  assert.ok(notesBlockers(notes).length, "the synthetic draft should start blocked");
  assert.ok(notesSideBlockers(notes).length >= 2, "it should be blocked on the notes and on the client action");

  const entry = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { FollowThroughNotes } from "./src/components/mtos/follow-through-notes";
    createRoot(document.getElementById("root")).render(
      <FollowThroughNotes touchId="synthetic" notes={${JSON.stringify(notes)}} />
    );
  `;
  const bundle = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true,
    write: false,
    jsx: "automatic",
    plugins: [{
      name: "mock-router",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const useRouter = () => ({ refresh() {} });" }));
      },
    }],
  });

  const server = http.createServer((request, response) => {
    const js = request.url === "/bundle.js";
    response.setHeader("content-type", js ? "application/javascript" : "text/html");
    response.end(js ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const errors = [];
    const posted = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/monthly-touches/synthetic", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { notes } }) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);

    // The draft opens as something to read: what is outstanding is stated, but nothing is editable
    // until the AM asks for it.
    await page.getByText("Before the follow-through can be finished", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Action 1 due", exact: true }).count(), 0,
      "the notes should not open in an editable state");
    assert.equal(await page.getByRole("button", { name: "Save notes", exact: true }).count(), 0,
      "and there should be nothing to save while reading");
    await page.getByRole("button", { name: "Edit these notes", exact: true }).click();

    // Every blocked field is reachable once it is open.
    await page.getByRole("textbox", { name: "Action 1 due", exact: true }).fill("2026-12-01");
    await page.getByRole("textbox", { name: "Pending 1 from", exact: true }).fill("The client");
    await page.getByRole("textbox", { name: "Pending 1 reminder", exact: true }).fill("2026-11-25");
    await page.getByRole("group", { name: "Client action 1 decision", exact: true })
      .getByRole("button", { name: "Approve", exact: true }).click();

    await page.getByRole("button", { name: "Save notes", exact: true }).click();
    await page.getByText("Notes saved.", { exact: true }).waitFor();

    // A save is the end of an edit, so the screen goes back to reading.
    await page.getByRole("button", { name: "Edit these notes", exact: true }).waitFor();

    const saved = posted.find((body) => body.action === "save_notes");
    assert.ok(saved, "the screen should post the notes it edited");
    assert.deepEqual(notesBlockers(saved.notes), [], "the notes should no longer block step 6");
    assert.deepEqual(notesSideBlockers(saved.notes), [], "and neither should the client action");
    assert.equal(saved.notes.departments[0].actions[0].due, "2026-12-01");
    assert.equal(saved.notes.pending[0].from, "The client");
    assert.equal(saved.notes.pending[0].reminderDate, "2026-11-25");
    assert.equal(saved.notes.clientActions[0].decision, "approved");
    // The fields this editor does not render still have to survive the round trip.
    assert.equal(saved.notes.bullets.metrics, "Original detail");
    assert.equal(saved.notes.summary, "We reviewed performance.");
    assert.deepEqual(errors, []);

    console.log("PASS a blocked draft is unblocked from the notes step alone: action date, pending source and chase date, client-action decision; hidden fields preserved; no browser errors");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
