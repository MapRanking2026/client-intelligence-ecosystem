import type { PresentationSlide, PresentationTone } from "@/src/lib/mtos-data";

/**
 * One slide, drawn at the deck's true size and then scaled by the caller.
 *
 * Everything here is in fixed pixels against a 1280x720 canvas, which is the
 * 13.33x7.5in 16:9 of both approved reference decks. Fixed rather than responsive
 * on purpose: a slide must look identical in the thumbnail strip, in the editor,
 * full screen on a video call, and in the exported .pptx, and the only way to get
 * that is one coordinate system that everything scales.
 *
 * Colours are the Map Ranking deck theme, read out of the reference decks'
 * theme1.xml rather than guessed. They are deliberately NOT the MTOS app tokens:
 * this surface is the client's deck, not app chrome, and it stays white in both
 * app themes because that is what gets screen-shared and exported.
 */

export const DECK = {
  width: 1280,
  height: 720,
  navy: "#0D1B2A",
  deepBlue: "#0D47A1",
  blue: "#1A73E8",
  brightBlue: "#2979FF",
  paleBlue: "#E8F0FD",
  border: "#C8D8F0",
  gray: "#444444",
  good: "#2E7D32",
  watch: "#F29C00",
  risk: "#B71C1C",
  coverTint: "#7EB8FF",
  coverTintSoft: "#A0C4FF",
  font: "Arial, Helvetica, sans-serif",
} as const;

function toneColor(tone?: PresentationTone): string {
  if (tone === "good") return DECK.good;
  if (tone === "watch") return DECK.watch;
  if (tone === "risk") return DECK.risk;
  return DECK.blue;
}

function Chrome({ slide, children }: { slide: PresentationSlide; children: React.ReactNode }) {
  return (
    <>
      {/* Accent rule along the top, the reference decks' running device. */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: DECK.blue }} />

      <div style={{ position: "absolute", top: 46, left: 64, right: 64 }}>
        {slide.section ? (
          <div
            style={{
              fontSize: 13,
              letterSpacing: 1.6,
              fontWeight: 700,
              color: DECK.blue,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {slide.section}
          </div>
        ) : null}
        <h2 style={{ fontSize: 34, lineHeight: 1.2, fontWeight: 700, color: DECK.navy, margin: 0 }}>
          {slide.title}
        </h2>
        {slide.subtitle ? (
          <p style={{ fontSize: 18, lineHeight: 1.4, color: DECK.gray, margin: "10px 0 0" }}>
            {slide.subtitle}
          </p>
        ) : null}
      </div>

      <div style={{ position: "absolute", top: slide.subtitle ? 210 : 170, left: 64, right: 64, bottom: 72 }}>
        {children}
      </div>

      {slide.footnote ? (
        <div style={{ position: "absolute", left: 64, right: 64, bottom: 30, fontSize: 13, color: DECK.gray }}>
          {slide.footnote}
        </div>
      ) : null}
    </>
  );
}

function Bullets({ items, size = 22 }: { items: string[]; size?: number }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 16 }}>
      {items.map((item, index) => (
        <li key={index} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <span
            style={{
              marginTop: size * 0.42,
              width: 8,
              height: 8,
              borderRadius: 8,
              background: DECK.blue,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: size, lineHeight: 1.45, color: DECK.navy }}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PresentationSlideCanvas({
  slide,
  deckTitle,
  clientName,
  periodLabel,
  preparedFor,
  preparedBy,
  slideNumber,
  slideCount,
  logoSrc = "/brand/mapranking-mark.png",
}: {
  slide: PresentationSlide;
  deckTitle?: string;
  clientName?: string;
  periodLabel?: string;
  preparedFor?: string;
  preparedBy?: string;
  slideNumber: number;
  slideCount: number;
  logoSrc?: string;
}) {
  const base: React.CSSProperties = {
    position: "relative",
    width: DECK.width,
    height: DECK.height,
    background: "#FFFFFF",
    fontFamily: DECK.font,
    overflow: "hidden",
    color: DECK.navy,
  };

  // Cover and closing share the branded title treatment.
  if (slide.layout === "cover" || slide.layout === "closing") {
    const isCover = slide.layout === "cover";
    return (
      <div style={base}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, background: DECK.blue }} />
        {/* Soft geometric tint, echoing the reference covers. */}
        <div
          style={{
            position: "absolute",
            right: -120,
            bottom: -140,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: DECK.coverTintSoft,
            opacity: 0.35,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 60,
            top: -100,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: DECK.coverTint,
            opacity: 0.25,
          }}
        />

        <div style={{ position: "absolute", left: 72, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size deck asset, not a responsive page image */}
          <img src={logoSrc} alt="" width={54} height={62} style={{ display: "block" }} />
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 0.4, color: DECK.navy }}>MapRanking</span>
        </div>

        <div style={{ position: "absolute", left: 72, top: 230, right: 420 }}>
          {slide.section ? (
            <div
              style={{
                fontSize: 14,
                letterSpacing: 2,
                fontWeight: 700,
                color: DECK.blue,
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              {slide.section}
            </div>
          ) : null}
          <h1 style={{ fontSize: isCover ? 52 : 46, lineHeight: 1.12, fontWeight: 700, margin: 0, color: DECK.navy }}>
            {slide.title}
          </h1>
          {slide.subtitle ? (
            <p style={{ fontSize: 22, lineHeight: 1.4, color: DECK.gray, margin: "18px 0 0" }}>{slide.subtitle}</p>
          ) : null}
          {slide.bullets?.length ? (
            <div style={{ marginTop: 28 }}>
              <Bullets items={slide.bullets} size={20} />
            </div>
          ) : null}
        </div>

        {isCover ? (
          <div style={{ position: "absolute", left: 72, bottom: 64, display: "flex", gap: 56 }}>
            {clientName ? <CoverField label="Client" value={clientName} /> : null}
            {periodLabel ? <CoverField label="Period" value={periodLabel} /> : null}
            {preparedFor ? <CoverField label="Prepared for" value={preparedFor} /> : null}
            {preparedBy ? <CoverField label="Prepared by" value={preparedBy} /> : null}
          </div>
        ) : null}

        {!isCover && deckTitle ? (
          <div style={{ position: "absolute", left: 72, bottom: 64, fontSize: 16, color: DECK.gray }}>
            {deckTitle}
            {periodLabel ? ` · ${periodLabel}` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={base}>
      <Chrome slide={slide}>
        {slide.layout === "stat_callouts" && slide.stats?.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(slide.stats.length, 4)}, 1fr)`,
              gap: 28,
              alignContent: "start",
            }}
          >
            {slide.stats.map((stat, index) => (
              <div
                key={index}
                style={{
                  border: `2px solid ${DECK.border}`,
                  borderRadius: 14,
                  padding: "26px 22px",
                  background: DECK.paleBlue,
                }}
              >
                <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.05, color: toneColor(stat.tone) }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 17, lineHeight: 1.4, color: DECK.navy, marginTop: 12 }}>{stat.caption}</div>
              </div>
            ))}
          </div>
        ) : null}

        {(slide.layout === "bullets" || slide.layout === "agenda") && slide.bullets?.length ? (
          slide.layout === "agenda" ? (
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 18 }}>
              {slide.bullets.map((item, index) => (
                <li key={index} style={{ display: "flex", gap: 18, alignItems: "center" }}>
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 40,
                      background: DECK.blue,
                      color: "#fff",
                      fontSize: 19,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ fontSize: 23, lineHeight: 1.4, color: DECK.navy }}>{item}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Bullets items={slide.bullets} />
          )
        ) : null}

        {slide.layout === "questions" && slide.bullets?.length ? (
          <div style={{ display: "grid", gap: 16 }}>
            {slide.bullets.map((item, index) => (
              <div
                key={index}
                style={{
                  borderLeft: `5px solid ${DECK.brightBlue}`,
                  background: DECK.paleBlue,
                  borderRadius: "0 12px 12px 0",
                  padding: "16px 22px",
                  fontSize: 21,
                  lineHeight: 1.4,
                  color: DECK.navy,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        ) : null}

        {slide.layout === "two_column" && slide.columns?.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36 }}>
            {slide.columns.map((column, index) => (
              <div key={index}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    color: DECK.blue,
                    paddingBottom: 10,
                    borderBottom: `2px solid ${DECK.border}`,
                    marginBottom: 18,
                  }}
                >
                  {column.heading}
                </div>
                <Bullets items={column.items} size={19} />
              </div>
            ))}
          </div>
        ) : null}

        {slide.layout === "table" && slide.table ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 18 }}>
            <thead>
              <tr>
                {slide.table.headers.map((header, index) => (
                  <th
                    key={index}
                    style={{
                      textAlign: index === 0 ? "left" : "right",
                      padding: "12px 14px",
                      background: DECK.navy,
                      color: "#fff",
                      fontSize: 15,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} style={{ background: rowIndex % 2 ? DECK.paleBlue : "#fff" }}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{
                        textAlign: cellIndex === 0 ? "left" : "right",
                        padding: "12px 14px",
                        borderBottom: `1px solid ${DECK.border}`,
                        color: DECK.navy,
                        fontWeight: cellIndex === 0 ? 600 : 400,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {slide.layout === "status_list" && slide.items?.length ? (
          <div style={{ display: "grid", gap: 14 }}>
            {slide.items.map((item, index) => (
              <div
                key={index}
                style={{
                  border: `2px solid ${DECK.border}`,
                  borderRadius: 12,
                  padding: "16px 20px",
                  display: "flex",
                  gap: 18,
                  alignItems: "flex-start",
                }}
              >
                {item.status ? (
                  <span
                    style={{
                      flexShrink: 0,
                      background: toneColor(item.tone),
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 1,
                      padding: "6px 12px",
                      borderRadius: 999,
                      textTransform: "uppercase",
                      marginTop: 2,
                    }}
                  >
                    {item.status}
                  </span>
                ) : null}
                <div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: DECK.navy, lineHeight: 1.35 }}>{item.label}</div>
                  {item.detail ? (
                    <div style={{ fontSize: 17, color: DECK.gray, lineHeight: 1.45, marginTop: 6 }}>{item.detail}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {slide.layout === "timeline" && slide.items?.length ? (
          <div style={{ display: "grid", gap: 0 }}>
            {slide.items.map((item, index) => (
              <div key={index} style={{ display: "flex", gap: 22 }}>
                <div style={{ width: 150, flexShrink: 0, textAlign: "right", paddingTop: 2 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: DECK.blue }}>{item.label}</span>
                </div>
                <div style={{ position: "relative", width: 24, flexShrink: 0 }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 9,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: index === (slide.items?.length ?? 0) - 1 ? "transparent" : DECK.border,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 4,
                      top: 6,
                      width: 12,
                      height: 12,
                      borderRadius: 12,
                      background: DECK.blue,
                    }}
                  />
                </div>
                <div style={{ paddingBottom: 22 }}>
                  <div style={{ fontSize: 19, lineHeight: 1.45, color: DECK.navy }}>{item.detail || item.label}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Chrome>

      {/* Footer: brand mark and slide number, as both reference decks carry. */}
      <div
        style={{
          position: "absolute",
          right: 64,
          bottom: 28,
          fontSize: 13,
          color: DECK.gray,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span>MapRanking</span>
        <span style={{ color: DECK.border }}>|</span>
        <span>
          {slideNumber} / {slideCount}
        </span>
      </div>
    </div>
  );
}

function CoverField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          letterSpacing: 1.6,
          fontWeight: 700,
          textTransform: "uppercase",
          color: DECK.blue,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, color: DECK.navy, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
