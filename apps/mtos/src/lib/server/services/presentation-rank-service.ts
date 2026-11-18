import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord, PresentationRankComparison } from "@/src/lib/mtos-data";
/** Only original Report Builder images explicitly reviewed for this touch enter the deck. */
export async function presentationRankComparisons(_context: TenantContext, touch: MonthlyTouchRecord): Promise<PresentationRankComparison[]> {
  return (touch.approvedRankComparisons || []).filter(item => item.originalImage && item.nativeSource);
}
