"use client";

import { useCallback, useRef } from "react";

/**
 * A text field you can format.
 *
 * Anywhere MTOS takes words that end up in front of a client, the AM should be able to make a
 * line bold, italicise a caveat or number a list -- a signature where the name cannot be bold is
 * a signature people paste in from somewhere else.
 *
 * The body is a `contentEditable` written in once by ref rather than rendered from state: setting
 * `innerHTML` from a value that changes on every keystroke puts the caret back at the start of
 * the document, which makes the field unusable for anything longer than a word. `value` is
 * therefore the *initial* content and the value this field reports back, not a prop it re-reads
 * while you type; `resetKey` is how a caller replaces the content deliberately.
 *
 * What comes out is HTML, so every consumer has to treat it as HTML -- `sanitizeAgendaEmailHtml`
 * on the way into storage and into an email body.
 */

const TOOLBAR = [
  { command: "bold", label: "B", title: "Bold" },
  { command: "italic", label: "I", title: "Italic" },
  { command: "underline", label: "U", title: "Underline" },
  { command: "insertUnorderedList", label: "•", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1.", title: "Numbered list" },
  { command: "removeFormat", label: "⌫", title: "Clear formatting" },
  { command: "undo", label: "↶", title: "Undo" },
  { command: "redo", label: "↷", title: "Redo" },
];

export function RichTextField({
  id,
  value,
  onChange,
  ariaLabel,
  disabled,
  minHeight = 120,
  resetKey,
}: {
  id?: string;
  value: string;
  onChange: (html: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  minHeight?: number;
  /** Change this to load different content into the field; it is not re-read while typing. */
  resetKey?: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Plain text that was saved before this field existed arrives with newlines and no markup, so
  // it is turned into breaks on the way in -- otherwise a three-line signature loads as one line.
  const initial = /<[a-z][^>]*>/i.test(value)
    ? value
    : value
        .split("\n")
        .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
        .join("<br>");

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      if (node && node.dataset.loaded !== (resetKey || "1")) {
        node.innerHTML = initial;
        node.dataset.loaded = resetKey || "1";
      }
    },
    [initial, resetKey],
  );

  return (
    <div className="grid gap-1">
      {disabled ? null : (
        <div className="flex flex-wrap gap-1">
          {TOOLBAR.map((button) => (
            <button
              key={button.command}
              type="button"
              className="icon-btn"
              title={button.title}
              aria-label={button.title}
              // Keeps the selection: the field loses focus on mousedown otherwise, and the
              // command then has nothing to apply itself to.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                document.execCommand(button.command);
                if (bodyRef.current) onChange(bodyRef.current.innerHTML);
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
      <div
        id={id}
        ref={attach}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={() => {
          if (bodyRef.current) onChange(bodyRef.current.innerHTML);
        }}
        className="textarea"
        style={{ minHeight, overflowWrap: "anywhere" }}
      />
    </div>
  );
}
