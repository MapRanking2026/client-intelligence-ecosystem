import type { WorkOrderType } from "@/src/lib/domain/work-order";

/**
 * Sellable service offerings surfaced in the app. Starting a service creates an
 * internal work order (human action) — it never charges or notifies anyone.
 */
export interface ServiceOffering {
  id: string;
  name: string;
  priceUsd: number;
  cadence: "one_time" | "monthly";
  description: string;
  workOrderType: WorkOrderType;
}

export const SERVICE_OFFERINGS: ServiceOffering[] = [
  {
    id: "one_time_optimization_499",
    name: "One-Time GBP Optimization",
    priceUsd: 499,
    cadence: "one_time",
    description:
      "A single, thorough Google Business Profile optimization pass: categories, services, description, products, and posts — with the changes explained for the client.",
    workOrderType: "gbp_optimization",
  },
];

export function getServiceOffering(id: string): ServiceOffering | undefined {
  return SERVICE_OFFERINGS.find((o) => o.id === id);
}
