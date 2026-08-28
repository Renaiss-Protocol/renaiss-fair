/** Renaiss status pill (design-system Tag). */
const TONES: Record<string, { bg: string; fg: string; border?: string }> = {
  neutral: { bg: "var(--surface-raised)", fg: "var(--text)", border: "1px solid var(--border)" },
  gain: { bg: "rgba(120,255,108,.16)", fg: "var(--gain)" },
  loss: { bg: "rgba(255,50,104,.16)", fg: "var(--loss)" },
  message: { bg: "rgba(255,200,0,.16)", fg: "var(--message)" },
  purple: { bg: "rgba(130,96,255,.16)", fg: "#B49CFF" },
  gradient: { bg: "var(--grad-brand)", fg: "#fff" },
};

export function Tag({
  tone = "neutral",
  dot = false,
  mono = false,
  compact = false,
  children,
}: {
  tone?: keyof typeof TONES;
  dot?: boolean;
  mono?: boolean;
  /** Shrinks the pill on small screens, easing back to full size from sm up. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  const t = TONES[tone] ?? TONES["neutral"]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${
        compact
          ? "px-2 py-0.5 text-[10px] sm:px-3 sm:py-1 sm:text-[12px]"
          : "px-3 py-1 text-[12px]"
      } ${mono ? "font-mono-num" : "font-body"}`}
      style={{ background: t.bg, color: t.fg, border: t.border ?? "none" }}
    >
      {dot && (
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: "currentColor" }}
        />
      )}
      {children}
    </span>
  );
}
