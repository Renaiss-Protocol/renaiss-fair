"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockScroll } from "@/lib/scroll-lock";

/** Matches .sheet-fade-out in globals.css — the unmount waits this long. */
const OUT_MS = 110;

/**
 * A run or set's detail as a full-screen panel, for phones. The panel is ~3
 * screens of dense verification data; nested inside a chart row it buries the
 * surrounding flow and loses the reader's place, so below sm it takes over the
 * screen instead, with its own scroll and an explicit way out.
 *
 * Closes on the close button, Escape, and the hardware/browser back button — a
 * history entry is pushed on open so back feels like "leave this detail" rather
 * than "leave the page".
 */
export function DetailSheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the open/close wiring, which
  // would push a second history entry on every parent render.
  const close = useRef(onClose);
  close.current = onClose;

  /**
   * Every exit goes through the back entry: the close button and Escape ask the
   * browser to go back, and the resulting popstate is what actually closes. So
   * the entry we pushed is always consumed exactly once, whichever way the
   * reader leaves — and cleanup never touches history, which matters because
   * StrictMode mounts effects twice in development. Calling back() from cleanup
   * lands its popstate after the remount and closes the sheet on sight.
   */
  const requestClose = () => window.history.back();

  /**
   * The sheet fades out before it goes. React would otherwise drop it in a
   * single frame, which reads as a cut rather than a dismissal.
   *
   * The timer closes it, never the animation's end event: a tab that is not
   * rendering leaves the fade queued, and hanging the unmount off an event
   * that may never fire would strand the reader on a sheet that will not
   * shut. The animation is decoration; the timer is the contract.
   */
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const beginLeave = () => {
    if (left.current) return; // back can fire again mid-exit
    left.current = true;
    const skip =
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skip) {
      close.current();
      return;
    }
    setLeaving(true);
    window.setTimeout(() => close.current(), OUT_MS);
  };

  useEffect(() => {
    // Counted, not captured — see lib/scroll-lock. A sheet fades before it
    // unmounts, so opening the next one while the last is still leaving used to
    // record `position: fixed` as the state to restore, and the page could not
    // be scrolled again afterwards.
    const unlock = lockScroll();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.history.back();
    };
    const onPopState = () => beginLeave();
    window.history.pushState({ sheet: true }, "");
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);

    panel.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
      unlock();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Fades in via CSS (see globals.css): the sheet arrives over the chart
      // rather than replacing the screen in one frame.
      className={`fixed inset-0 z-50 flex flex-col bg-canvas ${
        leaving ? "sheet-fade-out" : "sheet-fade-in"
      }`}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold text-white">
            {title}
          </p>
          {subtitle ? (
            <p className="truncate font-mono-num text-[11px] text-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline text-muted transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div
        ref={panel}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
