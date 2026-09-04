"use client";

import { useState } from "react";
import { LifeBuoy, X, ShieldAlert, CheckCircle2, Lightbulb, MessageSquareQuote, Download, LoaderCircle, PenLine } from "lucide-react";

import { SectionAdditions } from "@/src/components/mtos/section-additions";

interface RetentionBrief {
  headline: string;
  proofPoints: string[];
  whyNotFelt: string;
  theAsk: string;
  talkTrack: { open: string; reframe: string; ask: string };
}

/** Parse the AM's confirmed link list: one per line, "Page Name | https://url | optional note". */
function parseLinks(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url, note] = line.split("|").map((p) => (p || "").trim());
      return { name, url, note };
    })
    .filter((l) => l.name && /^https?:\/\//i.test(l.url || ""));
}

export function RetentionButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<RetentionBrief | null>(null);
  const [linksText, setLinksText] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [generating, setGenerating] = useState(false);

  async function loadBrief(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/retention`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't assemble the retention case");
      setBrief(json.data.brief as RetentionBrief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function launch() {
    setOpen(true);
    await loadBrief();
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/retention/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: parseLinks(linksText), signerName: signerName.trim() || undefined, signerTitle: signerTitle.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Couldn't generate the report");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const fileName = cd.match(/filename="([^"]+)"/)?.[1] || "Performance-Report.docx";
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the report");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void launch()}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.78rem] font-semibold"
        style={{ background: "var(--risk-soft, #fee2e2)", color: "var(--risk, #b91c1c)", border: "1px solid color-mix(in srgb, var(--risk, #b91c1c) 35%, transparent)" }}
        title="Emergency retention — build the save-the-account case"
      >
        <LifeBuoy style={{ width: 14, height: 14 }} />
        Retention Mode
      </button>

      {open ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 16, background: "rgba(10,16,26,0.5)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ width: "min(720px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 0, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <div className="h4 flex items-center gap-2">
                  <ShieldAlert style={{ width: 18, height: 18, color: "var(--risk, #b91c1c)" }} />
                  Emergency Retention
                </div>
                <div className="muted text-[0.78rem]">{clientName} · the case for staying</div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close" type="button"><X /></button>
            </div>

            <div style={{ padding: 20 }}>
              {loading ? (
                <div className="muted flex items-center gap-2 text-[0.86rem]"><LoaderCircle className="animate-spin" style={{ width: 16, height: 16 }} /> Assembling the case…</div>
              ) : error && !brief ? (
                <div className="chip risk">{error}</div>
              ) : brief ? (
                <>
                  {/* Headline */}
                  <div className="rounded-[12px] p-4" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", marginBottom: 16 }}>
                    <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>The headline</div>
                    <p className="mt-1.5 text-[0.95rem]" style={{ fontWeight: 600 }}>{brief.headline}</p>
                  </div>

                  {/* Proof points */}
                  <div className="card-title mb-2 flex items-center gap-2"><CheckCircle2 style={{ width: 15, height: 15, color: "var(--good)" }} /> Proof of value delivered</div>
                  <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
                    {brief.proofPoints.map((p, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
                        <span className="sig-dot good" style={{ marginTop: 6 }} />
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>

                  {/* Why not felt */}
                  <div className="insight info" style={{ gridTemplateColumns: "auto 1fr", marginBottom: 12 }}>
                    <div className="insight-icon"><Lightbulb /></div>
                    <div>
                      <div className="h4" style={{ fontSize: "0.9rem" }}>Why they may not feel it — and the fix</div>
                      <p className="muted mt-1 text-[0.84rem]">{brief.whyNotFelt}</p>
                    </div>
                  </div>

                  {/* The ask */}
                  <div className="insight" style={{ gridTemplateColumns: "auto 1fr", marginBottom: 16 }}>
                    <div className="insight-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><MessageSquareQuote /></div>
                    <div>
                      <div className="h4" style={{ fontSize: "0.9rem" }}>The ask</div>
                      <p className="muted mt-1 text-[0.84rem]">{brief.theAsk}</p>
                    </div>
                  </div>

                  {/* Talk track */}
                  <div className="card-title mb-2">Talk track</div>
                  <div className="flex flex-col gap-2" style={{ marginBottom: 20 }}>
                    {[["Open — anchor on the win", brief.talkTrack.open], ["Acknowledge — reframe", brief.talkTrack.reframe], ["The ask", brief.talkTrack.ask]].map(([label, body], i) => (
                      <div key={i} className="rounded-[10px] p-3 text-[0.85rem]" style={{ background: "var(--surface-2)", border: "1px solid var(--hair)", color: "var(--text)" }}>
                        <div className="eyebrow muted mb-1">{label}</div>
                        {body}
                      </div>
                    ))}
                  </div>

                  {/* Add anything we missed */}
                  <div style={{ borderTop: "1px solid var(--hair)", paddingTop: 16, marginBottom: 4 }}>
                    <div className="card-title mb-1 flex items-center gap-2"><PenLine style={{ width: 15, height: 15, color: "var(--accent)" }} /> Add anything we missed</div>
                    <p className="muted text-[0.8rem]" style={{ marginBottom: 10 }}>
                      Points you add here are folded into the brief above <b style={{ color: "var(--text)" }}>and</b> the generated report. Use them for the origin baseline, a recent win, or anything the system didn&apos;t capture.
                    </p>
                    <div className="grid gap-2.5">
                      {([
                        ["results", "Results / proof of value"],
                        ["work", "Work we completed"],
                        ["inProgress", "In progress"],
                        ["blockers", "Technical / quality items"],
                        ["recommendation", "Recommendation"],
                      ] as const).map(([key, lbl]) => (
                        <div key={key} className="rounded-[10px] p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}>
                          <div className="eyebrow muted">{lbl}</div>
                          <SectionAdditions clientId={clientId} sectionKey={key} label={`Add to ${lbl.toLowerCase()}`} onChange={() => void loadBrief(true)} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Generate report */}
                  <div style={{ borderTop: "1px solid var(--hair)", paddingTop: 16 }}>
                    <div className="card-title mb-1">Generate the client report</div>
                    <p className="muted text-[0.8rem]" style={{ marginBottom: 10 }}>
                      Confirm the live pages we built so the report links to real work. One per line: <b style={{ color: "var(--text)" }}>Page Name | https://url | note</b>
                    </p>
                    <textarea
                      value={linksText}
                      onChange={(e) => setLinksText(e.target.value)}
                      rows={4}
                      placeholder={"Metal Roofing | https://client.com/metal-roofing/ | New service page built\nRoof Repair | https://client.com/roof-repair/ | Optimized"}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.82rem", resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
                    />
                    <div className="grid gap-2.5 sm:grid-cols-2" style={{ marginTop: 10 }}>
                      <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signed by (your name)" style={{ padding: "9px 12px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.84rem" }} />
                      <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="Your title (e.g. Account Manager · MapRanking)" style={{ padding: "9px 12px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.84rem" }} />
                    </div>
                    {error ? <div className="chip risk" style={{ marginTop: 12 }}>{error}</div> : null}
                    <div className="flex items-center justify-between" style={{ marginTop: 14 }}>
                      <span className="muted text-[0.74rem]">Branded, client-ready Word report · links verified live before you send</span>
                      <button className="btn btn-primary btn-sm" onClick={() => void generate()} disabled={generating} type="button" style={generating ? { opacity: 0.6 } : undefined}>
                        {generating ? <LoaderCircle className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}
                        {generating ? "Generating…" : "Generate report"}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
