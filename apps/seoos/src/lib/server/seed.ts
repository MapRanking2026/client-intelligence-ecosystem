import type {
  AppMembershipV1,
  LeadCallRecordV1,
  OutboxEventV1,
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
} from "@cie/contracts";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import type { KeywordV1 } from "@/src/lib/domain/keyword";
import type { RecommendationV1 } from "@/src/lib/domain/recommendation";
import type { WorkOrderV1 } from "@/src/lib/domain/work-order";
import type { SeoUserV1 } from "@/src/lib/domain/user";
import type { SeoPodV1 } from "@/src/lib/domain/pod";
import type { SpecialistV1 } from "@/src/lib/domain/specialist";
import type { NicheStudyV1 } from "@/src/lib/domain/niche-study";
import type { MonthlyAuditV1 } from "@/src/lib/domain/monthly-audit";
import type { IntegrationConnectionV1 } from "@/src/lib/domain/integration";

/**
 * In-memory store for the no-Firestore fallback (dev). Intentionally EMPTY —
 * the app never shows demo/sample data. Without Firebase credentials every list
 * is empty (real empty states); with Firebase the repos use Firestore and this
 * store is not used at all.
 */
interface SeedStore {
  memberships: AppMembershipV1[];
  projects: SeoProjectV1[];
  requests: SeoIntelligenceRequestV1[];
  packages: SeoIntelligencePackageV1[];
  leadCalls: LeadCallRecordV1[];
  keywords: KeywordV1[];
  recommendations: RecommendationV1[];
  workOrders: WorkOrderV1[];
  outbox: OutboxEventV1[];
  users: SeoUserV1[];
  pods: SeoPodV1[];
  specialists: SpecialistV1[];
  nicheStudies: NicheStudyV1[];
  monthlyAudits: MonthlyAuditV1[];
  integrations: IntegrationConnectionV1[];
}

function buildSeed(): SeedStore {
  return {
    memberships: [],
    projects: [],
    requests: [],
    packages: [],
    leadCalls: [],
    keywords: [],
    recommendations: [],
    workOrders: [],
    outbox: [],
    users: [],
    pods: [],
    specialists: [],
    nicheStudies: [],
    monthlyAudits: [],
    integrations: [],
  };
}

/** Singleton so writes within a server process persist across requests. */
export const seedStore: SeedStore = buildSeed();
