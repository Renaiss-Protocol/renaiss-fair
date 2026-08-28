"use client";

import { useEffect, useState } from "react";
import { gsap } from "./gsap";
import { WP_TOC } from "./whitepaper-content";

/**
 * Scroll-spy over the whitepaper article's `[data-wp-section]` headings.
 * Shared by the desktop sidebar TOC and the mobile sticky dropdown.
 */
export function useWpScrollSpy() {
  const [activeId, setActiveId] = useState<string>(WP_TOC[0]!.id);

  useEffect(() => {
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>("[data-wp-section]"),
    );
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.getAttribute("data-wp-section")!);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  return activeId;
}

/** Smooth-scroll to a whitepaper heading, clearing the sticky chrome. */
export function wpJump(id: string, offsetY = 96) {
  const el = document.getElementById(id);
  if (!el) return;
  gsap.to(window, {
    scrollTo: { y: el, offsetY },
    duration: 0.55,
    ease: "power2.inOut",
    overwrite: "auto",
  });
}
