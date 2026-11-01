import assert from "node:assert/strict";
import { parseMeetPush } from "../src/lib/server/services/google-meet-event-parser";
const expected = "projects/test/subscriptions/push";
const source = "//workspaceevents.googleapis.com/subscriptions/authorized";
function fixture(type: string, data: unknown) {
  return { subscription: expected, message: { messageId: "message-1", attributes: { "ce-source": source, "ce-specversion": "1.0", "ce-id": "unique-event", "ce-type": type }, data: Buffer.from(JSON.stringify(data)).toString("base64") } };
}
for (const [kind, plural] of [["transcript", "transcripts"], ["recording", "recordings"], ["smartNote", "smartNotes"]]) {
  const parsed = parseMeetPush(fixture(`google.workspace.meet.${kind}.v2.fileGenerated`, { [kind]: { name: `conferenceRecords/exact-call/${plural}/file-id` } }), expected);
  assert.ok(!parsed.ignored);
  assert.equal(parsed.conference, "conferenceRecords/exact-call");
}
assert.throws(() => parseMeetPush(fixture("google.workspace.meet.conference.v2.ended", { conferenceRecord: { name: "spaces/reused-room" } }), expected));
assert.throws(() => parseMeetPush(fixture("google.workspace.meet.conference.v2.ended", { conferenceRecord: { name: "conferenceRecords/correct" } }), "projects/other/subscriptions/push"));
const badSource = fixture("google.workspace.meet.conference.v2.ended", { conferenceRecord: { name: "conferenceRecords/correct" } });
badSource.message.attributes["ce-source"] = "https://attacker.example/subscriptions/authorized";
assert.throws(() => parseMeetPush(badSource, expected));
console.log("Google event parser security checks passed (synthetic fixtures only).");
