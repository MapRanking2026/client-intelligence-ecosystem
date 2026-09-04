import type { Firestore } from "firebase-admin/firestore";

/** All SEOOS data is tenant-scoped under tenants/{tenantId}/… (shared with MTOS). */
export function tenantCollection(
  db: Firestore,
  tenantId: string,
  name: string,
) {
  return db.collection("tenants").doc(tenantId).collection(name);
}

export const COLLECTIONS = {
  memberships: "appMemberships",
  projects: "seoProjects",
  requests: "seoRequests",
  packages: "seoPackages",
} as const;
