"use client";

import { useState } from "react";
import { wpJump } from "./wp-nav-utils";

/**
 * Hover anchor on headings: copies the section's deep link to the clipboard
 * (and reflects it in the address bar) with a "Copied" confirmation.
 * `tone` matches the page theme; the whitepaper is the only caller now, but
 * the dark variant stays for anywhere the pattern is wanted again.
 */
export function HeadingAnchor({
  id,
  tone = "light",
}: {
  id: string;
  tone?: "light" | "dark";
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const url = new URL(window.location.href);
    url.hash = id;
    try {
      await navigator.clipboard.writeText(url.href);
    } catch {
      // clipboard unavailable (permissions/http) — still reflect the hash
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      aria-label="Copy link to this section"
      className={`relative ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md align-middle opacity-0 transition-all duration-150 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-40 ${
        tone === "light"
          ? "text-black/30 hover:bg-black/[.06] hover:text-black/70"
          : "text-white/30 hover:bg-white/[.08] hover:text-white/80"
      }`}
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
      <span
        role="status"
        className={`pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 font-body text-[10px] font-medium transition-opacity duration-150 ${
          tone === "light"
            ? "bg-[#17171A] text-white"
            : "bg-white text-[#17171A]"
        } ${copied ? "opacity-100" : "opacity-0"}`}
      >
        Copied
      </span>
    </button>
  );
}

/**
 * In-prose cross-reference (e.g. §2.1): smooth-scrolls to the referenced
 * section and puts the hash in the address bar, so it also works as a link.
 */
export function SecLink({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    wpJump(id, 96);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.pushState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };
  return (
    <a
      href={`#${id}`}
      onClick={onClick}
      className="whitespace-nowrap font-medium text-black underline decoration-black/25 decoration-1 underline-offset-2 transition-colors hover:decoration-black/70"
    >
      {children}
    </a>
  );
}
