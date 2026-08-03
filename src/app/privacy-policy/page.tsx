import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — MTOS (Monthly Touch OS)",
  description:
    "How Map Ranking's Monthly Touch OS (MTOS) collects, uses, shares, retains, and protects data, including data obtained through connected platforms such as Meta, Google, GoHighLevel, and ClickUp.",
};

// Static, publicly accessible page — required by Meta / Google app review.
export const dynamic = "force-static";

const COMPANY = "Map Ranking";
const APP = "Monthly Touch OS (“MTOS”)";
const CONTACT_EMAIL = "francisco@mapranking.com";
const SITE = "https://mtos.mapranking.com";
const EFFECTIVE_DATE = "August 2, 2026";

const linkClass = "text-[#8fe8cd] underline decoration-[#8fe8cd]/40 underline-offset-2 transition hover:text-white";

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5 md:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-300">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#223554_0%,#08111e_34%,#050a12_100%)] text-slate-100">
      <div className="mx-auto max-w-3xl px-5 py-8 md:py-12">
        <main className="space-y-6 rounded-[36px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,23,0.88),rgba(6,10,18,0.94))] p-5 shadow-[0_60px_140px_rgba(3,6,14,0.5)] md:p-8">
          <header className="rounded-[28px] border border-white/8 bg-white/5 p-6 md:p-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              {COMPANY} · Monthly Touch OS
            </p>
            <h1 className="mt-2 font-serif text-3xl tracking-tight text-white md:text-4xl">Privacy Policy</h1>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">
              Effective {EFFECTIVE_DATE} · Last updated {EFFECTIVE_DATE}
            </p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
              <p>
                This Privacy Policy explains how {COMPANY} (&ldquo;{COMPANY},&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo;
                or &ldquo;our&rdquo;) collects, uses, shares, retains, and protects information in connection with{" "}
                {APP}, our internal software for preparing and running client account-management workflows
                (&ldquo;monthly touches&rdquo;), available at {SITE} (the &ldquo;Service&rdquo;).
              </p>
              <p>
                MTOS is a business tool used by {COMPANY}&rsquo;s team to manage marketing services for{" "}
                {COMPANY}&rsquo;s business clients. It is not a consumer-facing product and is not directed to the
                general public. By accessing or using the Service, or by connecting a third-party account to it, you
                acknowledge the practices described in this Policy.
              </p>
            </div>
          </header>

          <Section eyebrow="Scope" title="1. Who this Policy covers">
            <p>This Policy applies to:</p>
            <ul className="list-disc space-y-1 pl-6 marker:text-slate-500">
              <li>
                <strong className="text-slate-100">Authorized users</strong> — {COMPANY} team members who log in to and
                operate the Service.
              </li>
              <li>
                <strong className="text-slate-100">Connected accounts</strong> — the third-party platform accounts
                (e.g., advertising, CRM, analytics, and productivity tools) that an authorized user connects to the
                Service.
              </li>
              <li>
                <strong className="text-slate-100">Client and lead data</strong> — business and contact information
                about {COMPANY}&rsquo;s clients and the leads, calls, and inquiries those clients receive, which we
                process on our clients&rsquo; behalf.
              </li>
            </ul>
          </Section>

          <Section eyebrow="Collection" title="2. Information we collect">
            <p>
              <strong className="text-slate-100">Account and login information.</strong> Names, email addresses, role,
              and authentication data for the team members who use the Service.
            </p>
            <p>
              <strong className="text-slate-100">Client business data.</strong> Business names, contacts, notes,
              commitments, opportunities, meeting context, and performance information relating to the clients we serve.
            </p>
            <p>
              <strong className="text-slate-100">Leads, calls, and communications.</strong> Lead and contact records,
              form submissions, phone-call metadata (such as caller number, direction, duration, and status), and, where
              available from a connected phone system, <strong className="text-slate-100">call recordings</strong>. Some
              of this data may be uploaded or pasted manually by an authorized user for verification.
            </p>
            <p>
              <strong className="text-slate-100">Data from connected platforms.</strong> When an authorized user
              connects a third-party account (via OAuth or an API credential), we access data from that platform as
              needed to operate the Service. Depending on what is connected, this may include:
            </p>
            <ul className="list-disc space-y-1 pl-6 marker:text-slate-500">
              <li>
                <strong className="text-slate-100">Meta / Facebook (Meta Ads):</strong> advertising accounts,
                campaigns, ad performance and conversion metrics, and lead information generated through Meta
                advertising.
              </li>
              <li>
                <strong className="text-slate-100">Google:</strong> Google Ads performance, Google Analytics engagement
                and conversion metrics, Google Business Profile insights and calls, Google Search Console data, and —
                where connected — Google Calendar events, Gmail messages, Google Meet details, and Google Drive files
                used for preparation and follow-up.
              </li>
              <li>
                <strong className="text-slate-100">GoHighLevel:</strong> contacts, opportunities, conversations, calls,
                and call recordings.
              </li>
              <li>
                <strong className="text-slate-100">ClickUp:</strong> tasks, documents/wiki content, and project chat
                used for client context.
              </li>
            </ul>
            <p>
              <strong className="text-slate-100">Usage and technical data.</strong> Session cookies used to keep you
              signed in, plus standard server logs (such as timestamps and error diagnostics) generated when the Service
              runs.
            </p>
          </Section>

          <Section eyebrow="Use" title="3. How we use information">
            <p>We use the information above to:</p>
            <ul className="list-disc space-y-1 pl-6 marker:text-slate-500">
              <li>Operate, secure, and maintain the Service.</li>
              <li>
                Prepare client account-management materials, verify and reconcile the leads and calls a client received,
                and measure marketing performance across connected channels.
              </li>
              <li>
                Generate summaries, recommendations, and briefs using automated processing and artificial intelligence
                (see &ldquo;Automated processing and AI&rdquo; below).
              </li>
              <li>Authenticate users, prevent abuse, and troubleshoot problems.</li>
              <li>Comply with legal obligations and the terms of the platforms we connect to.</li>
            </ul>
            <p>
              We do <strong className="text-slate-100">not</strong> sell personal information, and we do not use data
              obtained from connected platforms for advertising to third parties or for any purpose other than providing
              the Service.
            </p>
          </Section>

          <Section eyebrow="AI" title="4. Automated processing and AI">
            <p>
              To generate briefs, summaries, lead/call assessments, and recommendations, the Service may send relevant
              content to third-party artificial-intelligence providers that process it on our behalf, including
              Anthropic (Claude), OpenAI, and Google (Gemini). These providers process the content solely to return a
              result to the Service and under their applicable enterprise/API terms. Automated assessments are
              decision-support only; a {COMPANY} team member remains responsible for any resulting action.
            </p>
          </Section>

          <Section eyebrow="Sharing" title="5. How we share information">
            <p>We share information only as needed to run the Service:</p>
            <ul className="list-disc space-y-1 pl-6 marker:text-slate-500">
              <li>
                <strong className="text-slate-100">Service providers / sub-processors:</strong> hosting and application
                infrastructure (Vercel), database and authentication (Google Firebase / Cloud Firestore), and the AI
                providers listed above. These providers may process data only to provide services to us.
              </li>
              <li>
                <strong className="text-slate-100">Connected platforms:</strong> when you use the Service to act on a
                connected account, data is exchanged with that platform (e.g., writing a task to ClickUp).
              </li>
              <li>
                <strong className="text-slate-100">Legal and safety:</strong> when required by law, or to protect the
                rights, safety, and security of {COMPANY}, our clients, or others.
              </li>
              <li>
                <strong className="text-slate-100">Business transfers:</strong> in connection with a merger,
                acquisition, or sale of assets, subject to this Policy.
              </li>
            </ul>
            <p>We do not sell or rent personal information, and we do not share it with data brokers.</p>
          </Section>

          <Section eyebrow="Meta" title="6. Meta / Facebook Platform data">
            <p>
              Where the Service accesses data through Meta&rsquo;s platforms (including the Meta Marketing / Ads APIs),
              we handle that data in accordance with the{" "}
              <a href="https://developers.facebook.com/terms/" className={linkClass} target="_blank" rel="noreferrer">
                Meta Platform Terms
              </a>{" "}
              and applicable Meta Developer Policies. We use Meta data only to display advertising performance and to
              verify and reconcile leads within the Service. We do not transfer Meta data to data brokers, use it for
              unauthorized advertising, or use it for any purpose Meta does not permit. You may disconnect a Meta
              account at any time, and you may request deletion of Meta-sourced data as described below.
            </p>
          </Section>

          <Section eyebrow="Google" title="7. Google API data (Limited Use)">
            <p>
              The Service&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className={linkClass}
                target="_blank"
                rel="noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We use Google user data only to provide and improve user-facing
              features within the Service, do not transfer it except as necessary to provide those features (or for
              security, legal, or as part of a business transfer with consent), do not use it for advertising, and do not
              allow humans to read it except with your consent, for security, to comply with law, or where the data is
              aggregated and anonymized.
            </p>
          </Section>

          <Section eyebrow="Retention" title="8. Data retention">
            <p>
              We retain information for as long as needed to provide the Service and for legitimate business or legal
              purposes. Cached data pulled from connected platforms (for example, recent leads and call metadata) is
              kept for a limited operating window and is refreshed or superseded on subsequent syncs. Call recordings
              are not stored by the Service; they are streamed on demand from the connected phone system when a user
              chooses to play them. When information is no longer needed, we delete or de-identify it.
            </p>
          </Section>

          <Section eyebrow="Security" title="9. Security">
            <p>
              We use administrative, technical, and organizational safeguards designed to protect information, including
              access controls, encryption of connection credentials at rest, authenticated sessions, and transmission
              over HTTPS. No method of transmission or storage is completely secure, and we cannot guarantee absolute
              security.
            </p>
          </Section>

          <Section eyebrow="Your rights" title="10. Your rights and choices">
            <p>
              Depending on your location, you may have rights to access, correct, delete, or restrict the processing of
              personal information, or to object or withdraw consent. To exercise a right, or to ask a question about
              this Policy, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
                {CONTACT_EMAIL}
              </a>
              . Authorized users may disconnect any connected platform at any time from the Service&rsquo;s Integrations
              settings, which stops further data access from that platform.
            </p>
          </Section>

          <Section eyebrow="Deletion" title="11. Data deletion requests">
            <p>
              To request deletion of data associated with a connected account or with your organization, email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
                {CONTACT_EMAIL}
              </a>{" "}
              with the account or platform in question. Upon a verified request, we will delete the relevant data from
              our systems (including cached platform data) and confirm completion, except where we are required to
              retain it for legal or security reasons. Disconnecting a platform in the Integrations settings removes its
              stored connection credentials and stops future syncs.
            </p>
          </Section>

          <Section eyebrow="Transfers" title="12. International data transfers">
            <p>
              We and our service providers may process and store information in the United States and other countries.
              Where required, we take steps to ensure appropriate protection for international transfers of personal
              information.
            </p>
          </Section>

          <Section eyebrow="Children" title="13. Children&rsquo;s privacy">
            <p>
              The Service is a business tool intended for use by authorized adults and is not directed to children. We
              do not knowingly collect personal information from children.
            </p>
          </Section>

          <Section eyebrow="Cookies" title="14. Cookies">
            <p>
              The Service uses a strictly necessary session cookie to keep authorized users signed in. It does not use
              advertising or cross-site tracking cookies.
            </p>
          </Section>

          <Section eyebrow="Changes" title="15. Changes to this Policy">
            <p>
              We may update this Policy from time to time. When we do, we will revise the &ldquo;Last updated&rdquo;
              date above and, where appropriate, provide additional notice. Continued use of the Service after an update
              constitutes acceptance of the revised Policy.
            </p>
          </Section>

          <Section eyebrow="Contact" title="16. Contact us">
            <p>If you have questions or requests regarding this Policy or your information, contact:</p>
            <p className="text-slate-200">
              {COMPANY}
              <br />
              Attn: Privacy
              <br />
              <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
                {CONTACT_EMAIL}
              </a>
              <br />
              {SITE}
            </p>
          </Section>

          <p className="px-1 pt-2 text-xs text-slate-500">
            &copy; {COMPANY}. This Privacy Policy applies to {APP}.
          </p>
        </main>
      </div>
    </div>
  );
}
