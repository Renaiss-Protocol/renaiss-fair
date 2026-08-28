"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { gsap, useGSAP } from "./gsap";
import { SHOW_FLOW, SHOW_STORY, SHOW_TAMPER } from "@/lib/flags";
import { routeOf } from "@/lib/route";

const TABS = [
  { href: "/verify-a-rip", label: "Verify a Rip" },
  ...(SHOW_FLOW ? [{ href: "/flow-diagram", label: "Flow Diagram" }] : []),
  { href: "/verify-a-gacha", label: "Verify a Gacha" },
  { href: "/faq", label: "FAQ" },
  ...(SHOW_STORY ? [{ href: "/story", label: "Story" }] : []),
  ...(SHOW_TAMPER ? [{ href: "/tamper", label: "Tamper" }] : []),
];

/** Header navigation between the two verifier layouts; preserves ?tx=. */
export function NavTabs() {
  const scope = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const route = routeOf(pathname);
  const searchParams = useSearchParams();
  const tx = searchParams.get("tx");
  const query = tx ? `?tx=${tx}` : "";

  useGSAP(
    () => {
      const sync = (animate: boolean) => {
        const active = scope.current?.querySelector<HTMLElement>(
          `[data-nav="${route}"]`,
        );
        const indicator =
          scope.current?.querySelector<HTMLElement>("[data-indicator]");
        if (!active || !indicator) return;
        const pos = { x: active.offsetLeft, width: active.offsetWidth };
        // Which tab is selected is information, not decoration, so none of it
        // is left to the tween. Visibility is set outright, and the slide is
        // backed by a timer that lands it by hand: requestAnimationFrame stops
        // in a backgrounded or occluded tab, and a tween that never ticks
        // leaves the pill at zero width and transparent — no selected state at
        // all, which is exactly what the reader needs to see.
        gsap.set(indicator, { autoAlpha: 1 });
        if (!animate) {
          gsap.set(indicator, pos);
          return;
        }
        const slide = gsap.to(indicator, {
          ...pos,
          duration: 0.35,
          ease: "power3.out",
          overwrite: true,
        });
        landings.push(
          window.setTimeout(() => {
            if (slide.progress() < 1) slide.progress(1, false);
          }, 700),
        );
      };
      const landings: number[] = [];
      sync(true);
      // Tab metrics move without a navigation (viewport breakpoint, font
      // swap); the nav resizes with them, so re-sync from its ResizeObserver.
      // Skip the observer's initial synchronous fire — otherwise its hard
      // gsap.set snaps the indicator mid-slide on every navigation (the jitter).
      let primed = false;
      const ro = new ResizeObserver(() => {
        if (!primed) {
          primed = true;
          return;
        }
        sync(false);
      });
      if (scope.current) ro.observe(scope.current);
      return () => {
        ro.disconnect();
        landings.forEach(window.clearTimeout);
      };
    },
    { scope, dependencies: [route] },
  );

  return (
    <nav
      ref={scope}
      aria-label="Verifier layout"
      className="relative inline-flex rounded-full border border-hairline bg-raised p-1"
    >
      <div
        data-indicator
        className="absolute left-0 top-1 h-[calc(100%-8px)] rounded-full border border-white/30 bg-white/10 opacity-0"
        style={{ width: 0 }}
      />
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={`${t.href}${query}`}
          data-nav={t.href}
          aria-current={route === t.href ? "page" : undefined}
          className={`relative z-10 whitespace-nowrap rounded-full px-2.5 py-1 font-display text-[12px] font-semibold transition-colors md:px-4 md:text-[13px] ${
            route === t.href ? "text-white" : "text-muted hover:text-white"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
