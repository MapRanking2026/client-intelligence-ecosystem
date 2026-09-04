/**
 * Seed a tenant's report brand from an uploaded sample .docx (best-effort).
 *
 * Honest scope: we extract the brand TOKENS — logo, primary color, font, and a
 * candidate company name — and apply them to our proven report layout. We do not
 * clone an arbitrary document's layout; that isn't reliable. The operator confirms
 * or tweaks the extracted values before saving.
 */
import JSZip from "jszip";

import type { ReportBrandColors } from "@/src/lib/server/services/report-brand-service";

export interface ExtractedBrand {
  companyName?: string;
  font?: string;
  primaryColor?: string;
  logoDataUrl?: string;
}

function clampHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Linear blend of `hex` toward `target` by t in [0,1]. */
function mix(hex: string, target: string, t: number): string {
  const a = parseHex(hex), b = parseHex(target);
  if (!a || !b) return hex.replace(/^#/, "");
  return [0, 1, 2].map((i) => clampHex(a[i] + (b[i] - a[i]) * t)).join("");
}

/** Build a coherent 7-role report palette from a single brand color. */
export function deriveBrandColors(primary: string): ReportBrandColors {
  const p = (parseHex(primary) ? primary.replace(/^#/, "") : "1a73e8").toLowerCase();
  return {
    navy: mix(p, "060a12", 0.72),
    blueDeep: mix(p, "000000", 0.42),
    blueMid: mix(p, "000000", 0.2),
    blue: p,
    blueBright: mix(p, "ffffff", 0.18),
    bluePale: mix(p, "ffffff", 0.8),
    blueBg: mix(p, "ffffff", 0.9),
  };
}

/** Rough perceptual "colorfulness" — used to pick the most brand-like theme color. */
function saturationScore(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const max = Math.max(...rgb), min = Math.min(...rgb);
  const lightness = (max + min) / 2;
  // penalize near-white and near-black so we don't pick a neutral.
  const chroma = max - min;
  const midness = 1 - Math.abs(lightness - 128) / 128;
  return chroma * (0.5 + 0.5 * midness);
}

const IMAGE_EXT = /\.(png|jpe?g)$/i;
function mimeFor(name: string): string {
  return /\.png$/i.test(name) ? "image/png" : "image/jpeg";
}

export async function extractBrandFromDocx(buffer: Buffer): Promise<ExtractedBrand> {
  const out: ExtractedBrand = {};
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("That file isn't a readable .docx. Export the sample as a Word document and try again.");
  }

  // ── Logo: the largest embedded image in word/media ──────────────────────────
  const mediaFiles = Object.values(zip.files).filter((f) => /^word\/media\//i.test(f.name) && IMAGE_EXT.test(f.name));
  let best: { name: string; data: Uint8Array } | null = null;
  for (const f of mediaFiles) {
    const data = await f.async("uint8array");
    if (data.byteLength < 700) continue; // skip icons/spacers
    if (!best || data.byteLength > best.data.byteLength) best = { name: f.name, data };
  }
  if (best) {
    const b64 = Buffer.from(best.data).toString("base64");
    out.logoDataUrl = `data:${mimeFor(best.name)};base64,${b64}`;
  }

  // ── Theme: primary color + font ─────────────────────────────────────────────
  const themeFile = Object.values(zip.files).find((f) => /^word\/theme\/theme\d*\.xml$/i.test(f.name));
  if (themeFile) {
    const xml = await themeFile.async("string");
    const clrScheme = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0] || "";
    const accentHexes: string[] = [];
    for (const m of clrScheme.matchAll(/<a:(accent[1-6])>[\s\S]*?<a:srgbClr val="([0-9a-fA-F]{6})"/g)) {
      accentHexes.push(m[2]);
    }
    if (accentHexes.length) {
      out.primaryColor = accentHexes.map((h) => ({ h, s: saturationScore(h) })).sort((a, b) => b.s - a.s)[0].h.toLowerCase();
    }
    const font =
      xml.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]+)"/)?.[1] ||
      xml.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]+)"/)?.[1];
    if (font && !font.startsWith("+")) out.font = font;
  }

  // ── Fallback color: the most-used explicit run color in the body ────────────
  if (!out.primaryColor) {
    const docFile = zip.file("word/document.xml");
    if (docFile) {
      const xml = await docFile.async("string");
      const counts = new Map<string, number>();
      for (const m of xml.matchAll(/<w:color w:val="([0-9a-fA-F]{6})"/g)) {
        const hex = m[1].toLowerCase();
        if (hex === "000000" || hex === "ffffff" || hex === "auto") continue;
        counts.set(hex, (counts.get(hex) || 0) + 1);
      }
      const ranked = [...counts.entries()]
        .map(([hex, count]) => ({ hex, weight: count * (0.4 + saturationScore(hex) / 255) }))
        .sort((a, b) => b.weight - a.weight);
      if (ranked.length) out.primaryColor = ranked[0].hex;
    }
  }

  // ── Company name: first bold-ish header text, else the first cover-sized run ─
  const headerFile = Object.values(zip.files).find((f) => /^word\/header\d*\.xml$/i.test(f.name));
  const nameFromXml = (xml: string): string | undefined => {
    const texts = [...xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)].map((m) => m[1].trim()).filter(Boolean);
    const candidate = texts.find((t) => t.length >= 2 && t.length <= 40 && !/^page\b/i.test(t) && !/confidential/i.test(t));
    return candidate;
  };
  if (headerFile) out.companyName = nameFromXml(await headerFile.async("string"));

  return out;
}
