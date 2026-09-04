export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function healthTone(score: number) {
  if (score >= 90) return "positive";
  if (score >= 75) return "neutral";
  if (score >= 60) return "warning";
  return "danger";
}
