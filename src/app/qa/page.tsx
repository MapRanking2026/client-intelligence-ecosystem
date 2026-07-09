import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { ScorePill } from "@/src/components/mtos/score-pill";

export default function QaPage() {
  const qaDimensions = [
    "Meeting Preparation",
    "Wins Delivered",
    "Performance Translation",
    "SEO Strategy Review",
    "Google Ads Review",
    "Meta Ads Review",
    "Issues & Risk Management",
    "Strategic Recommendations",
    "Value Communication",
    "Objection Handling",
    "Michelin Communication Standard",
    "Client Sentiment",
    "Testimonial Opportunity",
    "30-Day Strategic Plan",
    "Live Meeting Recap",
    "Operational Hygiene",
  ];

  const workflowStages = [
    {
      title: "Evidence intake",
      description: "Pull transcript, prep pack, coverage checklist, and post-call outputs into one review packet before scoring starts.",
    },
    {
      title: "Dimension scoring",
      description: "Run the QA evaluation prompt against the full MTOS rubric and keep every score grounded in evidence.",
    },
    {
      title: "Coaching output",
      description: "Turn the lowest-friction coaching moves into next-meeting behaviors and implementation intentions.",
    },
    {
      title: "Leadership rollup",
      description: "Summarize recurring wins, misses, and retention signals for leadership visibility.",
    },
  ];

  const promptConnections = [
    "QA Evaluation → scores each dimension and coverage item with evidence",
    "Coaching Feedback → converts the score into AM-specific coaching",
    "Executive Summary → rolls up retention and coaching themes",
    "Prompt Self-Improvement → flags prompt modules that drive repeated human edits",
  ];

  return (
    <AppShell
      title="Quality And Coaching"
      subtitle="QA in MTOS exists to improve future meetings through evidence-backed review, coaching, and calibration."
    >
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard
          eyebrow="Quality queue"
          title="MTOS review flow"
          subtitle="This page is structured to match the prompt engine so the same evaluation logic can drive QA, coaching, and leadership rollups."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {workflowStages.map((item, index) => (
              <article key={item.title} className="rounded-[24px] border border-white/8 bg-white/4 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="rounded-full border border-white/10 bg-white px-3 py-1 text-xs font-semibold text-[#223554]">
                    Stage {index + 1}
                  </span>
                  <ScorePill label="Status" value={index === 0 ? "Ready" : "Planned"} tone={index === 0 ? "positive" : "warning"} />
                </div>
                <h3 className="text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Prompt alignment"
          title="Connected to the prompt engine"
          subtitle="QA and coaching are intentionally tied to the same workflow prompts that drive preparation and follow-through."
        >
          <div className="space-y-3">
            {promptConnections.map((item) => (
              <div key={item} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Rubric"
        title="QA dimensions ready for full Monthly Touch runs"
        subtitle="The scoring surface now reflects the dimensions defined in the MTOS prompt library, so the next slice can attach actual evaluation outputs to each row."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {qaDimensions.map((item) => (
            <div key={item} className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-sm font-semibold text-white">{item}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">Ready to receive prompt-driven evidence, score, explanation, and coaching follow-up.</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
