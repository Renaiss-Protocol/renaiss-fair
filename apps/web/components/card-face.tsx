import type { LineupCard } from "@/lib/api/types";
import { formatUsd, TIER_COLORS, tierLabel } from "@/lib/format";

/** Small graded-card face on the dark stage; tier drives the frame color. */
export function CardFace({ card }: { card: LineupCard }) {
  const tierColor = TIER_COLORS[card.tier];

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-md bg-raised shadow-card"
      style={{ border: `1.5px solid ${tierColor}55` }}
    >
      <div className="flex flex-1 flex-col justify-between p-2">
        <div>
          <p className="font-display text-[11px] font-semibold leading-tight">
            {card.name}
          </p>
          <p className="mt-0.5 font-mono-num text-[10px] text-muted">
            #{card.tokenId}
          </p>
        </div>
        <div className="flex items-end justify-between">
          <span
            className="font-display text-[10px] font-bold"
            style={{ color: tierColor }}
          >
            {tierLabel(card.tier)}
          </span>
          <span className="font-mono-num text-[10px] text-muted">
            {formatUsd(card.valueInUsd)}
          </span>
        </div>
      </div>
      {/* scan overlay — lit by the replay timeline */}
      <div
        data-scan
        className="pointer-events-none absolute inset-0 rounded-md opacity-0"
        style={{
          background: "rgba(255,120,150,.16)",
          border: "1.5px solid rgba(255,120,150,.7)",
        }}
      />
      {/* winner glow — lit when this card is picked */}
      <div
        data-glow
        className="pointer-events-none absolute inset-0 rounded-md opacity-0"
        style={{ boxShadow: "0 0 34px rgba(255,120,150,.55)" }}
      />
    </div>
  );
}
