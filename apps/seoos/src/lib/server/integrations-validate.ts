/**
 * Credential validation for integrations. Runs at connect time so a bad token is
 * caught immediately. Only DEFINITIVE auth rejections block the connect; network
 * or unknown errors let the connect proceed (transient issues shouldn't lock a
 * valid credential out). Never stores or returns the secret.
 */
export interface ValidateResult {
  ok: boolean;
  message?: string;
  /** True only on a definitive auth rejection (blocks the connect). */
  blocked?: boolean;
}

async function timedFetch(url: string, init?: RequestInit, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateGoHighLevel(creds: Record<string, string>): Promise<ValidateResult> {
  const key = creds.apiKey;
  if (!key) return { ok: false, blocked: true, message: "API key is required." };
  try {
    const res = await timedFetch("https://rest.gohighlevel.com/v1/locations/", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, blocked: true, message: "GoHighLevel rejected the API key (401/403)." };
    }
    if (res.ok) return { ok: true, message: "GoHighLevel key verified." };
    return { ok: true, message: `Stored; GoHighLevel returned ${res.status} (not an auth error).` };
  } catch {
    return { ok: true, message: "Stored; couldn't reach GoHighLevel to verify (saved anyway)." };
  }
}

async function validateMetaAds(creds: Record<string, string>): Promise<ValidateResult> {
  const token = creds.accessToken;
  const acct = (creds.adAccountId || "").trim();
  if (!token || !acct) return { ok: false, blocked: true, message: "Access token and Ad Account ID are required." };
  const id = acct.startsWith("act_") ? acct : `act_${acct}`;
  try {
    const res = await timedFetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(id)}?fields=name&access_token=${encodeURIComponent(token)}`,
    );
    const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    if (body.error) {
      return { ok: false, blocked: true, message: `Meta rejected the token: ${body.error.message ?? "auth error"}.` };
    }
    if (res.ok && body.name) return { ok: true, message: `Connected to Meta ad account "${body.name}".` };
    return { ok: true, message: `Stored; Meta returned ${res.status}.` };
  } catch {
    return { ok: true, message: "Stored; couldn't reach Meta to verify (saved anyway)." };
  }
}

function validateGoogleAnalytics(creds: Record<string, string>): ValidateResult {
  if (!creds.propertyId?.trim()) return { ok: false, blocked: true, message: "GA4 Property ID is required." };
  try {
    const parsed = JSON.parse(creds.serviceAccountJson ?? "{}") as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      return { ok: false, blocked: true, message: "Service Account JSON must include client_email and private_key." };
    }
    return { ok: true, message: "GA4 credentials look valid (live verification runs on first sync)." };
  } catch {
    return { ok: false, blocked: true, message: "Service Account JSON is not valid JSON." };
  }
}

function validateGoogleAds(creds: Record<string, string>): ValidateResult {
  const missing = ["developerToken", "clientId", "clientSecret", "refreshToken", "customerId"].filter(
    (k) => !creds[k]?.trim(),
  );
  if (missing.length) return { ok: false, blocked: true, message: `Missing: ${missing.join(", ")}.` };
  return { ok: true, message: "Google Ads credentials stored (live verification runs on first sync)." };
}

export async function validateIntegration(
  providerId: string,
  creds: Record<string, string>,
): Promise<ValidateResult> {
  switch (providerId) {
    case "gohighlevel":
      return validateGoHighLevel(creds);
    case "meta-ads":
      return validateMetaAds(creds);
    case "google-analytics":
      return validateGoogleAnalytics(creds);
    case "google-ads":
      return validateGoogleAds(creds);
    default:
      return { ok: true };
  }
}
