export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function stripBusinessNameNoise(value: string) {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(llc|inc|corp|co|ltd|usa|dba)\b/gi, " ")
    .trim();
}

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

  return shorter.length >= 6 && longer.includes(shorter);
}
