"use client";

import { useEffect, useState } from "react";

/**
 * True where the pointer cannot hover — phones and tablets.
 *
 * Deliberately a capability query rather than a width breakpoint: what breaks
 * on these devices is not the layout but the fact that a hover-only affordance
 * can never fire. A tablet is wide and still cannot hover.
 *
 * Starts false so the server render and the first client paint agree; the
 * effect corrects it before anything can be tapped.
 */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return touch;
}
