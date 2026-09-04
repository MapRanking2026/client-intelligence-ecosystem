"use client";

import { useMemo, useRef, useState } from "react";
import { UploadCloud, Wand2, Save, LoaderCircle, Image as ImageIcon, Check } from "lucide-react";

import type { ReportBrand } from "@/src/lib/server/services/report-brand-service";

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex: string, target: string, t: number): string {
  const a = parseHex(hex), b = parseHex(target);
  if (!a || !b) return hex.replace(/^#/, "");
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, "0");
  return c(0) + c(1) + c(2);
}
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: "var(--r-md)",
  border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.86rem",
};

export function ReportBrandClient({ initialBrand }: { initialBrand: ReportBrand }) {
  const [companyName, setCompanyName] = useState(initialBrand.companyName);
  const [reportTypeLabel, setReportTypeLabel] = useState(initialBrand.reportTypeLabelDefault);
  const [footerText, setFooterText] = useState(initialBrand.footerText);
  const [font, setFont] = useState(initialBrand.font);
  const [primary, setPrimary] = useState(initialBrand.primaryColor || "1a73e8");
  const [logoDataUrl, setLogoDataUrl] = useState(initialBrand.logoDataUrl || "");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "risk"; text: string } | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const sampleRef = useRef<HTMLInputElement>(null);

  const p = /^#?[0-9a-fA-F]{6}$/.test(primary) ? primary.replace(/^#/, "") : "1a73e8";
  const preview = useMemo(() => ({
    navy: mix(p, "060a12", 0.72),
    blueDeep: mix(p, "000000", 0.42),
    blueMid: mix(p, "000000", 0.2),
    blue: p,
    label: mix(p, "ffffff", 0.62),
    pale: mix(p, "ffffff", 0.8),
    bg: mix(p, "ffffff", 0.9),
  }), [p]);

  async function onLogo(file: File) {
    setMsg(null);
    if (!file.type.startsWith("image/")) { setMsg({ tone: "risk", text: "Choose a PNG or JPG logo." }); return; }
    try { setLogoDataUrl(await readAsDataUrl(file)); } catch { setMsg({ tone: "risk", text: "Couldn't read that image." }); }
  }

  async function onSample(file: File) {
    setExtracting(true);
    setMsg(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await fetch("/api/settings/report-brand/extract", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't read that sample");
      const e = json.data as { companyName?: string; font?: string; primaryColor?: string; logoDataUrl?: string };
      const got: string[] = [];
      if (e.primaryColor) { setPrimary(e.primaryColor); got.push("colors"); }
      if (e.font) { setFont(e.font); got.push("font"); }
      if (e.logoDataUrl) { setLogoDataUrl(e.logoDataUrl); got.push("logo"); }
      if (e.companyName) { setCompanyName(e.companyName); got.push("company name"); }
      setMsg(got.length
        ? { tone: "good", text: `Pulled ${got.join(", ")} from the sample. Review below and save.` }
        : { tone: "risk", text: "Couldn't find brand details in that file — set them manually below." });
    } catch (err) {
      setMsg({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't read that sample" });
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/report-brand", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, reportTypeLabelDefault: reportTypeLabel, footerText, font, primaryColor: p, logoDataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't save");
      setMsg({ tone: "good", text: "Saved. New reports for this workspace will use this brand." });
    } catch (err) {
      setMsg({ tone: "risk", text: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Editor */}
      <div className="flex flex-col gap-4">
        {/* Seed from sample */}
        <div className="rounded-[12px] p-4" style={{ border: "1px dashed var(--hair-strong)", background: "var(--surface-2)" }}>
          <div className="flex items-center gap-2 text-[0.9rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
            <Wand2 style={{ width: 16, height: 16, color: "var(--accent)" }} /> Seed brand from a sample report
          </div>
          <p className="muted text-[0.8rem]" style={{ margin: "6px 0 10px" }}>
            Upload one of this company&apos;s existing Word reports — we&apos;ll pull the <b style={{ color: "var(--text)" }}>logo, colors, and font</b> and prefill the fields. You confirm before saving.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => sampleRef.current?.click()} disabled={extracting}>
            {extracting ? <LoaderCircle className="animate-spin" style={{ width: 15, height: 15 }} /> : <UploadCloud style={{ width: 15, height: 15 }} />}
            {extracting ? "Reading…" : "Upload sample .docx"}
          </button>
          <input ref={sampleRef} type="file" accept=".docx" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) void onSample(e.target.files[0]); e.target.value = ""; }} />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Company name</span>
            <input style={inputStyle} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Font (Word-safe)</span>
            <input style={inputStyle} value={font} onChange={(e) => setFont(e.target.value)} placeholder="Arial" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Default report label</span>
            <input style={inputStyle} value={reportTypeLabel} onChange={(e) => setReportTypeLabel(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Footer text</span>
            <input style={inputStyle} value={footerText} onChange={(e) => setFooterText(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Brand color</span>
            <span className="flex items-center gap-2.5">
              <input type="color" value={`#${p}`} onChange={(e) => setPrimary(e.target.value.replace(/^#/, ""))} style={{ width: 44, height: 38, border: "1px solid var(--hair)", borderRadius: 8, background: "var(--surface)", padding: 2 }} />
              <input style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)" }} value={`#${p}`} onChange={(e) => setPrimary(e.target.value.replace(/^#/, ""))} />
            </span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow muted">Logo</span>
            <div className="flex items-center gap-2.5">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => logoRef.current?.click()}>
                <ImageIcon style={{ width: 15, height: 15 }} /> {logoDataUrl ? "Replace" : "Upload"}
              </button>
              {logoDataUrl ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogoDataUrl("")}>Use default</button> : null}
              <input ref={logoRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) void onLogo(e.target.files[0]); e.target.value = ""; }} />
            </div>
          </div>
        </div>

        {msg ? <div className={`chip ${msg.tone}`} style={{ alignSelf: "flex-start" }}>{msg.tone === "good" ? <Check style={{ width: 13, height: 13 }} /> : null}{msg.text}</div> : null}

        <div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving} style={saving ? { opacity: 0.6 } : undefined}>
            {saving ? <LoaderCircle className="animate-spin" style={{ width: 15, height: 15 }} /> : <Save style={{ width: 15, height: 15 }} />}
            {saving ? "Saving…" : "Save branding"}
          </button>
        </div>
      </div>

      {/* Live cover preview */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow muted">Cover preview</span>
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--hair)", background: `#${preview.navy}`, padding: "26px 20px", textAlign: "center" }}>
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} alt="logo" style={{ width: 56, height: 56, objectFit: "contain", margin: "0 auto 12px" }} />
          ) : (
            <div style={{ width: 56, height: 56, margin: "0 auto 12px", borderRadius: 10, background: "rgba(255,255,255,0.1)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>{(companyName || "M").slice(0, 1)}</div>
          )}
          <div style={{ color: `#${preview.label}`, fontSize: "0.62rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>{reportTypeLabel || "Report"}</div>
          <div style={{ color: "#fff", fontSize: "1.35rem", fontWeight: 800, marginTop: 6, fontFamily: font || "Arial" }}>Client Name</div>
          <div style={{ color: `#${preview.label}`, fontSize: "0.72rem", marginTop: 4 }}>clientsite.com</div>
        </div>
        <div className="flex gap-1.5" style={{ marginTop: 2 }}>
          {[preview.blue, preview.blueMid, preview.blueDeep, preview.pale, preview.bg].map((c, i) => (
            <span key={i} title={`#${c}`} style={{ flex: 1, height: 22, borderRadius: 5, background: `#${c}`, border: "1px solid var(--hair)" }} />
          ))}
        </div>
        <p className="muted text-[0.74rem]">The whole palette derives from your brand color. Status colors (green / amber) stay fixed for clarity.</p>
      </div>
    </div>
  );
}
