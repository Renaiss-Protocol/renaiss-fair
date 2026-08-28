/**
 * Feature flags — NEXT_PUBLIC_* so they inline at build time.
 * Unset ⇒ hidden by default.
 */
const on = (v: string | undefined) => v === "1" || v === "true";

export const SHOW_STORY = on(process.env["NEXT_PUBLIC_SHOW_STORY"]);
export const SHOW_TAMPER = on(process.env["NEXT_PUBLIC_SHOW_TAMPER"]);
export const SHOW_FLOW = on(process.env["NEXT_PUBLIC_SHOW_FLOW"]);
export const SHOW_DESIGN_CONFIG = on(
  process.env["NEXT_PUBLIC_SHOW_DESIGN_CONFIG"],
);
