"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { truncateHex } from "@/lib/format";
import type { PackSummary } from "@/lib/api/types";
import { RemoteImage } from "./remote-image";

/** A pack as the picker shows it. */
type Machine = PackSummary;

/**
 * The gacha-machine picker, over whatever packs the verify API lists (or the
 * fixtures, in mock mode). Selecting one writes ?machine=<onChainPackId> (and
 * clears ?set=, since the inner set only makes sense within one machine); the
 * page scopes its formation to that machine.
 *
 * On a phone the banners would eat most of the screen before the chart even
 * starts, so they collapse into a dropdown showing just the current machine.
 * From sm up they lay out as a grid.
 */
export function MachineGallery({
  machines,
  selected,
}: {
  machines: readonly Machine[];
  /** The selected pack's onChainPackId. */
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);

  const select = (id: string) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    next.set("machine", id);
    next.delete("set"); // switching machines resets the inner set selection
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  // Dismiss the dropdown the ways a dropdown is expected to dismiss.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!dropdown.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = machines.find((m) => m.onChainPackId === selected) ?? machines[0];
  if (!current) return null;

  return (
    <>
      {/* phone: one row, expanding to the full list on tap */}
      <div ref={dropdown} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Gacha machine: ${current.name}. Change machine`}
          className={`flex w-full items-center gap-3 rounded-xl border bg-raised p-2 text-left transition-colors ${
            open ? "border-white/40" : "border-hairline"
          }`}
        >
          <MachineFace machine={current} />
          <span
            className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center text-muted transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="Gacha machines"
            className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-hairline bg-surface shadow-card"
          >
            {machines.map((m) => {
              const active = m.onChainPackId === selected;
              return (
                <button
                  key={m.onChainPackId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    select(m.onChainPackId);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 border-b border-hairline p-2 text-left last:border-b-0 transition-colors ${
                    active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <MachineFace machine={m} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* sm and up: the full grid */}
      <nav
        aria-label="Gacha machines"
        className="hidden gap-2.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-3"
      >
        {machines.map((m) => (
          <MachineCard
            key={m.onChainPackId}
            machine={m}
            active={m.onChainPackId === selected}
            onSelect={() => select(m.onChainPackId)}
          />
        ))}
      </nav>
    </>
  );
}

/** Banner thumbnail + name + status — the shared face of a machine, used by both
 *  the grid card and the phone dropdown. */
function MachineFace({ machine }: { machine: Machine }) {
  const live = machine.status === "live";
  // Backdrop art is fixtures-only; the API serves the pack render instead.
  const art = machine.bgUrl || machine.imgUrl;
  const sets = machine.drawnSetCount;
  return (
    <>
      {art ? (
        // A real <img>, not a CSS background — that's what gives it the load
        // placeholder and an error slab instead of a silently empty square.
        <RemoteImage
          src={art}
          alt=""
          ariaHidden
          width={302}
          height={354}
          sizes="44px"
          frameClassName="h-11 w-11 shrink-0 rounded-lg ring-1 ring-black/30"
          imgClassName="h-full w-full rounded-lg object-cover"
          placeholderClassName="rounded-lg"
          fallback={
            <span className="h-11 w-11 shrink-0 rounded-lg bg-white/[0.06] ring-1 ring-black/30" />
          }
        />
      ) : (
        <span className="h-11 w-11 shrink-0 rounded-lg ring-1 ring-black/30" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-[13px] font-semibold text-white">
            {machine.name}
          </span>
          {live ? (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
          ) : null}
        </span>
        {/* The pack's on-chain id, then the counts — the same line the Sets
            and Packing pickers show, so a pack reads identically wherever it
            is chosen. Hover for the full 32 bytes. The verify API serves no
            lifecycle status or top prize, so neither is shown. */}
        <span
          className="mt-0.5 block truncate font-mono-num text-[11px] text-muted"
          title={machine.onChainPackId}
        >
          {truncateHex(machine.onChainPackId, 5)}
          {sets !== undefined &&
            ` \u00b7 ${sets} ${sets === 1 ? "set" : "sets"} formed`}
        </span>
      </span>
    </>
  );
}

function MachineCard({
  machine,
  active,
  onSelect,
}: {
  machine: Machine;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors sm:w-[300px] ${
        active
          ? "border-white/70 bg-raised"
          : "border-hairline hover:border-white/40"
      }`}
    >
      <MachineFace machine={machine} />
    </button>
  );
}
