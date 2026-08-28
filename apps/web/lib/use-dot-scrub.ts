"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Press-and-drag scrubbing across a dot matrix, for touch.
 *
 * A mouse scrubs a matrix for free — it hovers one cell after another on the
 * way past. A finger has no hover, so dragging across the dots has to be read
 * deliberately, and it competes with the one thing a finger already does over a
 * tall grid: scroll.
 *
 * So the gesture is press, then drag. A finger that moves straight away is a
 * scroll and is left alone; a finger that sits still for a beat takes the
 * matrix over, and from then on every move picks the dot underneath and the
 * scroll is suppressed for the rest of the gesture. Suppressing it is only
 * possible because the listener is non-passive AND nothing has started
 * scrolling yet — that is exactly what the hold buys.
 *
 * Dots are found by hit test rather than by geometry: the matrices wrap, and
 * the card the scrub opens sits over them. `elementsFromPoint` returns the
 * whole stack under the finger, so the dot is still in there behind the card.
 */

/** How long a finger must sit still before the drag scrubs instead of scrolls. */
const HOLD_MS = 140;
/** Movement within the hold window that means "this is a scroll, not a press". */
const SLOP_PX = 10;
/** A scrub swallows the click its own lift-off may synthesize. */
const TAP_GUARD_MS = 400;

export function useDotScrub({
  enabled,
  onPick,
}: {
  /** Touch only — a pointer that can hover already scrubs by moving. */
  enabled: boolean;
  /** A dot came under the finger: its `data-dot` key + the touch point. */
  onPick: (key: string, x: number, y: number) => void;
}): {
  /** Put this on the element wrapping the dots. It is a callback ref, not a
   *  RefObject, on purpose: a matrix that mounts only once its data lands
   *  (the replay arena) has no node at all on the first render, and a ref
   *  object read inside an effect would be null then and never looked at
   *  again. This wires itself up whenever the node actually appears. */
  ref: (node: HTMLElement | null) => void;
  /** A drag is currently driving the matrix. */
  scrubbing: boolean;
  /** True while a click should be ignored as the tail of a scrub. */
  tapGuarded: () => boolean;
} {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Keep the latest callback without re-running the listener wiring.
  const pick = useRef(onPick);
  pick.current = onPick;
  const guardUntil = useRef(0);
  // Stable, so the node is attached and detached on mount/unmount only.
  const ref = useCallback((node: HTMLElement | null) => setRoot(node), []);

  useEffect(() => {
    if (!root || !enabled) return;

    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let active = false;

    /** The dot under a viewport point, ignoring whatever is drawn over it. */
    const dotAt = (x: number, y: number): string | null => {
      for (const el of document.elementsFromPoint(x, y)) {
        const key = (el as HTMLElement).dataset?.["dot"];
        if (key !== undefined && root.contains(el)) return key;
      }
      return null;
    };

    const cancelHold = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onStart = (e: TouchEvent) => {
      cancelHold();
      // A second finger is a pinch or a scroll — never a scrub.
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        // Press on a gap or a label: leave the gesture to the browser rather
        // than locking the scroll for a drag that has nothing to show.
        const key = dotAt(startX, startY);
        if (key === null) return;
        active = true;
        guardUntil.current = Date.now() + TAP_GUARD_MS;
        setScrubbing(true);
        pick.current(key, startX, startY);
      }, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (!active) {
        if (
          Math.abs(t.clientX - startX) > SLOP_PX ||
          Math.abs(t.clientY - startY) > SLOP_PX
        )
          cancelHold();
        return;
      }
      // The scrub owns the gesture now — nothing scrolls under it.
      e.preventDefault();
      guardUntil.current = Date.now() + TAP_GUARD_MS;
      const key = dotAt(t.clientX, t.clientY);
      // Off the dots (a gap, or past the last row) keeps the last card up
      // rather than blanking it mid-drag.
      if (key !== null) pick.current(key, t.clientX, t.clientY);
    };

    const onEnd = () => {
      cancelHold();
      if (!active) return;
      active = false;
      guardUntil.current = Date.now() + TAP_GUARD_MS;
      setScrubbing(false);
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive: preventDefault is the whole point, and a passive listener
    // cannot cancel the scroll.
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    return () => {
      cancelHold();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, root]);

  return {
    ref,
    scrubbing,
    tapGuarded: () => Date.now() < guardUntil.current,
  };
}
