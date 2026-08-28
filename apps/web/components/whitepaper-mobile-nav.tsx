"use client";

import { useEffect, useRef, useState } from "react";
import { WP_TOC } from "./whitepaper-content";
import { wpToneColor } from "@/lib/whitepaper-palette";
import { useWpScrollSpy, wpJump } from "./wp-nav-utils";

/**
 * Reading progress bar for the whitepaper — a thin solid ink line fixed to
 * the top of the viewport that fills left → right as the reader advances.
 * Deliberately no gradient: solid #17171A over a faint track.
 */
export function ReadingProgress() {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-black/[.07]"
    >
      <div
        ref={fillRef}
        className="h-full w-full origin-left bg-[#17171A]"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}

/**
 * Mobile table of contents (< lg, where the sidebar is hidden): a sticky bar
 * pinned to the top of the viewport showing the section being read; tapping
 * it drops down the full grouped section/subsection tree.
 */
export function WhitepaperMobileToc() {
  const [open, setOpen] = useState(false);
  const activeId = useWpScrollSpy();
  const active = WP_TOC.find((e) => e.id === activeId) ?? WP_TOC[0]!;

  // keep the page from scrolling underneath while the sheet is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    // wait a beat for the body scroll lock to release before tweening
    requestAnimationFrame(() => wpJump(id, 72));
  };

  return (
    <div
      // Below the site header, not over it: at z-50 this outranked the header
      // and covered the nav as soon as the page scrolled. The offset is the
      // chrome's measured height (site-chrome publishes it), because that
      // height differs per page — the caveat strip stays put on the whitepaper
      // and hides everywhere else.
      // Overlaps the chrome by a pixel and carries the page's own background:
      // the offset is a measured value, and anything between the two would
      // otherwise be a window onto the article scrolling past.
      className="wp-toc-bar sticky z-40 lg:hidden"
      style={{ top: "calc(var(--chrome-h, 52px) - 1px)" }}
    >
      {/* the bar */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="wp-mobile-toc"
        className="flex w-full items-center gap-3 border-b border-black/10 bg-[#F8F7F4]/92 px-6 py-3 text-left backdrop-blur-md"
      >
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[.14em] text-black/40">
          On this page
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 font-mono-num text-[11px] text-black/40">
            {active.num}
          </span>
          <span className="truncate font-body text-[13px] font-semibold text-[#17171A]">
            {active.title}
          </span>
        </span>
        <span
          className={`shrink-0 text-[10px] text-black/40 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      </button>

      {/* dim the article behind the open sheet; tap to dismiss */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 -z-10 bg-black/25 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* the sheet — grid-rows collapse, same idiom as the desktop TOC */}
      <div
        id="wp-mobile-toc"
        className="absolute inset-x-0 top-full grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <nav
          aria-label="Table of contents"
          className="overflow-hidden rounded-b-xl border-b border-black/10 bg-[#F8F7F4] shadow-card"
        >
          <div className="max-h-[62vh] overflow-y-auto px-4 py-3">
            {WP_TOC.map((e, i) => {
              const showGroup = i === 0 || WP_TOC[i - 1]!.group !== e.group;
              const isActive = e.id === activeId;
              return (
                <div key={e.id}>
                  {showGroup && (
                    <p
                      className="mb-1 mt-3 px-2 font-display text-[10px] font-semibold uppercase tracking-[.16em] text-black/35 first:mt-0"
                      style={e.tone ? { color: wpToneColor(e.tone) } : undefined}
                    >
                      {e.group}
                    </p>
                  )}
                  <button
                    onClick={() => go(e.id)}
                    className={`flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                      isActive ? "bg-black/[.05]" : "active:bg-black/[.04]"
                    }`}
                  >
                    <span
                      className={`w-6 shrink-0 text-right font-mono-num text-[11px] ${
                        isActive ? "text-black" : "text-black/35"
                      }`}
                    >
                      {e.num}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate font-body text-[13.5px] ${
                        isActive
                          ? "font-semibold text-black"
                          : "text-black/65"
                      }`}
                    >
                      {e.title}
                    </span>
                  </button>
                  {e.subs.length > 0 && (
                    <ul className="mb-1">
                      {e.subs.map((s) => (
                        <li key={s.id}>
                          <button
                            onClick={() => go(s.id)}
                            className="flex w-full items-baseline gap-2 rounded-md py-[6px] pl-[42px] pr-2 text-left font-body text-[12.5px] text-black/50 transition-colors active:bg-black/[.04]"
                          >
                            <span className="text-[9px] text-black/25">◦</span>
                            <span className="truncate">{s.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
