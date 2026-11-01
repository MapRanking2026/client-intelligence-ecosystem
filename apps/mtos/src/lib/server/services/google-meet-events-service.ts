import { createHash, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";
import { getGoogleMeetingAccessToken, processGoogleConferenceEvent } from "./google-meet-service";
import { meetEventTypes, parseMeetPush } from "./google-meet-event-parser";

const API = "https://workspaceevents.googleapis.com/v1";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function db() { const value = getFirebaseAdminDb(); if (!value) throw new Error("Database unavailable."); return value; }
function settings(context: TenantContext) { return db().doc(`tenants/${context.tenantId}/meetEventConnections/${context.userId}`); }
function config() {
  const topic = process.env.GOOGLE_MEET_EVENTS_TOPIC;
  const audience = process.env.GOOGLE_MEET_EVENTS_AUDIENCE;
  const email = process.env.GOOGLE_MEET_EVENTS_PUSH_EMAIL;
  const subscription = process.env.GOOGLE_MEET_EVENTS_PUSH_SUBSCRIPTION;
  if (!topic || !audience || !email || !subscription) throw new Error("Google event delivery has not been configured on this deployment.");
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic) || !/^projects\/[^/]+\/subscriptions\/[^/]+$/.test(subscription) || !audience.startsWith("https://")) throw new Error("Invalid Google event configuration.");
  return { topic, audience, email, subscription };
}
async function call<T>(token: string, url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Google events request failed (${response.status}).`);
  return result as T;
}
type Subscription = { name: string; targetResource: string; expireTime: string; state: string; notificationEndpoint?: { pubsubTopic?: string } };
type Operation = { name: string; done?: boolean; response?: Subscription; error?: { message?: string } };
async function completed(token: string, operation: Operation) {
  for (let attempt = 0; !operation.done && attempt < 5; attempt++) {
    if (!/^operations\/[a-zA-Z0-9_-]+$/.test(operation.name)) throw new Error("Invalid operation name.");
    await new Promise((resolve) => setTimeout(resolve, 500));
    operation = await call<Operation>(token, `${API}/${operation.name}`);
  }
  if (operation.error) throw new Error(operation.error.message || "Subscription update failed.");
  if (!operation.response?.name || !operation.done) throw new Error("Google is still updating this subscription. Retry shortly.");
  return operation.response;
}

export async function getMeetEventStatus(context: TenantContext) {
  const current = (await settings(context).get()).data();
  let configured = true;
  try { config(); } catch { configured = false; }
  return { configured, enabled: current?.enabled === true, state: current?.state || "not_enabled", expireTime: current?.expireTime || null, lastError: current?.lastError || null, lastEventAt: current?.lastEventAt || null };
}

export async function enableMeetEvents(context: TenantContext, renewOnly = false) {
  const configured = config();
  const ref = settings(context);
  const current = (await ref.get()).data();
  if (renewOnly && !current?.enabled) return;
  const lease = randomUUID();
  await db().runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if ((data?.leaseUntil || 0) > Date.now()) throw new Error("Subscription setup is already running.");
    tx.set(ref, { lease, leaseUntil: Date.now() + 120000 }, { merge: true });
  });
  try {
    const token = await getGoogleMeetingAccessToken(context);
    // The Google profile ID is interoperable with Meet's signedinUser.user ID.
    const profile = await call<{ id: string }>(token, "https://www.googleapis.com/oauth2/v2/userinfo");
    if (!/^\d+$/.test(profile.id || "")) throw new Error("Reconnect Google Meet to approve Google profile access.");
    const targetResource = `//cloudidentity.googleapis.com/users/${profile.id}`;
    // Recover an existing subscription if a previous operation succeeded before persistence.
    const found: Subscription[] = [];
    let pageToken = "";
    const seen = new Set<string>();
    do {
      const url = new URL(`${API}/subscriptions`);
      url.searchParams.set("filter", `event_types:"google.workspace.meet.transcript.v2.fileGenerated" AND target_resource="${targetResource}"`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await call<{ subscriptions?: Subscription[]; nextPageToken?: string }>(token, url.toString());
      found.push(...page.subscriptions || []);
      pageToken = page.nextPageToken || "";
      if (pageToken && seen.has(pageToken)) throw new Error("Google repeated a subscription page token.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    const existing = found.find((item) => item.targetResource === targetResource && item.notificationEndpoint?.pubsubTopic === configured.topic);
    let subscription: Subscription;
    if (existing) {
      if (existing.state === "SUSPENDED") await completed(token, await call<Operation>(token, `${API}/${existing.name}:reactivate`, "POST", {}));
      subscription = await completed(token, await call<Operation>(token, `${API}/${existing.name}?updateMask=ttl`, "PATCH", { name: existing.name, ttl: "604800s" }));
    } else {
      subscription = await completed(token, await call<Operation>(token, `${API}/subscriptions`, "POST", { targetResource, eventTypes: meetEventTypes, notificationEndpoint: { pubsubTopic: configured.topic }, ttl: "604800s" }));
    }
    const source = `//workspaceevents.googleapis.com/${subscription.name}`;
    await db().doc(`meetEventSubscriptions/${hash(source)}`).set({ source, tenantId: context.tenantId, userId: context.userId, enabled: true });
    await ref.set({ enabled: true, source, state: subscription.state, expireTime: subscription.expireTime, lastError: null, leaseUntil: 0 }, { merge: true });
    return await getMeetEventStatus(context);
  } catch (error) {
    await ref.set({ lastError: error instanceof Error ? error.message : "Subscription setup failed", leaseUntil: 0 }, { merge: true });
    throw error;
  }
}

export async function authenticateMeetPush(request: Request) {
  const configured = config();
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) throw new Error("Missing Google push identity.");
  const { payload } = await jwtVerify(bearer, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: configured.audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "email", "email_verified"] });
  if (payload.email !== configured.email || payload.email_verified !== true) throw new Error("Unexpected Google push identity.");
  return configured;
}

export async function receiveMeetPush(value: unknown) {
  const event = parseMeetPush(value, config().subscription);
  const owner = (await db().doc(`meetEventSubscriptions/${hash(event.source)}`).get()).data();
  if (!owner?.enabled || owner.source !== event.source) throw new Error("Workspace subscription is not registered in MTOS.");
  const user = await db().doc(`${tenantUsersCollectionPath(owner.tenantId)}/${owner.userId}`).get();
  if (!user.exists) throw new Error("Connected user no longer exists.");
  const context: TenantContext = { tenantId: owner.tenantId, userId: owner.userId, role: user.data()?.role || "account_manager" };
  if (event.ignored) return;
  const journal = db().doc(`meetEventDeliveries/${hash(`${event.source}:${event.id}`)}`);
  const lease = randomUUID();
  const acquired = await db().runTransaction(async (tx) => {
    const prior = (await tx.get(journal)).data();
    if (prior?.done) return false;
    if ((prior?.leaseUntil || 0) > Date.now()) throw new Error("Event is already processing; retry later.");
    tx.set(journal, { source: event.source, eventId: event.id, type: event.type, lease, leaseUntil: Date.now() + 360000, receivedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!acquired) return;
  try {
    if (event.lifecycle) await enableMeetEvents(context, true);
    else await processGoogleConferenceEvent(context, event.conference!, event.type === "google.workspace.meet.transcript.v2.fileGenerated");
    await journal.set({ done: true, leaseUntil: 0, processedAt: new Date().toISOString(), eventTime: event.time }, { merge: true });
    await settings(context).set({ lastEventAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    await journal.set({ leaseUntil: 0, lastError: error instanceof Error ? error.message : "Processing failed" }, { merge: true });
    throw error;
  }
}
