import { SOURCE_ICON, SOURCE_LABEL, type SourceChip } from "@/src/lib/contracts/brief-sources";

/**
 * The "how we know" chip under a line of the brief.
 *
 * Rendered with `<img>` rather than inlined, so a logo file -- which arrives as an SVG from a
 * design bundle -- is a picture and can never be anything else.
 *
 * A chip with no link is still worth drawing: naming the system a number came out of is the
 * difference between a number the AM can defend on the call and one they have to hedge.
 */
export function SourceChips({ chips, className }: { chips?: SourceChip[]; className?: string }) {
  if (!chips?.length) return null;
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-1.5 ${className || ""}`}>
      {chips.map((chip, index) => (
        <Chip key={`${chip.kind}-${chip.label}-${index}`} chip={chip} />
      ))}
    </div>
  );
}

function Chip({ chip }: { chip: SourceChip }) {
  const icon = SOURCE_ICON[chip.kind];
  const body = (
    <>
      {icon ? (
        // A 14px logo from /public: the image optimizer would add a request and a cache entry per
        // chip for no gain at this size, and there are a dozen chips on a section.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" width={14} height={14} style={{ display: "block", borderRadius: 3 }} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: "var(--surface-3)",
            color: "var(--slate-300)",
            fontSize: "0.56rem",
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {SOURCE_LABEL[chip.kind].slice(0, 1)}
        </span>
      )}
      <span>{chip.label}</span>
    </>
  );

  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: "0.7rem",
    fontWeight: 600,
    border: "1px solid var(--hair)",
    background: "var(--surface-2)",
    color: "var(--slate-300)",
    maxWidth: "100%",
  } as const;

  if (!chip.url) {
    return (
      <span style={style} title={`${SOURCE_LABEL[chip.kind]} — no page to open`}>
        {body}
      </span>
    );
  }
  return (
    <a
      href={chip.url}
      target="_blank"
      rel="noreferrer"
      style={style}
      title={`Open in ${SOURCE_LABEL[chip.kind]}`}
    >
      {body}
    </a>
  );
}
