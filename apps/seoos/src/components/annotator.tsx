"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Tone = "important" | "critical" | "positive" | "info";

const PATTERNS: Array<{ re: string; tone: Tone }> = [
  { re: "\\$\\d[\\d,]*(?:\\.\\d+)?\\s?(?:[KkMm])?", tone: "important" }, // money
  { re: "\\b\\d+(?:\\.\\d+)?%", tone: "important" }, // percent
  { re: "#\\d+\\b", tone: "important" }, // #position
  { re: "\\b(?:position|rank(?:ing)?|spot)\\s+#?\\d+", tone: "important" },
  { re: "\\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2}(?:,?\\s*\\d{4})?\\b", tone: "important" },
  { re: "\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b", tone: "important" },
  { re: "\\b\\d+\\s+days?\\b", tone: "important" },
  { re: "\\b(?:declin(?:e|ed|ing)|decreas(?:e|ed|ing)|drop(?:ped|ping)?|fell|lost|missed|overdue|unresolved|delayed?|stalled|paused|fail(?:ed|ing)?|blocked|at[\\s-]risk|churn(?:ing|ed)?|inactive|offboarding)\\b", tone: "critical" },
  { re: "\\b(?:improv(?:e|ed|ing)|increas(?:e|ed|ing)|grew|grow(?:ing|th)|gain(?:ed|ing|s)?|complet(?:e|ed)|resolv(?:e|ed)|approv(?:e|ed)|publish(?:ed)?|launch(?:ed)?|won|healthy|on[\\s-]track|active)\\b", tone: "positive" },
  { re: "\\b(?:deadline|due|awaiting|pending|upcoming|scheduled)\\b", tone: "important" },
  { re: "\\b(?:recommend(?:ation|ed|s)?|opportunit(?:y|ies)|next step|strateg(?:y|ic)|suggest(?:ed|ion)?)\\b", tone: "info" },
];

const SKIP = new Set(["SCRIPT", "STYLE", "MARK", "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "CODE", "PRE", "SVG"]);

function compiled() {
  return PATTERNS.map((p) => ({ re: new RegExp(p.re, "gi"), tone: p.tone }));
}

function clearMarks(root: HTMLElement) {
  root.querySelectorAll("mark.hl").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
    parent.normalize();
  });
}

function annotate(root: HTMLElement) {
  const rules = compiled();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest("mark.hl")) return NodeFilter.FILTER_REJECT;
      if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);

  for (const textNode of targets) {
    const text = textNode.nodeValue ?? "";
    const matches: Array<{ start: number; end: number; tone: Tone }> = [];
    for (const { re, tone } of rules) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        matches.push({ start: m.index, end: m.index + m[0].length, tone });
      }
    }
    if (!matches.length) continue;
    matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

    const chosen: typeof matches = [];
    let lastEnd = 0;
    for (const mt of matches) {
      if (mt.start < lastEnd) continue;
      chosen.push(mt);
      lastEnd = mt.end;
    }

    const frag = document.createDocumentFragment();
    let idx = 0;
    for (const mt of chosen) {
      if (mt.start > idx) frag.appendChild(document.createTextNode(text.slice(idx, mt.start)));
      const mark = document.createElement("mark");
      mark.className = `hl ${mt.tone}`;
      mark.textContent = text.slice(mt.start, mt.end);
      frag.appendChild(mark);
      idx = mt.end;
    }
    if (idx < text.length) frag.appendChild(document.createTextNode(text.slice(idx)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/** Applies / clears highlighter marks across page content when the toggle changes. */
export function Annotator() {
  const pathname = usePathname();

  useEffect(() => {
    const root = () => document.querySelector<HTMLElement>(".content") ?? document.body;

    function run() {
      const el = root();
      clearMarks(el);
      if (document.documentElement.getAttribute("data-annotations") === "on") {
        // Defer so freshly-rendered content is present.
        requestAnimationFrame(() => annotate(root()));
      }
    }

    run();
    const onToggle = () => run();
    window.addEventListener("seoos-annotations", onToggle);
    return () => window.removeEventListener("seoos-annotations", onToggle);
  }, [pathname]);

  return null;
}
