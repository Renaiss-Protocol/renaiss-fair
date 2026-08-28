"use client";

import { useEffect, useMemo, useState } from "react";
import { WP_TOC, type WpTocEntry } from "./whitepaper-content";
import { wpToneColor, type WpTone } from "@/lib/whitepaper-palette";
import { useWpScrollSpy, wpJump } from "./wp-nav-utils";

/**
 * Whitepaper table of contents: grouped, hoverable, click a section to
 * expand its subsections (and jump there); scroll-spy keeps the active
 * section highlighted and auto-expanded.
 */
export function WhitepaperToc() {
  const activeId = useWpScrollSpy();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // auto-expand the section being read
  useEffect(() => {
    setExpanded((prev) =>
      prev.has(activeId) ? prev : new Set(prev).add(activeId),
    );
  }, [activeId]);

  const groups = useMemo(() => {
    const out: {
      group: string;
      tone?: WpTone;
      entries: WpTocEntry[];
    }[] = [];
    for (const e of WP_TOC) {
      const last = out[out.length - 1];
      if (last && last.group === e.group) {
        last.entries.push(e);
        if (e.tone) last.tone = e.tone;
      } else
        out.push({
          group: e.group,
          ...(e.tone ? { tone: e.tone } : {}),
          entries: [e],
        });
    }
    return out;
  }, []);

  const jump = (id: string) => wpJump(id, 96);

  const onSection = (e: WpTocEntry) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
    jump(e.id);
  };

  return (
    <nav aria-label="Table of contents" className="text-[13px]">
      {groups.map(({ group, tone, entries }) => (
        <div key={group} className="mb-5">
          <p
            className="mb-1.5 px-2 font-display text-[10.5px] font-semibold uppercase tracking-[.16em] text-black/35"
            style={tone ? { color: wpToneColor(tone) } : undefined}
          >
            {group}
          </p>
          <ul>
            {entries.map((e) => {
              const active = activeId === e.id;
              const open = expanded.has(e.id) && e.subs.length > 0;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onSection(e)}
                    aria-expanded={e.subs.length > 0 ? open : undefined}
                    className={`group flex w-full items-baseline gap-2.5 rounded-md px-2 py-[7px] text-left transition-all duration-150 hover:bg-black/[.05] hover:pl-3 ${
                      active ? "bg-black/[.04]" : ""
                    }`}
                  >
                    <span
                      className={`w-6 shrink-0 text-right font-mono-num text-[11px] transition-colors ${
                        active ? "text-black" : "text-black/35 group-hover:text-black/60"
                      }`}
                    >
                      {e.num}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate font-body transition-colors ${
                        active
                          ? "font-semibold text-black"
                          : "text-black/60 group-hover:text-black/85"
                      }`}
                    >
                      {e.title}
                    </span>
                    {e.subs.length > 0 && (
                      <span
                        className={`shrink-0 text-[9px] text-black/30 transition-transform duration-200 ${
                          open ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </span>
                    )}
                  </button>
                  {/* Expandable subsections with a CSS grid-rows animation. */}
                  {e.subs.length > 0 && (
                    <div
                      className="grid transition-[grid-template-rows] duration-300 ease-out"
                      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                    >
                      <ul className="overflow-hidden">
                        {e.subs.map((s) => (
                          <li key={s.id}>
                            <button
                              onClick={() => jump(s.id)}
                              className="flex w-full items-baseline gap-2 rounded-md py-[5px] pl-[42px] pr-2 text-left font-body text-[12.5px] text-black/50 transition-all duration-150 hover:bg-black/[.04] hover:pl-[46px] hover:text-black/85"
                            >
                              <span className="text-[9px] text-black/25">◦</span>
                              <span className="truncate">{s.title}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
