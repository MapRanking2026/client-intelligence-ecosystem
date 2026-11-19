"use client";

import { useEffect, useRef, useState } from "react";

const SECTIONS = [
  ["score", "Score"], ["notes", "Notes"], ["tickets", "Tickets"],
  ["trackers", "Trackers"], ["recap", "Recap email"], ["finish", "Finish"],
] as const;

/** Navigation only: visiting a section never approves or processes its contents. */
export function FollowThroughNavigation({ confirmed, hasNotes, canFinish }: { confirmed: boolean; hasNotes: boolean; canFinish: boolean }) {
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState("score");
  useEffect(() => {
    const rail = nav.current?.closest<HTMLElement>(".stage-rail");
    const workspace = nav.current?.closest<HTMLElement>(".follow-through-workspace");
    const sync = () => {
      const sections = SECTIONS.map(([id]) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section));
      const bottom = rail?.getBoundingClientRect().bottom ?? 0;
      const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      const current = atEnd ? sections.at(-1) : sections.filter(section => section.getBoundingClientRect().top <= bottom + 32).at(-1);
      setActive(current?.id || sections[0]?.id || "score");
    };
    const resize = new ResizeObserver(() => {
      workspace?.style.setProperty("--follow-rail-height", `${rail?.offsetHeight || 240}px`);
      const stageNav = rail?.querySelector<HTMLElement>('nav[aria-label="Monthly Touch stages"]');
      const stage = stageNav?.querySelector<HTMLElement>('[aria-current="step"]');
      if (stageNav && stage) stageNav.scrollLeft += stage.getBoundingClientRect().left - stageNav.getBoundingClientRect().left - (stageNav.clientWidth - stage.offsetWidth) / 2;
      sync();
    });
    if (rail) resize.observe(rail);
    window.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => { resize.disconnect(); window.removeEventListener("scroll", sync); };
  }, []);
  useEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="location"]');
    if (nav.current && current) nav.current.scrollLeft += current.getBoundingClientRect().left - nav.current.getBoundingClientRect().left - (nav.current.clientWidth - current.offsetWidth) / 2;
  }, [active]);

  return (
    <nav ref={nav} aria-label="Follow-through sections" className="follow-section-nav">
      {SECTIONS.map(([id, label], index) => {
        const enabled = id === "score" || (id === "notes" ? confirmed : confirmed && hasNotes && (id !== "finish" || canFinish));
        return enabled ? (
          <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => setActive(id)}>
            <span>{index + 1}</span>{label}
          </a>
        ) : <span key={id} className="follow-section-locked" aria-disabled="true" title="Complete the preceding preparation first."><span>{index + 1}</span>{label}</span>;
      })}
    </nav>
  );
}
