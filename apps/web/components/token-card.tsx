"use client";

import { formatTokenId, formatUsd, TIER_COLORS } from "@/lib/format";
import { RemoteImage } from "./remote-image";

/**
 * TokenHoverCard — the marketplace-style card the token matrices pop on
 * hover: slab render on a dark vignette, tier chip, grade line, name, and
 * the value pill. Everything it shows is data the lineup already publishes;
 * tokens without a slab render simply skip the art and grade line and
 * degrade to the text facts.
 *
 * Positioning (portal/absolute, clamping) stays with each call site — this
 * is only the card face, at a fixed 392px footprint (both call sites' clamp
 * math assumes it).
 */
export interface TokenCardData {
  tokenId: string;
  name?: string;
  /** Display tier letter (s, a, b, …) — rank by floor, highest first. */
  tier: string;
  /** The pack's name for the tier (e.g. "legendary") — served by the API. */
  tierName?: string;
  valueInUsd: number;
  status?: string;
  setName?: string;
  gradingCompany?: string;
  grade?: string;
  year?: number;
  frontImageUrl?: string;
}

export function TokenHoverCard({
  token,
  href,
  onClose,
  onPrev,
  onNext,
  place,
}: {
  token: TokenCardData;
  /** Renders a close control. Passed where the card is pinned open by a tap
   *  rather than following a cursor, so it needs an explicit way out. */
  onClose?: (() => void) | undefined;
  /** Step to the neighbouring token. Null at either end of the matrix, which
   *  disables that arrow rather than hiding it — the control should not move
   *  under the reader's thumb. */
  onPrev?: (() => void) | null | undefined;
  onNext?: (() => void) | null | undefined;
  /** 1-based position in the matrix, shown between the arrows. */
  place?: { index: number; total: number } | undefined;
  /** Explorer link, rendered as a button inside the card. Passed only where
   *  the cell behind it cannot carry the link itself — on touch, where a tap
   *  has to open this card rather than leave the page. */
  href?: string | undefined;
}) {
  const tierColor = TIER_COLORS[token.tier];
  // The muted set line above the headline: fixtures carry the full grading
  // identity; the verify API serves the pre-composed setName instead.
  const gradeLine = token.gradingCompany
    ? `${token.gradingCompany} ${token.grade} ${token.year} ${token.setName}`
    : (token.setName ?? null);
  const ripped =
    token.status === "token-assigned" || token.status === "token-released";

  return (
    <div className="relative w-[392px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-white/15 bg-raised/95 shadow-card backdrop-blur-md">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-sm"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {token.frontImageUrl && (
        <div
          className="relative flex h-[340px] items-center justify-center"
          style={{
            // S-tier gets the marketplace's golden-glow vignette.
            background:
              token.tier === "s"
                ? "radial-gradient(80% 75% at 50% 42%, rgba(253,207,0,.26) 0%, #101013 76%)"
                : "radial-gradient(80% 75% at 50% 42%, #2a2a31 0%, #101013 78%)",
          }}
        >
          <RemoteImage
            src={token.frontImageUrl}
            alt={token.name ?? `Token #${token.tokenId}`}
            width={302}
            height={354}
            sizes="300px"
            frameClassName="aspect-[302/354] h-[300px]"
            imgClassName="h-full w-full object-contain drop-shadow-[0_14px_22px_rgba(0,0,0,.55)]"
            placeholderClassName="rounded-lg"
            fallback={
              <div
                aria-hidden
                className="aspect-[302/354] h-[300px] rounded-lg border border-white/10 bg-white/[0.04]"
              />
            }
          />
          <span
            className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 font-mono-num text-[12px] font-bold uppercase"
            style={{ color: tierColor }}
          >
            Tier {token.tier}
            {token.tierName ? ` · ${token.tierName}` : ""}
          </span>
          {ripped && (
            <span
              className={`absolute top-3 rounded-full bg-black/60 px-3 py-1 font-body text-[12px] font-semibold text-muted ${
                onClose ? "right-14" : "right-3"
              }`}
            >
              Ripped
            </span>
          )}
        </div>
      )}

      <div className="p-4">
        {gradeLine && (
          <p className="truncate font-body text-[13px] text-muted">
            {gradeLine}
          </p>
        )}
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="font-display text-[17px] font-semibold leading-tight">
            {token.name ?? `Token ${formatTokenId(token.tokenId)}`}
          </p>
          {/* Tokens without art still need the tier somewhere visible. */}
          {!token.frontImageUrl && (
            <span
              className="mt-0.5 inline-block shrink-0 rounded px-1.5 py-0.5 font-mono-num text-[10px] font-bold uppercase"
              style={{
                color: tierColor,
                backgroundColor: `${tierColor}1f`,
              }}
            >
              Tier {token.tier}
              {token.tierName ? ` · ${token.tierName}` : ""}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span
            className="font-mono-num text-[13px] text-muted"
            title={`Token ID: ${token.tokenId}`}
          >
            Token ID: {formatTokenId(token.tokenId)}
          </span>
          <span className="rounded-full border border-[#3d3517] bg-[#2a2412] px-3.5 py-1 font-mono-num text-[13.5px] font-bold">
            {formatUsd(token.valueInUsd)}
          </span>
        </div>
        {(onPrev !== undefined || onNext !== undefined) && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onPrev?.()}
              disabled={!onPrev}
              aria-label="Previous card"
              className="flex h-9 w-12 items-center justify-center rounded-md border border-hairline bg-raised text-white transition-colors disabled:opacity-35"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            {place && (
              <span className="font-mono-num text-[12px] text-muted">
                {place.index} / {place.total}
              </span>
            )}
            <button
              type="button"
              onClick={() => onNext?.()}
              disabled={!onNext}
              aria-label="Next card"
              className="flex h-9 w-12 items-center justify-center rounded-md border border-hairline bg-raised text-white transition-colors disabled:opacity-35"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-hairline bg-raised py-2 font-body text-[13px] font-semibold text-white transition-colors hover:border-white/30"
          >
            View on explorer
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
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        )}
        {token.status && !token.frontImageUrl && (
          <div className="mt-1 flex items-center justify-between">
            <span className="font-body text-[12px] text-muted">status</span>
            <span
              className={`font-body text-[12px] font-semibold ${
                token.status === "created" ? "text-gain" : "text-muted"
              }`}
            >
              {token.status === "created" ? "available" : "ripped"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
