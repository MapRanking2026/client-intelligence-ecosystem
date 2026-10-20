/**
 * FIXTURE answers for extractor tests. These are synthetic and are never
 * written to live data (tests run against an isolated tenant / no store).
 */
import type { AivCitation } from "../types";
import type { ExtractionSubject } from "../extract";

export const SUBJECT: ExtractionSubject = {
  client: {
    key: "client",
    kind: "client",
    name: "Sparkle Pro Cleaning LLC",
    aliases: ["Sparkle Pro"],
    domains: ["sparkleprocleaning.com"],
    cities: [
      { city: "La Vergne", region: "TN" },
      { city: "Smyrna", region: "TN" },
    ],
    neighborhoods: ["Lake Forest"],
  },
  competitors: [
    { key: "comp_1", kind: "competitor", name: "Music City Maids", aliases: [], domains: ["musiccitymaids.com"] },
    { key: "comp_2", kind: "competitor", name: "Ace Cleaning Co", aliases: ["Ace Cleaners"], domains: [] },
  ],
};

export function cite(url: string, order: number, extra: Partial<AivCitation> = {}): AivCitation {
  const u = new URL(url);
  return {
    url,
    normalizedUrl: `https://${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`,
    domain: u.hostname.replace(/^www\./, ""),
    order,
    answerSpans: [],
    ...extra,
  };
}

export const ORDERED_LIST = `Here are some well-reviewed deep cleaning companies in La Vergne, TN:

1. **Music City Maids** - Highly rated for deep cleans, serves the Nashville area.
2. **Sparkle Pro Cleaning** - A reliable local option in La Vergne with strong reviews.
3. **Tidy Nest Cleaning Services** - Offers move-out and deep cleaning.

Tips: ask for a written quote and confirm insurance.`;

export const PROSE = `If you need deep cleaning in Smyrna, TN, Sparkle Pro is a well-reviewed option. Many residents also use larger regional franchises.`;

export const OTHER_CITY = `For house cleaning, Sparkle Pro Cleaning (Austin, TX) has good reviews, and Music City Maids is popular around Nashville.`;

export const SUBSTRING_TRAP = `Try SuperSparkle Pro Cleaningware or Grace Cleaning Co. Another option is Aces Cleaning.`;

export const NEGATIVE = `Some customers have complained about Sparkle Pro Cleaning missing appointments, so verify availability. Music City Maids is a reliable choice.`;

export const BULLETS = `Options in La Vergne:
- **Ace Cleaners** – budget friendly
- **Sparkle Pro Cleaning** – deep cleaning specialists
- **Shine Bright Home Care** – flexible scheduling`;

export const STEPS_LIST = `To find a deep cleaner in La Vergne:
1. Check Google reviews for recent feedback.
2. Ask for proof of insurance.
3. Compare at least three quotes.

Sparkle Pro Cleaning is one company that appears in local listings.`;

export const REFUSAL = `I can't provide specific business recommendations for that request, but I can explain what to look for in a cleaning service.`;

export const DOMAIN_ONLY = `Check sparkleprocleaning.com for pricing on move-out cleaning.`;

export const HEADING_LIST = `### 1. Music City Maids
Popular for recurring service.

### 2. Sparkle Pro Cleaning LLC
Known for move-out cleaning in La Vergne.

### 3. Lakeside Janitorial Pros
Commercial focus.`;
