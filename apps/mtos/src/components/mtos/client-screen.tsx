"use client";

import { useEffect, useState } from "react";

import { DECK, PresentationSlideCanvas } from "@/src/components/mtos/presentation-slide";
import {
  clientScreenChannel,
  isClientScreenMessage,
  type ClientScreenMessage,
} from "@/src/lib/contracts/live-call";
import type { Presentation, PresentationSlide } from "@/src/lib/mtos-data";

/**
 * The window the client looks at.
 *
 * This is the one surface in MTOS a client ever sees, and it is a separate window rather than a
 * panel for exactly that reason: the account manager shares this window in Google Meet, so
 * anything rendered here is on the client's screen. Nothing internal is passed to it -- it is
 * handed the slides and a slide number, and it has no access to the script, the QA chips or the
 * AM's notes, so a future change to this file cannot leak them.
 *
 * It follows the presenter rather than driving anything: it announces itself on open, the
 * presenter answers with the slide it is actually on, and from then on it renders whatever index
 * arrives. If the presenter window is closed, the last slide stays up -- a client mid-sentence
 * should not have the deck disappear.
 */
export function ClientScreen({
  touchId,
  presentation,
  slides,
}: {
  touchId: string;
  presentation?: Presentation;
  slides: PresentationSlide[];
}) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bus = new BroadcastChannel(clientScreenChannel(touchId));
    bus.onmessage = (event: MessageEvent) => {
      if (!isClientScreenMessage(event.data)) return;
      const message = event.data as ClientScreenMessage;
      if (message.type === "slide") {
        setConnected(true);
        setIndex(message.index);
      }
    };
    bus.postMessage({ type: "hello" } satisfies ClientScreenMessage);
    const onUnload = () => bus.postMessage({ type: "closed" } satisfies ClientScreenMessage);
    window.addEventListener("pagehide", onUnload);
    return () => {
      onUnload();
      window.removeEventListener("pagehide", onUnload);
      bus.onmessage = null;
      bus.close();
    };
  }, [touchId]);

  // The slide is authored at a fixed 1280x720 and scaled, so the client sees the same slide the AM
  // reviewed and the same one the .pptx exports -- never a reflowed approximation of it.
  useEffect(() => {
    const measure = () =>
      setScale(Math.min(window.innerWidth / DECK.width, window.innerHeight / DECK.height));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const slide = slides[Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0))];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: DECK.navy,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      {slide ? (
        <div style={{ width: DECK.width * scale, height: DECK.height * scale, overflow: "hidden" }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <PresentationSlideCanvas
              slide={slide}
              deckTitle={presentation?.title}
              clientName={presentation?.clientName}
              periodLabel={presentation?.periodLabel}
              preparedFor={presentation?.preparedFor}
              preparedBy={presentation?.preparedBy}
              slideNumber={Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0)) + 1}
              slideCount={slides.length}
            />
          </div>
        </div>
      ) : (
        <p style={{ color: "#ffffff", fontFamily: DECK.font, fontSize: 18 }}>
          There is no presentation for this call yet.
        </p>
      )}
      {!connected && slide ? (
        // Said plainly rather than hidden: an AM who shares this window before the presenter has
        // answered needs to know the slide may not be the one they are talking about yet.
        <p
          style={{
            position: "fixed",
            bottom: 10,
            right: 14,
            margin: 0,
            color: "rgba(255,255,255,0.55)",
            fontFamily: DECK.font,
            fontSize: 11,
          }}
        >
          Waiting for the presenter…
        </p>
      ) : null}
    </div>
  );
}
