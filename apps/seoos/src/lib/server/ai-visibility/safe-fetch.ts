import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * SSRF-hardened GET for public web pages (website suggestions).
 * - http/https only, default ports only, no credentials in URL
 * - every hostname resolution is checked AT CONNECT TIME (DNS-rebinding safe)
 *   and private, loopback, link-local, CGNAT, multicast, metadata and
 *   unique-local ranges are refused
 * - redirects are followed manually (max 4) and re-validated
 * - response size and time are capped; only text/html is accepted
 */

export class SafeFetchError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (v === 6) {
    const a = ip.toLowerCase();
    if (a === "::" || a === "::1") return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a) || a.startsWith("64:ff9b:") || a.startsWith("2001:db8");
  }
  return true;
}

export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = addrs as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error(`Refused: ${hostname} resolves to a private or reserved address`), { code: "EPRIVATE" }), "", 4);
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new SafeFetchError("Invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SafeFetchError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new SafeFetchError("URLs with credentials are not allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new SafeFetchError("Non-standard ports are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) throw new SafeFetchError("Private addresses are not allowed");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new SafeFetchError("Internal hostnames are not allowed");
  return u;
}

function getOnce(u: URL, timeoutMs: number, maxBytes: number): Promise<{ status: number; location?: string; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: guardedLookup as unknown as typeof dnsLookup,
        headers: {
          "user-agent": "SEOOS-AIVisibility/1.0 (+business details review; read-only)",
          accept: "text/html,application/xhtml+xml",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: "", contentType });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new SafeFetchError("Response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), contentType }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("Timed out")));
    req.on("error", (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError(e.message)));
    req.end();
  });
}

export async function safeFetchHtml(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ finalUrl: string; html: string }> {
  let u = validateUrl(raw);
  for (let hop = 0; hop < 5; hop += 1) {
    const r = await getOnce(u, opts.timeoutMs ?? 10000, opts.maxBytes ?? 2_000_000);
    if (r.location) {
      if (hop === 4) throw new SafeFetchError("Too many redirects");
      u = validateUrl(new URL(r.location, u).toString());
      continue;
    }
    if (r.status >= 400) throw new SafeFetchError(`Site responded HTTP ${r.status}`);
    if (!/html|xml/i.test(r.contentType)) throw new SafeFetchError(`Unsupported content type: ${r.contentType || "unknown"}`);
    return { finalUrl: u.toString(), html: r.body };
  }
  throw new SafeFetchError("Too many redirects");
}
