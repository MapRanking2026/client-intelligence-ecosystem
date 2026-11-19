"use client";

import { ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";

import {
  EDIT_LIMITS,
  LAYOUT_CHOICES,
  TONES,
  bodyFieldFor,
  clientVisibilityWarnings,
  duplicateSlide,
  insertSlide,
  moveSlide,
  relayoutSlide,
  removeSlide,
  slideIsHiddenFromClient,
} from "@/src/lib/contracts/presentation-edit";
import type { PresentationLayout, PresentationSlide, PresentationTone } from "@/src/lib/mtos-data";

/**
 * Editing one slide of a generated deck, in place, while looking at it.
 *
 * The panel sits under the live slide and every keystroke redraws it, because the thing being
 * edited is a fixed 1280x720 canvas where a sentence three words too long pushes a line off the
 * slide. A separate "edit, then preview" step would hide exactly the problem the AM is editing to
 * fix. Nothing here writes anywhere: the viewer owns the working copy and the Save button.
 *
 * Two things on this panel are not conveniences.
 *
 * `clientVisibilityWarnings` reports what the client-visibility filter will strip from what the AM
 * just typed -- the filter runs on hand-typed text exactly as it runs on generated text, and
 * without the warning a line simply disappears between the editor and the call.
 *
 * "Revert" restores what the model wrote for this slide alone. An AM editing five minutes before a
 * call needs one way back that is not regenerating the deck.
 */

const TONE_LABEL: Record<PresentationTone, string> = {
  neutral: "Neutral",
  good: "Good",
  watch: "Watch",
  risk: "Risk",
};

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/** Up / down / remove, the three controls every repeatable row needs. */
function RowTools({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={index === 0}
        aria-label={`Move ${label} up`}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={index >= count - 1}
        aria-label={`Move ${label} down`}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${label}`} onClick={() => onRemove(index)}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** A list of plain lines: bullets, questions, the items inside one column. */
function LineEditor({
  lines,
  limit,
  label,
  placeholder,
  onChange,
}: {
  lines: string[];
  limit: number;
  label: string;
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const move = (from: number, to: number) => {
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return (
    <div className="grid gap-2">
      {lines.map((line, index) => (
        <Row key={index}>
          <textarea
            className="textarea flex-1"
            rows={2}
            maxLength={EDIT_LIMITS.bulletText}
            value={line}
            placeholder={placeholder}
            aria-label={`${label} ${index + 1}`}
            onChange={(event) => onChange(lines.map((value, position) => (position === index ? event.target.value : value)))}
          />
          <RowTools
            index={index}
            count={lines.length}
            label={`${label} ${index + 1}`}
            onMove={move}
            onRemove={(position) => onChange(lines.filter((_, at) => at !== position))}
          />
        </Row>
      ))}
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={lines.length >= limit}
          onClick={() => onChange([...lines, ""])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

export function PresentationEditor({
  slides,
  index,
  blockedTitles = [],
  onSlides,
  onIndex,
}: {
  slides: PresentationSlide[];
  index: number;
  /** Open commitments and undelivered promises: what the visibility filter also strips by name. */
  blockedTitles?: string[];
  onSlides: (next: PresentationSlide[]) => void;
  onIndex: (next: number) => void;
}) {
  const slide = slides[index];
  if (!slide) return null;

  const body = bodyFieldFor(slide.layout);
  const warnings = clientVisibilityWarnings(slide, blockedTitles);
  const hidden = slideIsHiddenFromClient(slide, blockedTitles);
  const snapshot = slide.generatedSnapshot;

  const patch = (changes: Partial<PresentationSlide>) =>
    onSlides(slides.map((value, position) => (position === index ? { ...value, ...changes } : value)));

  const moveRows = <T,>(rows: T[], from: number, to: number): T[] => {
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  return (
    <div className="presentation-editor-fields panel grid gap-4">
      {/* ---- This slide's place in the deck ------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="card-title">
          Editing slide {index + 1} of {slides.length}
          {slide.edited ? " · edited" : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={index === 0}
            onClick={() => {
              onSlides(moveSlide(slides, index, index - 1));
              onIndex(index - 1);
            }}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            Move earlier
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={index >= slides.length - 1}
            onClick={() => {
              onSlides(moveSlide(slides, index, index + 1));
              onIndex(index + 1);
            }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Move later
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={slides.length >= EDIT_LIMITS.slides}
            onClick={() => {
              onSlides(duplicateSlide(slides, index));
              onIndex(index + 1);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={slides.length >= EDIT_LIMITS.slides}
            onClick={() => {
              onSlides(insertSlide(slides, index + 1));
              onIndex(index + 1);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add slide after
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={slides.length <= 1}
            onClick={() => {
              onSlides(removeSlide(slides, index));
              onIndex(Math.max(index - 1, 0));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete slide
          </button>
          {snapshot ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                onSlides(
                  slides.map((value, position) =>
                    position === index
                      ? { ...snapshot, generatedIndex: value.generatedIndex, generatedSnapshot: snapshot, edited: false }
                      : value,
                  ),
                )
              }
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revert to generated
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- What the client will and will not see ----------------------------------------- */}
      {hidden ? (
        <p className="text-sm text-amber-200" role="status">
          The client sees nothing of this slide — it is dropped from the deck they are shown and from the .pptx.
          {warnings[0] ? ` ${warnings[0].detail}` : ""}
        </p>
      ) : warnings.length ? (
        <div className="grid gap-1" role="status">
          <p className="field-hint">Some of this will not reach the client:</p>
          {warnings.map((warning, position) => (
            <p key={position} className="text-xs text-amber-200">
              · {warning.detail}
            </p>
          ))}
        </div>
      ) : null}

      {/* ---- Layout and headings ------------------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field-label">
          Layout
          <select
            className="input"
            value={slide.layout}
            disabled={slide.layout === "rank_comparison"}
            onChange={(event) =>
              onSlides(
                slides.map((value, position) =>
                  position === index ? relayoutSlide(value, event.target.value as PresentationLayout) : value,
                ),
              )
            }
          >
            {LAYOUT_CHOICES.map((choice) => (
              <option key={choice.layout} value={choice.layout}>
                {choice.label}
              </option>
            ))}
            {slide.layout === "rank_comparison" ? <option value="rank_comparison">Rank comparison</option> : null}
          </select>
        </label>
        <label className="field-label">
          Section label
          <input
            className="input"
            maxLength={EDIT_LIMITS.section}
            value={slide.section || ""}
            placeholder="SECTION 03 · RANKINGS ON GOOGLE MAPS"
            onChange={(event) => patch({ section: event.target.value })}
          />
        </label>
      </div>

      <label className="field-label">
        Title
        <input
          className="input"
          maxLength={EDIT_LIMITS.title}
          value={slide.title || ""}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>

      <details className="rounded-lg border border-[var(--hair)] p-3">
        <summary className="cursor-pointer font-semibold">Advanced slide design</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="field-label">Font<select className="input" value={slide.design?.fontFamily || "Arial"} onChange={event => patch({ design: { ...slide.design, fontFamily: event.target.value as NonNullable<PresentationSlide["design"]>["fontFamily"] } })}>{["Arial", "Aptos", "Georgia", "Verdana"].map(font => <option key={font}>{font}</option>)}</select></label>
          <label className="field-label">Title size<input className="input" type="number" min={24} max={68} value={slide.design?.titleSize || (slide.layout === "cover" ? 52 : slide.layout === "closing" ? 46 : 34)} onChange={event => patch({ design: { ...slide.design, titleSize: Number(event.target.value) } })} /></label>
          <label className="field-label">Text scale<select className="input" value={slide.design?.textScale || 1} onChange={event => patch({ design: { ...slide.design, textScale: Number(event.target.value) } })}>{[0.75, 0.85, 1, 1.15, 1.25, 1.4].map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}</select></label>
          <label className="field-label">Alignment<select className="input" value={slide.design?.alignment || "left"} onChange={event => patch({ design: { ...slide.design, alignment: event.target.value as "left" | "center" | "right" } })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          {([["background", "Background", "#FFFFFF"], ["textColor", "Text color", "#0D1B2A"], ["accentColor", "Accent color", "#1A73E8"]] as const).map(([key, label, fallback]) => <label key={key} className="field-label">{label}<input aria-label={label} type="color" value={slide.design?.[key] || fallback} onChange={event => patch({ design: { ...slide.design, [key]: event.target.value } })} /></label>)}
          <label className="field-label">Title weight<select className="input" value={slide.design?.titleBold === false ? "normal" : "bold"} onChange={event => patch({ design: { ...slide.design, titleBold: event.target.value === "bold" } })}><option value="bold">Bold</option><option value="normal">Regular</option></select></label>
        </div>
        <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => patch({ design: undefined })}>Reset slide design</button>
        <p className="field-hint mt-2">Applies to this slide in the preview, client screen and PowerPoint. Original scan images stay unchanged.</p>
      </details>

      <label className="field-label">
        Subtitle
        <textarea
          className="textarea"
          rows={2}
          maxLength={EDIT_LIMITS.subtitle}
          value={slide.subtitle || ""}
          onChange={(event) => patch({ subtitle: event.target.value })}
        />
      </label>

      {/* ---- The body, whichever one this layout has ---------------------------------------- */}
      {body === "rank" ? (
        <p className="field-hint">
          The comparison image, its keyword and its scan dates come from the approved Rank Tracker capture and cannot be
          edited here. The title, subtitle, footnote and your notes can.
        </p>
      ) : null}

      {body === "bullets" ? (
        <div className="grid gap-2">
          <p className="field-label">Lines</p>
          <LineEditor
            lines={slide.bullets || []}
            limit={EDIT_LIMITS.bullets}
            label="Line"
            placeholder="One point, one line."
            onChange={(bullets) => patch({ bullets })}
          />
        </div>
      ) : null}

      {body === "stats" ? (
        <div className="grid gap-2">
          <p className="field-label">Figures</p>
          {(slide.stats || []).map((stat, position) => (
            <Row key={position}>
              <input
                className="input"
                style={{ maxWidth: 140 }}
                maxLength={EDIT_LIMITS.statValue}
                value={stat.value}
                placeholder="128"
                aria-label={`Figure ${position + 1} value`}
                onChange={(event) =>
                  patch({
                    stats: (slide.stats || []).map((value, at) =>
                      at === position ? { ...value, value: event.target.value } : value,
                    ),
                  })
                }
              />
              <input
                className="input flex-1"
                maxLength={EDIT_LIMITS.statCaption}
                value={stat.caption}
                placeholder="calls from the Google Business Profile"
                aria-label={`Figure ${position + 1} caption`}
                onChange={(event) =>
                  patch({
                    stats: (slide.stats || []).map((value, at) =>
                      at === position ? { ...value, caption: event.target.value } : value,
                    ),
                  })
                }
              />
              <select
                className="input"
                style={{ maxWidth: 120 }}
                value={stat.tone || "neutral"}
                aria-label={`Figure ${position + 1} colour`}
                onChange={(event) =>
                  patch({
                    stats: (slide.stats || []).map((value, at) =>
                      at === position ? { ...value, tone: event.target.value as PresentationTone } : value,
                    ),
                  })
                }
              >
                {TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABEL[tone]}
                  </option>
                ))}
              </select>
              <RowTools
                index={position}
                count={(slide.stats || []).length}
                label={`figure ${position + 1}`}
                onMove={(from, to) => patch({ stats: moveRows(slide.stats || [], from, to) })}
                onRemove={(at) => patch({ stats: (slide.stats || []).filter((_, value) => value !== at) })}
              />
            </Row>
          ))}
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={(slide.stats || []).length >= EDIT_LIMITS.stats}
              onClick={() => patch({ stats: [...(slide.stats || []), { value: "", caption: "" }] })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add figure
            </button>
          </div>
        </div>
      ) : null}

      {body === "columns" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(slide.columns || []).map((column, position) => (
            <div key={position} className="grid gap-2 rounded-lg border border-[color:var(--hair)] p-3">
              <Row>
                <input
                  className="input flex-1"
                  maxLength={EDIT_LIMITS.section}
                  value={column.heading}
                  placeholder="Column heading"
                  aria-label={`Column ${position + 1} heading`}
                  onChange={(event) =>
                    patch({
                      columns: (slide.columns || []).map((value, at) =>
                        at === position ? { ...value, heading: event.target.value } : value,
                      ),
                    })
                  }
                />
                <RowTools
                  index={position}
                  count={(slide.columns || []).length}
                  label={`column ${position + 1}`}
                  onMove={(from, to) => patch({ columns: moveRows(slide.columns || [], from, to) })}
                  onRemove={(at) => patch({ columns: (slide.columns || []).filter((_, value) => value !== at) })}
                />
              </Row>
              <LineEditor
                lines={column.items}
                limit={EDIT_LIMITS.columnItems}
                label="Item"
                placeholder="One point."
                onChange={(items) =>
                  patch({
                    columns: (slide.columns || []).map((value, at) => (at === position ? { ...value, items } : value)),
                  })
                }
              />
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={(slide.columns || []).length >= EDIT_LIMITS.columns}
              onClick={() => patch({ columns: [...(slide.columns || []), { heading: "", items: [""] }] })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add column
            </button>
          </div>
        </div>
      ) : null}

      {body === "table" && slide.table ? (
        <div className="grid gap-2">
          <p className="field-label">Table</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {slide.table.headers.map((header, column) => (
                    <th key={column} className="p-1 align-bottom">
                      <input
                        className="input"
                        maxLength={EDIT_LIMITS.cell}
                        value={header}
                        placeholder={`Column ${column + 1}`}
                        aria-label={`Header ${column + 1}`}
                        onChange={(event) =>
                          patch({
                            table: {
                              headers: slide.table!.headers.map((value, at) => (at === column ? event.target.value : value)),
                              rows: slide.table!.rows,
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm mt-1 w-full"
                        disabled={slide.table!.headers.length <= 1}
                        aria-label={`Remove column ${column + 1}`}
                        onClick={() =>
                          patch({
                            table: {
                              headers: slide.table!.headers.filter((_, at) => at !== column),
                              rows: slide.table!.rows.map((row) => row.filter((_, at) => at !== column)),
                            },
                          })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </th>
                  ))}
                  <th className="p-1 align-bottom">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={slide.table.headers.length >= EDIT_LIMITS.tableColumns}
                      onClick={() =>
                        patch({
                          table: {
                            headers: [...slide.table!.headers, ""],
                            rows: slide.table!.rows.map((row) => [...row, ""]),
                          },
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slide.table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {slide.table!.headers.map((_, column) => (
                      <td key={column} className="p-1">
                        <input
                          className="input"
                          maxLength={EDIT_LIMITS.cell}
                          value={row[column] || ""}
                          aria-label={`Row ${rowIndex + 1} column ${column + 1}`}
                          onChange={(event) =>
                            patch({
                              table: {
                                headers: slide.table!.headers,
                                rows: slide.table!.rows.map((values, at) =>
                                  at === rowIndex
                                    ? slide.table!.headers.map((__, cell) =>
                                        cell === column ? event.target.value : values[cell] || "",
                                      )
                                    : values,
                                ),
                              },
                            })
                          }
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <RowTools
                        index={rowIndex}
                        count={slide.table!.rows.length}
                        label={`row ${rowIndex + 1}`}
                        onMove={(from, to) =>
                          patch({ table: { headers: slide.table!.headers, rows: moveRows(slide.table!.rows, from, to) } })
                        }
                        onRemove={(at) =>
                          patch({
                            table: { headers: slide.table!.headers, rows: slide.table!.rows.filter((_, value) => value !== at) },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={slide.table.rows.length >= EDIT_LIMITS.tableRows}
              onClick={() =>
                patch({
                  table: {
                    headers: slide.table!.headers,
                    rows: [...slide.table!.rows, slide.table!.headers.map(() => "")],
                  },
                })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add row
            </button>
          </div>
        </div>
      ) : null}

      {body === "items" ? (
        <div className="grid gap-2">
          <p className="field-label">Items</p>
          {(slide.items || []).map((item, position) => (
            <div key={position} className="grid gap-2 rounded-lg border border-[color:var(--hair)] p-3">
              <Row>
                <input
                  className="input flex-1"
                  maxLength={EDIT_LIMITS.itemText}
                  value={item.label}
                  placeholder="What was done"
                  aria-label={`Item ${position + 1}`}
                  onChange={(event) =>
                    patch({
                      items: (slide.items || []).map((value, at) =>
                        at === position ? { ...value, label: event.target.value } : value,
                      ),
                    })
                  }
                />
                <RowTools
                  index={position}
                  count={(slide.items || []).length}
                  label={`item ${position + 1}`}
                  onMove={(from, to) => patch({ items: moveRows(slide.items || [], from, to) })}
                  onRemove={(at) => patch({ items: (slide.items || []).filter((_, value) => value !== at) })}
                />
              </Row>
              <Row>
                <input
                  className="input flex-1"
                  maxLength={EDIT_LIMITS.itemText}
                  value={item.detail || ""}
                  placeholder="Detail line (optional)"
                  aria-label={`Item ${position + 1} detail`}
                  onChange={(event) =>
                    patch({
                      items: (slide.items || []).map((value, at) =>
                        at === position ? { ...value, detail: event.target.value } : value,
                      ),
                    })
                  }
                />
                <input
                  className="input"
                  style={{ maxWidth: 160 }}
                  maxLength={40}
                  value={item.status || ""}
                  placeholder="COMPLETED"
                  aria-label={`Item ${position + 1} chip`}
                  onChange={(event) =>
                    patch({
                      items: (slide.items || []).map((value, at) =>
                        at === position ? { ...value, status: event.target.value } : value,
                      ),
                    })
                  }
                />
                <select
                  className="input"
                  style={{ maxWidth: 120 }}
                  value={item.tone || "neutral"}
                  aria-label={`Item ${position + 1} colour`}
                  onChange={(event) =>
                    patch({
                      items: (slide.items || []).map((value, at) =>
                        at === position ? { ...value, tone: event.target.value as PresentationTone } : value,
                      ),
                    })
                  }
                >
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {TONE_LABEL[tone]}
                    </option>
                  ))}
                </select>
              </Row>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={(slide.items || []).length >= EDIT_LIMITS.items}
              onClick={() => patch({ items: [...(slide.items || []), { label: "" }] })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          </div>
          {slide.layout === "status_list" ? (
            <p className="field-hint">
              A status list shows the client only items whose chip says completed, done, finished, delivered or shipped.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---- Footnote and the AM's own notes ------------------------------------------------ */}
      <label className="field-label">
        Footnote
        <input
          className="input"
          maxLength={EDIT_LIMITS.footnote}
          value={slide.footnote || ""}
          placeholder="Source and period for any number on this slide."
          onChange={(event) => patch({ footnote: event.target.value })}
        />
      </label>

      <label className="field-label">
        Presenter notes — only you see these
        <textarea
          className="textarea"
          rows={4}
          maxLength={EDIT_LIMITS.presenterNotes}
          value={slide.presenterNotes || ""}
          onChange={(event) => patch({ presenterNotes: event.target.value })}
        />
      </label>

      <label className="field-label">
        Spoken script — the words you say on this slide
        <textarea
          className="textarea"
          rows={5}
          maxLength={EDIT_LIMITS.presenterScript}
          value={slide.presenterScript || ""}
          placeholder="Written by “Write the scripts” on the live call screen, and editable here."
          onChange={(event) => patch({ presenterScript: event.target.value })}
        />
        <span className="field-hint">
          Read aloud as written. Say what the figure means for this client&apos;s business, not what it is called.
        </span>
      </label>
    </div>
  );
}
