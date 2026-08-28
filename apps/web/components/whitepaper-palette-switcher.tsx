"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  DEFAULT_WHITEPAPER_PALETTE,
  DEFAULT_WHITEPAPER_SURFACE,
  isWhitepaperPaletteId,
  isWhitepaperSurfaceId,
  WHITEPAPER_PALETTES,
  WHITEPAPER_SURFACES,
  type WhitepaperPaletteId,
  type WhitepaperSurfaceId,
  type WpTone,
} from "@/lib/whitepaper-palette";

const TONES: readonly WpTone[] = ["inventory", "algorithm", "draw"];
const PALETTE_GROUPS = [
  { id: "blueprint", label: "Blueprint family" },
  { id: "other", label: "Other palettes" },
  { id: "spectrum", label: "Vibrant to subdued" },
] as const;

/* Miniature previews of each surface treatment. Alphas are boosted relative
   to the real tokens so the differences stay legible at swatch size, but the
   ordering (whisper < veil < aura) matches the page. */
const SURFACE_PREVIEWS: Record<WhitepaperSurfaceId, CSSProperties> = {
  whisper: {
    boxShadow:
      "0 0 7px 1px color-mix(in srgb, var(--wp-tone-algorithm-solid) 22%, transparent)",
  },
  veil: {
    boxShadow:
      "0 0 8px 2px color-mix(in srgb, var(--wp-tone-algorithm-solid) 38%, transparent)",
  },
  aura: {
    boxShadow:
      "0 0 10px 3px color-mix(in srgb, var(--wp-tone-algorithm-solid) 55%, transparent)",
  },
  outline: {
    border: "1px solid var(--wp-tone-algorithm-solid)",
  },
};

function paletteFromLocation(): WhitepaperPaletteId {
  const value = new URLSearchParams(window.location.search).get("palette");
  return isWhitepaperPaletteId(value)
    ? value
    : DEFAULT_WHITEPAPER_PALETTE;
}

function surfaceFromLocation(): WhitepaperSurfaceId {
  const value = new URLSearchParams(window.location.search).get("surface");
  return isWhitepaperSurfaceId(value)
    ? value
    : DEFAULT_WHITEPAPER_SURFACE;
}

function applyPalette(palette: WhitepaperPaletteId) {
  document.documentElement.dataset["wpPalette"] = palette;
}

function applySurface(surface: WhitepaperSurfaceId) {
  document.documentElement.dataset["wpSurface"] = surface;
}

function setSearchParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function WhitepaperPaletteSwitcher() {
  const [selected, setSelected] = useState<WhitepaperPaletteId>(
    DEFAULT_WHITEPAPER_PALETTE,
  );
  const [surface, setSurface] = useState<WhitepaperSurfaceId>(
    DEFAULT_WHITEPAPER_SURFACE,
  );
  const [synced, setSynced] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const optionsId = "whitepaper-design-options";

  useEffect(() => {
    const syncFromLocation = () => {
      const palette = paletteFromLocation();
      const surfaceId = surfaceFromLocation();
      setSelected(palette);
      setSurface(surfaceId);
      applyPalette(palette);
      applySurface(surfaceId);
      setSynced(true);
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const choosePalette = (palette: WhitepaperPaletteId) => {
    setSelected(palette);
    setSynced(true);
    applyPalette(palette);
    setSearchParam(
      "palette",
      palette === DEFAULT_WHITEPAPER_PALETTE ? null : palette,
    );
  };

  const chooseSurface = (surfaceId: WhitepaperSurfaceId) => {
    setSurface(surfaceId);
    setSynced(true);
    applySurface(surfaceId);
    setSearchParam(
      "surface",
      surfaceId === DEFAULT_WHITEPAPER_SURFACE ? null : surfaceId,
    );
  };

  return (
    <div className="fixed bottom-[5.25rem] right-6 z-40 w-[min(20rem,calc(100vw-3rem))] sm:bottom-[5.75rem]">
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#F8F7F4]/95 shadow-[0_16px_44px_rgba(23,23,26,0.14)] backdrop-blur-md">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={optionsId}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-black/[.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/60"
        >
          <span className="whitespace-nowrap">
            <span className="font-display text-[12px] font-semibold text-black/70">
              Design config
            </span>{" "}
            <span className="font-body text-[10.5px] text-black/55">
              (for internal use)
            </span>
          </span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 shrink-0 text-black/45 transition-transform duration-200 motion-reduce:transition-none ${
              expanded ? "" : "rotate-180"
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div
              id={optionsId}
              className="border-t border-black/10"
              inert={!expanded}
            >
              <div className="max-h-[min(58dvh,26rem)] space-y-3 overflow-y-auto p-2.5">
                <fieldset>
                  <legend className="px-1 font-body text-[10px] font-semibold uppercase tracking-[.11em] text-black/60">
                    Surface treatment
                  </legend>
                  <div className="mt-1 grid grid-cols-2 gap-1.5">
                    {WHITEPAPER_SURFACES.map((option) => {
                      const active = synced && surface === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-[background-color,border-color,box-shadow] duration-150 ${
                            active
                              ? "border-black/20 bg-white shadow-[0_2px_8px_rgba(23,23,26,0.06)]"
                              : "border-transparent hover:border-black/10 hover:bg-white/70"
                          }`}
                          title={option.description}
                        >
                          <input
                            type="radio"
                            name="whitepaper-surface"
                            value={option.id}
                            checked={active}
                            onChange={() => chooseSurface(option.id)}
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 rounded-lg ring-black/70 ring-offset-1 peer-focus-visible:ring-2"
                          />
                          <span
                            aria-hidden
                            className="h-3.5 w-6 shrink-0 rounded-[5px] bg-white"
                            style={SURFACE_PREVIEWS[option.id]}
                          />
                          <span className="min-w-0 flex-1 truncate font-body text-[11.5px] font-semibold text-black/65">
                            {option.name}
                          </span>
                          <span
                            aria-hidden
                            className={`font-display text-[10px] font-bold text-black/55 transition-opacity ${
                              active ? "opacity-100" : "opacity-0"
                            }`}
                          >
                            ✓
                          </span>
                          <span className="sr-only">{option.description}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="border-t border-black/10 pt-2.5">
                  <legend className="sr-only">Pillar color palette</legend>
                  <p
                    aria-hidden
                    className="px-1 font-body text-[10px] font-semibold uppercase tracking-[.11em] text-black/60"
                  >
                    Pillar color palette
                  </p>
                  <div className="mt-2 space-y-2.5">
                    {PALETTE_GROUPS.map((group) => (
                      <div
                        key={group.id}
                        role="group"
                        aria-labelledby={`palette-group-${group.id}`}
                      >
                        <p
                          id={`palette-group-${group.id}`}
                          className="px-1 font-body text-[9.5px] font-medium uppercase tracking-[.11em] text-black/45"
                        >
                          {group.label}
                        </p>
                        <div className="mt-1 grid grid-cols-2 gap-1.5">
                          {WHITEPAPER_PALETTES.filter(
                            (palette) => palette.family === group.id,
                          ).map((palette) => {
                            const active = synced && selected === palette.id;
                            return (
                              <label
                                key={palette.id}
                                className={`relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-[background-color,border-color,box-shadow] duration-150 ${
                                  active
                                    ? "border-black/20 bg-white shadow-[0_2px_8px_rgba(23,23,26,0.06)]"
                                    : "border-transparent hover:border-black/10 hover:bg-white/70"
                                }`}
                                title={palette.description}
                              >
                                <input
                                  type="radio"
                                  name="whitepaper-palette"
                                  value={palette.id}
                                  checked={active}
                                  onChange={() => choosePalette(palette.id)}
                                  className="peer sr-only"
                                />
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 rounded-lg ring-black/70 ring-offset-1 peer-focus-visible:ring-2"
                                />
                                <span
                                  className="flex shrink-0 -space-x-0.5"
                                  aria-hidden
                                >
                                  {TONES.map((tone) => (
                                    <span
                                      key={tone}
                                      className="h-2.5 w-2.5 rounded-full border border-white"
                                      style={{
                                        backgroundColor: `var(--wp-palette-${palette.id}-${tone}-solid)`,
                                      }}
                                    />
                                  ))}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-body text-[11.5px] font-semibold text-black/65">
                                  {palette.name}
                                </span>
                                <span
                                  aria-hidden
                                  className={`font-display text-[10px] font-bold text-black/55 transition-opacity ${
                                    active ? "opacity-100" : "opacity-0"
                                  }`}
                                >
                                  ✓
                                </span>
                                <span className="sr-only">
                                  {palette.description}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
