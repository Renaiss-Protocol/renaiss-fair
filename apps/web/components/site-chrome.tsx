"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { VERSION_LABEL } from "@/lib/version";
import { isScrollLocked, onScrollLockChange } from "@/lib/scroll-lock";

/** The strip's height. The block slides up by exactly this to hide it. */
const BAR_H = "2rem";
/** The same figure in pixels, for arithmetic on what is still on screen. */
const BAR_PX = 32;
/** Movement below this is a thumb settling, not a scroll. */
const JITTER_PX = 8;
/** Within this of the top the strip is always shown — the top is not a scroll. */
const AT_TOP_PX = 24;
/** Within this of the end, the page is not really being scrolled up. */
const AT_BOTTOM_PX = 32;
/** How long the scroll a released panel causes keeps arriving. */
const SETTLE_MS = 150;

/**
 * The version strip, the header, and the rule that hides the strip on the way
 * down. All three live together because hiding one moves the other: the strip
 * carries the site's version stamp, which belongs above the navigation rather
 * than competing with it, but it should not spend a line of a phone screen
 * while someone is reading.
 *
 * It slides the block up rather than collapsing the strip's height. Collapsing
 * shortens the document, which moves the scroll position, which fires another
 * scroll event reading as upward movement — the strip then reappears, grows the
 * document, and the whole thing oscillates. A transform changes nothing about
 * layout, so the gesture that hides it cannot also un-hide it.
 *
 * Driven by scroll events rather than requestAnimationFrame: this decides
 * whether standing information is on screen, and a tab that is not rendering
 * must not be able to strand it in either state.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  // Opening a full-screen panel pins the body, which puts the scroll at the top
  // and reports it as an ordinary scroll — read plainly, that is a big upward
  // move, so the strip came back every time a card was opened and was sitting
  // there again on close. Releasing does the same in reverse. Neither is the
  // reader moving, so the rule sits out both, and picks its baseline back up
  // once the page has settled where the release put it.
  const settling = useRef(false);
  useEffect(() => {
    let timer = 0;
    const stop = onScrollLockChange((locked) => {
      if (locked) return;
      settling.current = true;
      window.clearTimeout(timer);
      // A timer, not requestAnimationFrame: a tab that is not rendering must
      // not be able to leave the strip deaf to scrolling for good.
      timer = window.setTimeout(() => {
        lastY.current = window.scrollY;
        settling.current = false;
      }, SETTLE_MS);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      if (isScrollLocked() || settling.current) return;
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < JITTER_PX) return;
      lastY.current = y;
      // Landing on the end of the page reads as scrolling up — the bounce
      // settles backwards, and momentum overshoots and returns — which brought
      // the strip back every time the reader reached the bottom. At the end,
      // only the top counts as somewhere to come back from.
      const doc = document.documentElement;
      const atEnd =
        y + window.innerHeight >= doc.scrollHeight - AT_BOTTOM_PX;
      setHidden(y > AT_TOP_PX && (delta > 0 || atEnd));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Anything that sticks below the chrome needs to know where it ends, and
  // that moves: the strip stays put on the whitepaper and slides away
  // elsewhere. What is published is the height still ON SCREEN — hiding the
  // strip translates it out of view without changing the block's height, so
  // the raw height overstates the chrome by exactly the strip whenever it is
  // away, and anything sticking to that figure floats with a band of article
  // showing above it.
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = block.current;
    if (!el) return;
    const publish = () => {
      const full = el.getBoundingClientRect().height;
      const shown = hidden ? full - BAR_PX : full;
      document.documentElement.style.setProperty(
        "--chrome-h",
        `${Math.round(Math.max(0, shown))}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden]);

  return (
    <div
      ref={block}
      className="site-chrome sticky top-0 z-50 transition-transform duration-200 ease-out"
      style={{ transform: hidden ? `translateY(-${BAR_H})` : "none" }}
    >
      <div
        aria-hidden={hidden}
        className="flex items-center justify-center gap-3 border-b border-hairline px-4 sm:px-6 md:px-10"
        style={{ height: BAR_H }}
      >
        <span className="whitespace-nowrap font-body text-[11px] text-muted lg:text-xs">
          {VERSION_LABEL}
        </span>
      </div>
      {children}
    </div>
  );
}
