"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeRecapEmailHtml } from "@/src/lib/contracts/follow-through-recap-email";
import "./recap-rich-editor.css";

const commands = [
  ["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"],
  ["insertUnorderedList", "• List", "Bulleted list"], ["insertOrderedList", "1. List", "Numbered list"],
  ["outdent", "←", "Decrease indent"], ["indent", "→", "Increase indent"],
  ["justifyLeft", "Left", "Align left"], ["justifyCenter", "Center", "Align center"], ["justifyRight", "Right", "Align right"],
  ["removeFormat", "Clear", "Clear formatting"], ["undo", "↶", "Undo"], ["redo", "↷", "Redo"],
] as const;
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

/** Preserve the native selection and undo stack while the AM edits the complete email. */
export function RecapRichEditor({ html, editable, onChange }: { html: string; editable: boolean; onChange: (html: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const lastHtml = useRef("");
  const [sourceMode, setSourceMode] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const element = root.current;
    if (element && (!element.dataset.loaded || html !== lastHtml.current)) {
      element.innerHTML = sanitizeRecapEmailHtml(html);
      element.dataset.loaded = "true";
      lastHtml.current = html;
      selection.current = null;
    }
  }, [html, sourceMode, editable]);
  const rememberSelection = useCallback(() => {
    const selected = window.getSelection();
    if (selected?.rangeCount && root.current?.contains(selected.getRangeAt(0).commonAncestorContainer)) selection.current = selected.getRangeAt(0).cloneRange();
  }, []);
  useEffect(() => {
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, [rememberSelection]);
  function restoreSelection() {
    const element = root.current; if (!element) return;
    element.focus({ preventScroll: true });
    const selected = window.getSelection();
    if (selection.current && element.contains(selection.current.commonAncestorContainer)) {
      selected?.removeAllRanges(); selected?.addRange(selection.current);
    }
  }
  function commit() {
    if (!root.current) return;
    root.current.querySelectorAll<HTMLElement>("ul,ol").forEach(element => { element.style.listStyleType = element.tagName === "OL" ? "decimal" : "disc"; if (!element.style.paddingLeft) element.style.paddingLeft = "24px"; });
    const value = root.current.innerHTML; lastHtml.current = value; onChange(value); rememberSelection();
  }
  function selectedBlocks() {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    if (!range || !root.current) return [];
    return Array.from(root.current.querySelectorAll<HTMLElement>("p,li,h1,h2,h3,blockquote")).filter(element => range.intersectsNode(element));
  }
  function command(name: string, value?: string) {
    if (!editable || sourceMode) return;
    restoreSelection(); document.execCommand(name, false, value);
    if (name === "formatBlock") {
      const node = window.getSelection()?.anchorNode;
      const element = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("h1,h2,h3,p");
      if (element && root.current?.contains(element)) {
        Object.assign(element.style, { fontSize: value === "h1" ? "24px" : value === "h2" ? "20px" : value === "h3" ? "17px" : "15px", fontWeight: value === "p" ? "400" : "700", lineHeight: "1.6", borderBottom: "", paddingBottom: "", margin: value === "p" ? "0 0 16px" : "24px 0 12px" });
      }
    }
    commit();
  }
  function fontSize(value: string) {
    restoreSelection(); document.execCommand("fontSize", false, "7");
    root.current?.querySelectorAll<HTMLElement>('font[size="7"]').forEach(element => { element.removeAttribute("size"); element.style.fontSize = value + "px"; });
    commit();
  }
  function spacing(value: string) {
    restoreSelection(); selectedBlocks().forEach(element => { element.style.lineHeight = value; }); commit();
  }
  function openLink() {
    rememberSelection(); const selected = window.getSelection();
    const node = selected?.anchorNode;
    const anchor = (node instanceof Element ? node : node?.parentElement)?.closest("a");
    if (anchor && root.current?.contains(anchor)) { const range = document.createRange(); range.selectNodeContents(anchor); selection.current = range; }
    setLinkText(selection.current?.toString() || ""); setLinkUrl(anchor?.getAttribute("href") || ""); setLinkOpen(true); setError("");
  }
  function insertLink() {
    let url: URL;
    try { url = new URL(linkUrl.trim()); if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw Error(); }
    catch { setError("Use a valid https://, http:// or mailto: link."); return; }
    restoreSelection();
    if (selection.current && !selection.current.collapsed && linkText === selection.current.toString()) document.execCommand("createLink", false, url.href);
    else document.execCommand("insertHTML", false, '<a href="' + escape(url.href) + '" style="color:#1a73e8;text-decoration:underline">' + escape(linkText || url.href) + '</a>');
    commit(); setLinkOpen(false); setError("");
  }
  return <div className="recap-rich-editor">
    {editable ? <>
      <div className="recap-rich-toolbar" role="toolbar" aria-label="Recap email formatting">
        <select aria-label="Paragraph style" defaultValue="" disabled={sourceMode} onChange={event => { command("formatBlock", event.target.value); event.currentTarget.value = ""; }}><option value="" disabled>Text style</option><option value="p">Paragraph</option><option value="h1">Title</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>
        <select aria-label="Font family" defaultValue="" disabled={sourceMode} onChange={event => { command("fontName", event.target.value); event.currentTarget.value = ""; }}><option value="" disabled>Font</option>{["Arial", "Verdana", "Georgia", "Tahoma"].map(font => <option key={font}>{font}</option>)}</select>
        <select aria-label="Font size" defaultValue="" disabled={sourceMode} onChange={event => { fontSize(event.target.value); event.currentTarget.value = ""; }}><option value="" disabled>Size</option>{[12, 14, 15, 16, 18, 20, 24, 28].map(size => <option key={size} value={size}>{size}px</option>)}</select>
        <select aria-label="Line spacing" defaultValue="" disabled={sourceMode} onChange={event => { spacing(event.target.value); event.currentTarget.value = ""; }}><option value="" disabled>Line spacing</option>{[1, 1.25, 1.5, 1.65, 1.8, 2].map(value => <option key={value} value={value}>Spacing {value}</option>)}</select>
        {commands.map(([name, label, title]) => <button type="button" key={name} aria-label={title} title={title} disabled={sourceMode} onMouseDown={event => event.preventDefault()} onClick={() => command(name)}>{label}</button>)}
        <input type="color" aria-label="Text color" defaultValue="#0d1b2a" disabled={sourceMode} onChange={event => command("foreColor", event.target.value)} />
        <button type="button" disabled={sourceMode} onMouseDown={event => event.preventDefault()} onClick={openLink}>Link</button>
        <button type="button" disabled={sourceMode} onMouseDown={event => event.preventDefault()} onClick={() => command("unlink")}>Remove link</button>
        <button type="button" className="recap-rich-source-toggle" onClick={() => { rememberSelection(); setSourceMode(value => !value); setLinkOpen(false); }}>{sourceMode ? "Visual editor" : "Edit full template (HTML)"}</button>
      </div>
      {linkOpen ? <div className="recap-rich-link" role="group" aria-label="Insert email link"><label>Link text<input aria-label="Link text" className="input" value={linkText} onChange={event => setLinkText(event.target.value)} /></label><label>Link address<input aria-label="Link address" className="input" type="url" placeholder="https://" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} /></label><button type="button" className="btn btn-primary btn-sm" onClick={insertLink}>Apply link</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkOpen(false)}>Cancel link</button></div> : null}
      {error ? <p role="alert" className="field-hint">{error}</p> : null}
    </> : null}
    {sourceMode && editable ? <label className="recap-rich-source-label">Full email HTML<textarea aria-label="Full email HTML" className="textarea" rows={20} spellCheck={false} value={html} onChange={event => onChange(event.target.value)} /></label> : <div className="recap-rich-canvas"><div ref={root} role="textbox" aria-label="Recap email body" aria-multiline="true" aria-readonly={!editable} contentEditable={editable} suppressContentEditableWarning onInput={commit} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onBlur={rememberSelection} onPaste={event => {
      if (!editable) return; event.preventDefault(); const markup = event.clipboardData.getData("text/html"); document.execCommand(markup ? "insertHTML" : "insertText", false, markup ? sanitizeRecapEmailHtml(markup) : event.clipboardData.getData("text/plain")); commit();
    }} /></div>}
  </div>;
}
