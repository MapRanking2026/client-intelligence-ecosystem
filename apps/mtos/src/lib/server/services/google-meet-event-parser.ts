import { z } from "zod";

export const meetEventTypes = [
  "google.workspace.meet.conference.v2.ended",
  "google.workspace.meet.transcript.v2.fileGenerated",
  "google.workspace.meet.recording.v2.fileGenerated",
  "google.workspace.meet.smartNote.v2.fileGenerated",
];
const envelope = z.object({
  subscription: z.string().min(1),
  message: z.object({ messageId: z.string().min(1), data: z.string().max(100000), attributes: z.record(z.string(), z.string()) }),
});

export function parseMeetPush(value: unknown, expectedSubscription: string) {
  const input = envelope.parse(value);
  if (input.subscription !== expectedSubscription) throw new Error("Unexpected Pub/Sub subscription.");
  const attributes = input.message.attributes;
  const source = attributes["ce-source"];
  if (!/^\/\/workspaceevents\.googleapis\.com\/subscriptions\/[a-zA-Z0-9_-]+$/.test(source || "")) throw new Error("Invalid Workspace subscription source.");
  const type = attributes["ce-type"];
  if (!type || !attributes["ce-id"] || attributes["ce-specversion"] !== "1.0") throw new Error("Invalid CloudEvent attributes.");
  const lifecycle = /^google\.workspace\.subscription\./.test(type);
  if (!meetEventTypes.includes(type) && !lifecycle) return { ignored: true as const, source, type, id: attributes["ce-id"] };
  const data = JSON.parse(Buffer.from(input.message.data, "base64").toString("utf8"));
  const resource = type.includes(".transcript.") ? data.transcript : type.includes(".recording.") ? data.recording : type.includes(".smartNote.") ? data.smartNote : data.conferenceRecord;
  const conference = typeof resource?.name === "string" ? resource.name.match(/^conferenceRecords\/[a-zA-Z0-9_-]+(?=\/|$)/)?.[0] : undefined;
  if (!lifecycle && !conference) throw new Error("Event does not identify an exact conference.");
  return { ignored: false as const, source, type, id: attributes["ce-id"], conference, lifecycle, time: attributes["ce-time"] || "" };
}
