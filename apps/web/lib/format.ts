export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export const truncateHex = (hex: string, chars = 6): string =>
  hex.length <= 2 + chars * 2
    ? hex
    : `${hex.slice(0, 2 + chars)}…${hex.slice(-chars)}`;

/** The one token-id display format — decimal wire id rendered as truncated
 * hex (`0x1111…f2222`), matching the on-chain uint256 everywhere a token id
 * shows. Keep the full decimal available on hover: explorers key on it. */
export const formatTokenId = (decimalId: string): string =>
  truncateHex(`0x${BigInt(decimalId).toString(16)}`, 5);

/**
 * Money is an integer with 2 implied decimals everywhere (131470 = $1,314.70)
 * — the scale the verify API serves and the Merkle leaves commit. Divide by
 * 100 HERE, at display, and nowhere else: scaling stored values breaks root
 * recomputation and algorithm replay.
 */
export const formatUsd = (v: number): string => {
  const usd = v / 100;
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

// Production tier ladder (apps/web pull-card colors): S yellow → C purple.
// Extended past four ranks — production packs carry five or more tiers
// (display letters are assigned by floor rank, highest first).
export const TIER_COLORS: Record<string, string> = {
  s: "#FDCF00",
  a: "#FF6F00",
  b: "#FF5E86",
  c: "#8260FF",
  d: "#3AC7FF",
  e: "#35D49A",
  f: "#9AA4B2",
};

export const tierLabel = (tier: string): string => tier.toUpperCase();
