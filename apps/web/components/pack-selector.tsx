"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PackSummary } from "@/lib/api/types";
import { truncateHex } from "@/lib/format";
import { RemoteImage } from "./remote-image";

/**
 * Pack selector — a combobox parked at the right edge, above the list it
 * filters. Click it to open the pack list; type to narrow it by name.
 *
 * The rows keep the pack card's identity block (product render, name, live
 * status, truncated on-chain pack id, set count) but drop the art backdrop —
 * a control here, not a storefront shelf. The on-chain id matters because it
 * is a VRF seed input, so it IS the pack's cryptographic identity.
 */

type PackStatus = NonNullable<PackSummary["status"]>;
const STATUS_BG: Record<PackStatus, string> = {
  live: "#78FF6C59",
  completed: "#FF5E8640",
};
const STATUS_DOT: Record<PackStatus, string> = {
  live: "#78FF6C",
  completed: "#FF5E86",
};

const LISTBOX_ID = "pack-selector-listbox";
const optionId = (index: number) => `pack-selector-option-${index}`;

function StatusPill({ status }: { status: PackStatus }) {
  return (
    <div
      className="flex shrink-0 items-center gap-x-1 rounded-xl px-2 py-0.5 text-[10px] font-medium text-white md:text-[11px]"
      style={{ backgroundColor: STATUS_BG[status] }}
    >
      <div
        className={`size-1.5 rounded-full md:size-2 ${
          status === "live" ? "animate-pulse" : ""
        }`}
        style={{ backgroundColor: STATUS_DOT[status] }}
      />
      {status === "live" ? "Live" : "Completed"}
    </div>
  );
}

/** The pack's product render — the only art left once the backdrop is gone.
 * RemoteImage keeps the row layout from shifting: the loading slab, the art,
 * and the failure slab all share the same footprint. */
function PackThumb({ pack }: { pack: PackSummary }) {
  const slab = (
    <div
      aria-hidden
      className="aspect-[302/354] h-9 shrink-0 rounded-md bg-white/[0.06] md:h-11"
    />
  );
  if (!pack.imgUrl) return slab;
  return (
    <RemoteImage
      src={pack.imgUrl}
      alt=""
      ariaHidden
      width={302}
      height={354}
      sizes="40px"
      frameClassName="aspect-[302/354] h-9 shrink-0 md:h-11"
      imgClassName="h-full w-full object-contain"
      placeholderClassName="rounded-md"
      fallback={slab}
    />
  );
}

function PackMeta({ pack }: { pack: PackSummary }) {
  return (
    <span
      className="block truncate font-mono-num text-[10px] text-muted md:text-[11px]"
      title={pack.onChainPackId}
    >
      {truncateHex(pack.onChainPackId, 5)}
      {pack.setCount !== undefined && ` · ${pack.setCount} sets`}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`size-3 shrink-0 text-muted transition-transform duration-150 ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-3 shrink-0 text-white"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 6.4 4.6 9 10 3.2" />
    </svg>
  );
}

export function PackSelector({
  packs,
  selectedPackId,
  onSelect,
}: {
  packs: PackSummary[];
  selectedPackId: string;
  onSelect: (packId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = packs.find((p) => p.packId === selectedPackId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter((p) => p.name.toLowerCase().includes(q));
  }, [packs, query]);

  // Close on any pointer press outside the control — more reliable than blur,
  // which fires before the click that picked an option.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the active option in view as the arrow keys walk the list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = () => {
    if (open) return;
    setQuery("");
    setActiveIndex(Math.max(0, packs.findIndex((p) => p.packId === selectedPackId)));
    setOpen(true);
    inputRef.current?.focus();
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (pack: PackSummary) => {
    onSelect(pack.packId);
    close();
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const pack = matches[activeIndex];
      if (pack) choose(pack);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab" && open) close();
  };

  return (
    // Layering: above the rows' inline chip tooltips (z-50), but UNDER the
    // token hover cards (fixed z-[120] portals in task-rows / replay-arena)
    // — a hovered card is the most contextual thing on screen and must not
    // be covered by the open pack list.
    <div className="relative z-[110] mx-auto flex max-w-5xl justify-end px-6">
      <div ref={rootRef} className="relative w-full max-w-md">
        {/* Trigger. A div, not a button — it holds the filter input, and an
            input inside a button is invalid. Clicking anywhere opens it. */}
        <div
          onClick={openList}
          className={`flex cursor-pointer items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 transition-colors md:gap-3 md:px-3 ${
            open ? "border-white/25" : "border-hairline hover:border-white/20"
          }`}
        >
          {selected && <PackThumb pack={selected} />}
          <div className="flex min-w-0 flex-1 flex-col">
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={LISTBOX_ID}
              aria-autocomplete="list"
              aria-activedescendant={
                open && matches[activeIndex] ? optionId(activeIndex) : undefined
              }
              aria-label="Filter packs by name"
              readOnly={!open}
              value={open ? query : (selected?.name ?? "")}
              placeholder={selected ? selected.name : "Select a pack"}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              className={`w-full truncate bg-transparent text-[12px] font-bold text-white outline-none placeholder:font-normal placeholder:text-muted md:text-[14px] ${
                open ? "cursor-text" : "cursor-pointer"
              }`}
            />
            {open ? (
              <span className="truncate font-body text-[10px] text-muted md:text-[11px]">
                {query
                  ? `${matches.length} of ${packs.length} packs`
                  : "Type to filter by name"}
              </span>
            ) : (
              selected && <PackMeta pack={selected} />
            )}
          </div>
          {!open && selected?.status && <StatusPill status={selected.status} />}
          {/* The one part of the trigger that toggles — clicking the rest
              opens, so a click into the input doesn't close the list. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              if (open) close();
              else openList();
            }}
            className="flex shrink-0 items-center p-1"
          >
            <Chevron open={open} />
          </button>
        </div>

        {open && (
          <ul
            ref={listRef}
            id={LISTBOX_ID}
            role="listbox"
            aria-label="Packs"
            className="scroll-thin absolute left-0 right-0 top-[calc(100%+4px)] max-h-80 overflow-y-auto rounded-xl border border-hairline bg-raised py-1 shadow-card"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-3 font-body text-[12px] text-muted">
                No packs match “{query.trim()}”.
              </li>
            ) : (
              matches.map((pack, i) => {
                const isSelected = pack.packId === selectedPackId;
                const isActive = i === activeIndex;
                return (
                  <li
                    key={pack.packId}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isActive}
                    // Keep focus in the input so the caret survives the click.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => choose(pack)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-2 md:gap-3 md:px-3 ${
                      isActive ? "bg-white/8" : ""
                    }`}
                  >
                    <PackThumb pack={pack} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="truncate text-[12px] font-bold text-white md:text-[14px]"
                        title={pack.name}
                      >
                        {pack.name}
                      </span>
                      <PackMeta pack={pack} />
                    </div>
                    {pack.status && <StatusPill status={pack.status} />}
                    <span className="flex w-3 shrink-0 justify-center">
                      {isSelected && <Check />}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Placeholder matching the selector's footprint while /packs loads —
 * shared by the Sets and Packing tabs. */
export function PackSelectorSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl justify-end px-6">
      <div className="w-full max-w-md animate-pulse rounded-xl border border-hairline bg-surface px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="h-11 w-9 rounded bg-raised" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-40 rounded bg-raised" />
            <div className="h-2.5 w-28 rounded bg-raised" />
          </div>
        </div>
      </div>
    </div>
  );
}
