import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { resolvePreferences } from "@/src/lib/contracts/user-preferences";
import { getAccountManagerPreferences } from "@/src/lib/server/services/user-service";

/**
 * Rendered per request, never prerendered.
 *
 * This page used to be a bare redirect to the Command Center and could be built once. It now reads
 * the signed-in AM's own start page, which makes it per-user: a build-time copy would send everyone
 * to one person's choice. See the same note on the other per-tenant pages.
 */
export const dynamic = "force-dynamic";

/**
 * The app's front door: wherever this AM asked to start.
 *
 * The preference is a value from a closed list (see START_PAGES), so this redirect can never be
 * pointed at a path MTOS does not own. Without a stored choice it is the Command Center, exactly
 * as it was before Settings existed.
 */
export default async function Home() {
  const context = await resolveTenantContext();
  const preferences = resolvePreferences(await getAccountManagerPreferences(context));
  redirect(preferences.startPage);
}
