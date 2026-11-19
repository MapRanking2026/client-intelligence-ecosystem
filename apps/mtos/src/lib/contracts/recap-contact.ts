/** Names must come from client records or an explicitly named meeting participant. */
export function knownContactName(value: string | undefined): string {
  const name = value?.trim() || "";
  return !name || /^(unknown|n\/?a|none|null|undefined|not (?:provided|available)|no (?:name|contact)|-)$/i.test(name) ? "" : name;
}

export function recapContactName(recorded: string | undefined, summary: string): string {
  // A participant explicitly named in the meeting summary is more relevant than a stale CRM contact.
  const match = summary.match(/\b(?:[Mm]et|[Ss]poke|[Cc]all|[Tt]ouch|[Mm]eeting|[Rr]eview)\s+(?:today\s+)?with\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,2})(?=\s*[,.(—–]|\s+on\b|\s+from\b|\s+of\b|$)/u);
  return knownContactName(match?.[1]) || knownContactName(recorded);
}
