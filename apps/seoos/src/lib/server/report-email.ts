import { composeMonthlyReport, type MonthlyReport } from "@/src/lib/server/report-service";
import { sendEmail } from "@/src/lib/server/email";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function metric(label: string, value: string | number): string {
  return `<td style="padding:12px 16px;border:1px solid #e5e7eb;text-align:center">
    <div style="font-size:22px;font-weight:700;color:#111827">${esc(String(value))}</div>
    <div style="font-size:12px;color:#6b7280">${esc(label)}</div></td>`;
}

/** Render a monthly client report as a self-contained HTML email. */
export function renderReportHtml(report: MonthlyReport): string {
  const m = report.metrics;
  const rows = report.keywords
    .slice(0, 20)
    .map(
      (k) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(k.keyword)}</td>
         <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${k.rank ?? "—"}</td>
         <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center">${k.share ?? "—"}</td></tr>`,
    )
    .join("");
  const changes = report.changes
    .map((c) => `<li style="margin-bottom:8px"><strong>${esc(c.title)}</strong><br/><span style="color:#4b5563">${esc(c.explanation)}</span></li>`)
    .join("");
  const audit = report.audit
    ? `<p style="color:#4b5563">Monthly audit (${esc(report.audit.period)}): ${report.audit.pass} passing, ${report.audit.warn} warnings, ${report.audit.fail} failing.${report.audit.reviewResponses ? ` Reviews responded: ${esc(report.audit.reviewResponses)}.` : ""}</p>`
    : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827">
    <h1 style="font-size:22px;margin:0 0 4px">${esc(report.businessName)} — Monthly SEO Report</h1>
    <p style="color:#6b7280;margin:0 0 16px">Period ${esc(report.period)}${report.website ? ` · ${esc(report.website)}` : ""}</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px"><tr>
      ${metric("Avg map rank", m.avgRank ?? "—")}
      ${metric("Share of local voice", m.avgShare != null ? m.avgShare + "%" : "—")}
      ${metric("Check-in posts", m.checkinPosts)}
      ${metric("Keywords tracked", m.keywordsTracked)}
    </tr></table>
    ${rows ? `<h3 style="margin:16px 0 6px">Keyword performance</h3>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left">Keyword</th>
        <th style="padding:6px 10px;border:1px solid #e5e7eb">Avg rank</th>
        <th style="padding:6px 10px;border:1px solid #e5e7eb">Share %</th></tr>${rows}</table>` : ""}
    ${changes ? `<h3 style="margin:16px 0 6px">What changed and why</h3><ul style="padding-left:18px">${changes}</ul>` : ""}
    ${audit}
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">Prepared by your SEO team · MapRanking.</p>
  </div>`;
}

export async function emailReport(
  tenantId: string,
  projectId: string,
  to: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const report = await composeMonthlyReport(tenantId, projectId);
  if (!report || !report.hasData) {
    return { ok: false, error: "No report data yet — sync the client and run a scan first." };
  }
  const result = await sendEmail({
    to,
    subject: `${report.businessName} — Monthly SEO Report (${report.period})`,
    html: renderReportHtml(report),
  });
  return { ok: true, id: result.id };
}
