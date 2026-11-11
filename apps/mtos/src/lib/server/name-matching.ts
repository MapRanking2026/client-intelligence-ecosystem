/**
 * A name reduced to lowercase letters, digits and single spaces.
 *
 * Accents are folded rather than deleted. Deleting them is what this did until 10 November 2026,
 * which turned "Éden 3D Québec" into "den 3d bec" -- not a normalization of the name but a
 * different name, and one that could never match the listing it belonged to. Both sides of a
 * comparison fold the same way, so an accented client name and an unaccented listing title meet.
 */
export function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function stripBusinessNameNoise(value: string) {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(llc|inc|corp|co|ltd|usa|dba)\b/gi, " ")
    .trim();
}

/**
 * Words that carry no identity, so a name that differs only by these is the same business.
 *
 * `and` is the one that matters and the reason this list exists: a client is entered in MTOS as
 * "Belza Painting & Resurfacing" and its Google listing is titled "Belza Painting and Resurfacing",
 * and the two never matched. `normalizeText` turns `&` into a space, so the client side became
 * "belza painting resurfacing" and the listing side kept its "and" -- near-identical strings that
 * failed both the equality test and the substring test, because the extra word sits in the middle.
 *
 * The legal suffixes are already removed by `stripBusinessNameNoise`; they are repeated here
 * because the token path below works from the raw name, so that `&` can be read as the word it is
 * before anything else is thrown away.
 */
const IDENTITY_FREE_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "co",
  "corp",
  "dba",
  "for",
  "in",
  "inc",
  "llc",
  "ltd",
  "of",
  "on",
  "the",
  "to",
  "usa",
  "with",
]);

/**
 * A business name as its identifying words, in order.
 *
 * `&` becomes the word `and` before anything is stripped, so "B & B" and "B and B" tokenize the
 * same way and both then lose the conjunction entirely.
 */
function identityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !IDENTITY_FREE_WORDS.has(token));
}

/**
 * Whether every identifying word of the shorter name appears in the longer one, starting with the
 * same word.
 *
 * The leading word has to match, and that guard is doing real work: without it "Painting Services"
 * would match "Belza Painting Services", and a brief would carry another client's numbers into a
 * call. With it, a client named "Colleyville - Eagle Transmission" does not claim a listing titled
 * "Eagle Transmission" through this path -- the names start differently, so a human decides with a
 * pin.
 *
 * Two identifying words minimum, because one shared word is a coincidence: half the book is a
 * "Plumbing" or a "Roofing".
 */
function identityTokensContain(clientName: string, candidateName: string): boolean {
  const client = identityTokens(clientName);
  const candidate = identityTokens(candidateName);
  if (client.length < 2 || candidate.length < 2) {
    return false;
  }
  const [shorter, longer] = client.length <= candidate.length ? [client, candidate] : [candidate, client];
  if (shorter[0] !== longer[0]) {
    return false;
  }
  const longerWords = new Set(longer);
  return shorter.every((token) => longerWords.has(token));
}

/**
 * Whether a client and a vendor's account, listing or sub-account are the same business.
 *
 * Three rules, tried in order of how certain they are: the normalized names are identical, one
 * normalized name contains the other, or the identifying words of one are all present in the other
 * starting from the same word.
 *
 * ## What the third rule bought, measured
 *
 * Added 10 November 2026 after the owner reported, twice in one day, that Belza Painting and
 * Resurfacing's pinned Business Profile listing was not reaching the preparation. The pin itself
 * was a separate defect (see `contracts/client-mappings`), but the reason a pin was needed at all
 * was this: the client's name uses `&` and the listing's title spells out `and`, and nothing in
 * here could see past that.
 *
 * Run against the live tenant's 227 synced listings and 243 clients before it was committed:
 * clients with at least one matched listing went from 93 to 102, every one of the nine being an
 * `&`-versus-`and` pair of the same business ("Exact Rooter and Plumbing" / "Exact Rooter &
 * Plumbing", "Durfee Plumbing and Heating" / "Durfee Plumbing & Heating"). Listings claimed by more
 * than one client went from 5 to 6, and the one new case is two client records for the same
 * business, one spelled with `And` and one with `&`, both correctly matching its one listing.
 *
 * The 141 clients that still have no listing are not a matching problem: there is no listing for
 * them among the ones the connected Google accounts contain, which no rule here can invent. Those
 * need a pin, or an account that holds them.
 */
export function namesLikelyMatch(clientName: string, candidateName: string) {
  const normalizedClient = normalizeText(stripBusinessNameNoise(clientName));
  const normalizedCandidate = normalizeText(stripBusinessNameNoise(candidateName));

  if (!normalizedClient || !normalizedCandidate) {
    return false;
  }

  if (normalizedClient === normalizedCandidate) {
    return true;
  }

  const [shorter, longer] =
    normalizedClient.length <= normalizedCandidate.length
      ? [normalizedClient, normalizedCandidate]
      : [normalizedCandidate, normalizedClient];

  if (shorter.length >= 6 && longer.includes(shorter)) {
    return true;
  }

  return identityTokensContain(clientName, candidateName);
}
