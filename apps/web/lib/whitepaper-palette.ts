export type WpTone = "inventory" | "algorithm" | "draw";

export type WhitepaperPaletteId =
  | "coastal"
  | "blueprint"
  | "blueprint-cobalt"
  | "blueprint-technical"
  | "blueprint-signal"
  | "blueprint-navy"
  | "horizon"
  | "ink"
  | "coral-reef"
  | "orchid"
  | "emerald"
  | "meadow"
  | "dusk"
  | "fog";

export interface WhitepaperPalette {
  id: WhitepaperPaletteId;
  name: string;
  description: string;
  family: "blueprint" | "other" | "spectrum";
}

export const WHITEPAPER_PALETTES: readonly WhitepaperPalette[] = [
  {
    id: "blueprint",
    name: "Original",
    description: "Bronze, steel blue, and teal",
    family: "blueprint",
  },
  {
    id: "blueprint-cobalt",
    name: "Cobalt",
    description: "Bronze, cobalt, and violet",
    family: "blueprint",
  },
  {
    id: "blueprint-technical",
    name: "Technical",
    description: "Bronze, technical blue, and green",
    family: "blueprint",
  },
  {
    id: "blueprint-signal",
    name: "Signal",
    description: "Rust, charcoal, and cobalt",
    family: "blueprint",
  },
  {
    id: "blueprint-navy",
    name: "Navy",
    description: "Bronze, navy, and teal",
    family: "blueprint",
  },
  {
    id: "coastal",
    name: "Coastal",
    description: "Amber, navy, and ocean blue",
    family: "other",
  },
  {
    id: "horizon",
    name: "Horizon",
    description: "Ochre, cobalt, and bright ocean blue",
    family: "other",
  },
  {
    id: "ink",
    name: "Ink",
    description: "Graphite, ink blue, and teal",
    family: "other",
  },
  {
    id: "coral-reef",
    name: "Coral reef",
    description: "Coral, ocean blue, and cyan",
    family: "spectrum",
  },
  {
    id: "orchid",
    name: "Orchid",
    description: "Raspberry, violet, and teal",
    family: "spectrum",
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Rust, deep blue, and emerald",
    family: "spectrum",
  },
  {
    id: "meadow",
    name: "Meadow",
    description: "Olive gold, steel blue, and green",
    family: "spectrum",
  },
  {
    id: "dusk",
    name: "Dusk",
    description: "Terracotta, indigo slate, and muted teal",
    family: "spectrum",
  },
  {
    id: "fog",
    name: "Fog",
    description: "Taupe, slate blue, and gray teal",
    family: "spectrum",
  },
] as const;

export const DEFAULT_WHITEPAPER_PALETTE: WhitepaperPaletteId = "horizon";

export function isWhitepaperPaletteId(
  value: string | null | undefined,
): value is WhitepaperPaletteId {
  return WHITEPAPER_PALETTES.some((palette) => palette.id === value);
}

export function wpToneColor(
  tone: WpTone,
  role: "solid" | "wash" | "line" = "solid",
): string {
  return `var(--wp-tone-${tone}-${role})`;
}

/** How toned surfaces separate from the page: a tone glow (three strengths)
 *  or the original 1px tone outline. Maps to `data-wp-surface` on <html>. */
export type WhitepaperSurfaceId = "whisper" | "veil" | "aura" | "outline";

export interface WhitepaperSurface {
  id: WhitepaperSurfaceId;
  name: string;
  description: string;
}

export const WHITEPAPER_SURFACES: readonly WhitepaperSurface[] = [
  {
    id: "whisper",
    name: "Whisper",
    description: "Faintest hint of tone, almost flat",
  },
  {
    id: "veil",
    name: "Veil",
    description: "Subtle tone glow, no borders",
  },
  {
    id: "aura",
    name: "Aura",
    description: "Softly pronounced tone glow",
  },
  {
    id: "outline",
    name: "Outline",
    description: "Classic 1px tone borders, no glow",
  },
] as const;

export const DEFAULT_WHITEPAPER_SURFACE: WhitepaperSurfaceId = "whisper";

export function isWhitepaperSurfaceId(
  value: string | null | undefined,
): value is WhitepaperSurfaceId {
  return WHITEPAPER_SURFACES.some((surface) => surface.id === value);
}
