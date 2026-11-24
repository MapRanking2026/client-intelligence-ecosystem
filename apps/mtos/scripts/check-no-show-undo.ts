/**
 * A no-show can be taken back while nothing has left the building.
 *
 * The client who rings ten minutes late is the ordinary case, and until this existed the only
 * way through it was to carry on in a touch that had already recorded a no-show: the panel let
 * you hide itself ("Return to Live Call") but the resolution stayed on the record, the select
 * action refused to change it, and the follow-through was written from a touch that said the
 * client had not attended.
 *
 * What undo may not do is pretend something the client has seen did not happen. A meeting moved
 * in their calendar and a Loom update Gmail has accepted are both outside MTOS by then; an
 * in-flight send is held too, so an undo cannot race a second email.
 *
 * Run with: npm run check:no-show-undo
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { noShowUndoBlocker } from "@/src/lib/contracts/no-show";
import type { NoShowState } from "@/src/lib/contracts/no-show";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

const base: NoShowState = { resolution: "loom", selectedAt: "2026-11-24T18:00:00.000Z", selectedBy: "am-1" };

// --- when it can be undone --------------------------------------------------
check("a resolution just picked can be undone", noShowUndoBlocker(base) === undefined);
check("so can one where the reschedule has not been confirmed", noShowUndoBlocker({ ...base, resolution: "reschedule" }) === undefined);
check(
  "a Loom draft written but never sent is no obstacle",
  noShowUndoBlocker({ ...base, script: "A script", url: "https://www.loom.com/share/abc", presentation: { status: "generated", slides: [] } }) === undefined,
);
check("nor is a send that failed outright", noShowUndoBlocker({ ...base, sendStatus: "failed", sendError: "Gmail refused it" }) === undefined);

// --- when it cannot ---------------------------------------------------------
const blocked = (state: NoShowState) => noShowUndoBlocker(state) || "";
check("a meeting already moved in Calendar is not undone here", blocked({ ...base, resolution: "reschedule", rescheduledAt: "2026-11-24T18:05:00.000Z" }).includes("Calendar"));
check("a Loom update the client has been emailed is not undone here", blocked({ ...base, sendStatus: "sent", sentAt: "2026-11-24T18:30:00.000Z" }).includes("already been emailed"));
check("a send still in flight is held", blocked({ ...base, sendStatus: "sending" }).includes("unresolved"));
check("so is one whose delivery is unknown", blocked({ ...base, sendStatus: "unknown" }).includes("unresolved"));
// Every refusal says what to do instead, because the AM is reading it during a call.
check("each refusal is a sentence, not a code", [
  blocked({ ...base, resolution: "reschedule", rescheduledAt: "x" }),
  blocked({ ...base, sendStatus: "sent" }),
  blocked({ ...base, sendStatus: "unknown" }),
].every((message) => message.length > 40 && message.trim().endsWith(".")));
check("a touch with no no-show says so rather than offering an undo", (noShowUndoBlocker(undefined) || "").includes("no recorded no-show"));

// --- the wiring that carries it out -----------------------------------------
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const service = read("src/lib/server/services/no-show-service.ts");
const route = read("src/app/api/monthly-touches/[touchId]/no-show/route.ts");
const panel = read("src/components/mtos/no-show-panel.tsx");

check("the API accepts the undo", /z\.object\(\{ action: z\.literal\("cancel"\) \}\)/.test(route));
check("the service checks the blocker before undoing anything", /action === "cancel"[\s\S]{0,200}noShowUndoBlocker/.test(service));
check("undoing removes the no-show rather than editing it", /action === "cancel"[\s\S]{0,600}noShow: FieldValue\.delete\(\)/.test(service));
// The attempt stays on the record: the panel was opened, and a touch that hides that is a touch
// whose history does not match what happened.
check("the attempt is kept in the history", /action === "cancel"[\s\S]{0,600}noShowHistory: FieldValue\.arrayUnion/.test(service));
check("the panel offers it only while it is possible", panel.includes("chosen && !undoBlocker"));
check("and says why when it is not", panel.includes("This no-show can no longer be undone here."));
// The old button hid the panel and left the no-show recorded, which read as cancelling it.
check("the button that merely hides the panel no longer reads as an undo", !panel.includes("Return to Live Call"));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore transaction itself, which needs a live database");
console.log("  - the Live Call guard, which already refuses every no-show action outside the live step");
console.log("  - putting a rescheduled meeting back, which is done in Google Calendar");
if (failed) process.exitCode = 1;
