"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * App-wide loading indicator. A thin trickle bar pinned to the top of the
 * viewport that appears whenever something is working and completes when it's
 * done — so an action never just "freezes" with a faded button. It patches
 * window.fetch, so every network action (pull data, generate Monthly Touch,
 * sync, save, navigate…) lights the bar automatically with no per-button wiring.
 * `useLoadingBar()` is also exposed for non-fetch waits.
 */

type LoadingBarApi = { start: () => void; done: () => void };
const LoadingBarContext = createContext<LoadingBarApi | null>(null);
export function useLoadingBar(): LoadingBarApi | null {
  return useContext(LoadingBarContext);
}

export function LoadingBarProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const countRef = useRef(0);
  const trickleRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);

  const stopTrickle = () => {
    if (trickleRef.current !== null) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
  };

  const begin = useCallback(() => {
    if (hideRef.current !== null) {
      clearTimeout(hideRef.current);
      hideRef.current = null;
    }
    setVisible(true);
    setProgress((p) => (p < 8 ? 8 : p));
    stopTrickle();
    trickleRef.current = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        const inc = p < 50 ? 7 : p < 75 ? 3 : 1.2;
        return Math.min(90, p + inc);
      });
    }, 300);
  }, []);

  const finish = useCallback(() => {
    stopTrickle();
    setProgress(100);
    hideRef.current = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 350);
  }, []);

  const start = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) begin();
  }, [begin]);

  const done = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) finish();
  }, [finish]);

  // Patch fetch so any network activity drives the bar.
  useEffect(() => {
    const w = window as typeof window & { __mtosLoadingPatched?: boolean; __mtosOrigFetch?: typeof fetch };
    if (typeof w.fetch !== "function" || w.__mtosLoadingPatched) return;
    const orig = w.fetch.bind(w);
    w.__mtosOrigFetch = orig;
    w.__mtosLoadingPatched = true;
    w.fetch = ((...args: Parameters<typeof fetch>) => {
      start();
      let settled = false;
      const clear = () => {
        if (!settled) {
          settled = true;
          done();
        }
      };
      // Safety net: never leave the bar stuck if a request hangs.
      const safety = window.setTimeout(clear, 45000);
      let p: Promise<Response>;
      try {
        p = orig(...args);
      } catch (err) {
        window.clearTimeout(safety);
        clear();
        throw err;
      }
      return p.then(
        (res) => {
          window.clearTimeout(safety);
          clear();
          return res;
        },
        (err) => {
          window.clearTimeout(safety);
          clear();
          throw err;
        },
      );
    }) as typeof fetch;

    return () => {
      if (w.__mtosOrigFetch) w.fetch = w.__mtosOrigFetch;
      w.__mtosLoadingPatched = false;
    };
  }, [start, done]);

  useEffect(
    () => () => {
      stopTrickle();
      if (hideRef.current !== null) clearTimeout(hideRef.current);
    },
    [],
  );

  return (
    <LoadingBarContext.Provider value={{ start, done }}>
      <div className="mtos-loadbar" data-active={visible ? "1" : "0"} aria-hidden="true">
        <div className="mtos-loadbar-fill" style={{ width: `${progress}%` }} />
      </div>
      {children}
    </LoadingBarContext.Provider>
  );
}
