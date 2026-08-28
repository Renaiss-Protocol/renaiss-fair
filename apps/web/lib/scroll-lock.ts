"use client";

/**
 * Freezing the page behind a full-screen panel, counted rather than captured.
 *
 * The obvious version — each panel remembers the body's styles on the way in
 * and puts them back on the way out — breaks as soon as two panels overlap,
 * and they do overlap: a panel fades out before it unmounts, so opening the
 * next one while the last is still leaving means the newcomer records
 * `position: fixed` as the state to restore. It then restores exactly that,
 * and the page can never be scrolled again.
 *
 * So the lock is held by count. The first caller freezes and records the real
 * state; the last one out puts it back. Anyone in between changes nothing.
 */
let holders = 0;
let saved: { position: string; top: string; width: string; scrollY: number } = {
  position: "",
  top: "",
  width: "",
  scrollY: 0,
};

/**
 * Freezing and unfreezing both move the scroll position, and the browser
 * reports that as an ordinary scroll — so anything that reacts to scrolling
 * sees a jump to the top the moment a panel opens, and a jump back when it
 * closes. Neither is the reader moving. Whoever listens needs to be able to
 * tell the difference, which means the lock has to say when it is on.
 */
const watchers = new Set<(locked: boolean) => void>();
const announce = (locked: boolean) => {
  for (const w of watchers) w(locked);
};

/** Whether the page is currently frozen behind a panel. */
export const isScrollLocked = () => holders > 0;

/** Hear about the page being frozen and released. Returns the unsubscribe. */
export function onScrollLockChange(fn: (locked: boolean) => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** Freeze the page. Returns the release, which is safe to call twice. */
export function lockScroll(): () => void {
  const body = document.body;
  if (holders === 0) {
    saved = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      scrollY: window.scrollY,
    };
    body.style.position = "fixed";
    body.style.top = `-${saved.scrollY}px`;
    body.style.width = "100%";
  }
  holders += 1;
  if (holders === 1) announce(true);

  let released = false;
  return () => {
    if (released) return; // a double release must not drop someone else's lock
    released = true;
    holders -= 1;
    if (holders > 0) return;
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.width = saved.width;
    // Restore twice: unfreezing reflows the page, and a scroll set before that
    // lands can be clamped against a document that is briefly the wrong height.
    // On a timer, not requestAnimationFrame — rAF stops in a hidden tab, and
    // being returned to the wrong place is worse than being returned late.
    window.scrollTo(0, saved.scrollY);
    window.setTimeout(() => window.scrollTo(0, saved.scrollY), 0);
    announce(false);
  };
}
