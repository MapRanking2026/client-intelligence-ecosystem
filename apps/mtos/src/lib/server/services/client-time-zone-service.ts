import type { TenantContext } from "@/src/lib/contracts/mtos";
import { clientZone } from "@/src/lib/contracts/client-time-zone";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientPath } from "@/src/lib/server/firebase/collections";

export async function saveClientTimeZone(context: TenantContext, touchId: string, value: string) {
  const timeZone = clientZone(value);
  if (!timeZone) throw new Error("Select a valid client IANA time zone, such as America/Los_Angeles. Use a region-based zone rather than EST or PST so daylight saving is handled correctly.");
  const source = getMtosDataSource(context);
  const touch = await source.getMonthlyTouchById(touchId);
  const client = touch && await source.getClientById(touch.clientId);
  if (!touch || !client) throw new Error("This client's Monthly Touch is not available to your account.");
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable; the client's time zone was not saved.");
  await db.doc(clientPath(context.tenantId, client.id)).update({ timeZone, timeZoneUpdatedBy: context.userId, timeZoneUpdatedAt: new Date().toISOString() });
  return { timeZone, message: "Client time zone saved. Draft meeting times use this zone; the scheduled meeting itself was not moved." };
}
