"use client";

import { usePathname, useRouter } from "next/navigation";
import { routeOf } from "@/lib/route";
import { useEffect, useRef } from "react";
import { gsap } from "./gsap";

/**
 * Floating action button (bottom-right, all pages): "Whitepaper" transitions
 * the whole site to the light professional theme at /whitepaper; there the
 * label becomes "Verify", which transitions back to the dark verifier.
 * The transition is a circular reveal expanding from the button.
 */
export function WhitepaperFab() {
  const pathname = usePathname();
  const router = useRouter();
  const overlayRef = useRef<HTMLDivElement>(null);
  // routeOf, not a bare compare: the export serves /whitepaper.html, and this
  // effect owns data-page-theme — a miss here repainted the whole chrome dark
  // over a light page, undoing what the pre-paint script had got right.
  const onWhitepaper = routeOf(pathname) === "/whitepaper";

  // theme attribute drives the header/site light overrides in globals.css
  useEffect(() => {
    document.documentElement.dataset["pageTheme"] = onWhitepaper
      ? "light"
      : "dark";
  }, [onWhitepaper]);

  // once the route committed, sweep the overlay away
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    gsap.to(overlay, {
      autoAlpha: 0,
      duration: 0.45,
      delay: 0.1,
      ease: "power1.out",
      onComplete: () => {
        overlay.style.pointerEvents = "none";
      },
    });
  }, [pathname]);

  const go = () => {
    const overlay = overlayRef.current;
    const target = onWhitepaper ? "/verify-a-rip" : "/whitepaper";
    if (!overlay) {
      router.push(target);
      return;
    }
    overlay.style.pointerEvents = "auto";
    gsap.set(overlay, {
      backgroundColor: onWhitepaper ? "#0A0A0B" : "#F8F7F4",
      clipPath: "circle(0px at calc(100% - 72px) calc(100% - 64px))",
      autoAlpha: 1,
    });
    gsap.to(overlay, {
      clipPath: "circle(150% at calc(100% - 72px) calc(100% - 64px))",
      duration: 0.6,
      ease: "power2.inOut",
      onComplete: () => router.push(target),
    });
  };

  return (
    <>
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95] opacity-0"
      />
      {/* Shadow via filter:drop-shadow, not box-shadow — iOS Safari clips
          box-shadow on fixed composited elements to the layer bounds. */}
      <button
        onClick={go}
        className={`fixed bottom-6 right-6 z-[96] inline-flex h-11 items-center gap-2 rounded-full px-6 font-display text-[13px] font-semibold transition-transform [filter:drop-shadow(0_18px_30px_rgba(0,0,0,0.4))] hover:scale-[1.04] ${
          onWhitepaper
            ? "bg-[#17171A] text-white"
            : "border border-white/20 bg-white text-[#0A0A0B]"
        }`}
      >
        {onWhitepaper ? (
          <>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3 4 7v5c0 4 3.4 7.4 8 8.5 4.6-1.1 8-4.5 8-8.5V7l-8-4z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Verify
          </>
        ) : (
          <>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M9 13h6" />
              <path d="M9 17h4" />
            </svg>
            Whitepaper
          </>
        )}
      </button>
    </>
  );
}
