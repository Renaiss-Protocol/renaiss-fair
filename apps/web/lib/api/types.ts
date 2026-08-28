/**
 * Public API contracts for pack-rip verification — the witness endpoints
 * (getVrfPublicKey, getDrawWitness, getSetDrawHistory + the lineup from
 * getSetInfo). lib/api/client.ts reads the live fair API when
 * NEXT_PUBLIC_RENAISS_API_URL is set, and serves the committed demo fixtures
 * with the same shapes otherwise.
 *
 * Privacy: responses never include wallet addresses of OTHER buyers or any
 * settlementSalt. (The demo buyer address appears only for the looked-up tx,
 * which is public on-chain anyway.)
 */

export interface VrfPublicKey {
  suite: "ECVRF-EDWARDS25519-SHA512-ELL2";
  publicKeyHex: string;
}

/**
 * One verifiable pack — just enough identity to know WHICH pack you are
 * verifying: the display name, the ids, and how far its sets have ripped.
 * No storefront data (prices, artwork) — that lives on the shop, not here.
 */
export interface PackSummary {
  packId: string;
  /** The pack's 32-byte on-chain id — a VRF seed input, published on-chain. */
  onChainPackId: string;
  name: string;
  /** "live" while any set is still ripping or upcoming; "completed" after.
   * Absent in API mode — the verify contract serves no lifecycle status. */
  status?: "live" | "completed";
  /** Absent in API mode — the verify contract serves no set totals. */
  setCount?: number;
  /** Sets fully drawn, so browsable in full. Served in both modes — it is the
   * one count the verify contract does publish (`allCardDrawnSetCount`). */
  drawnSetCount?: number;
  /** The pack's tier naming — snapshot tier id → display name (e.g.
   * "0" → "common"). Served by the verify API; absent in mock mode. */
  tiers?: { tier: string; name: string }[];
  /** Static backdrop image for the pack card. */
  bgUrl: string;
  /** Animated backdrop (video or animated image); preferred over bgUrl. */
  bgVideoUrl?: string | null;
  /** The pack's product image (the rotating pack render). */
  imgUrl: string;
}

/** One slot of a set lineup (public — same data as gachaV3.getSetInfo). */
export interface LineupCard {
  tokenId: string;
  name: string;
  /** Display letter by tier rank ("s", "a", …) — keys TIER_COLORS. API mode
   * re-keys the wire's snapshot tier ids to letters; ranks past the ladder
   * keep their wire ids (uncolored but correct). */
  tier: string;
  /** The pack's display name for the tier ("legendary") — API mode only. */
  tierName?: string;
  valueInUsd: number;
  status?: "created" | "token-assigned" | "token-released";
  /** The set-tab Merkle leaf salt (32-byte hex). */
  merkleSalt?: string;
  /** Collectible identity (field names mirror the production schema).
   * Optional: the verify API is a verification contract, not a storefront —
   * it serves no art or grading identity; hover cards fall back to no-art. */
  setName?: string;
  gradingCompany?: string;
  grade?: string;
  year?: number;
  /** The graded slab render. */
  frontImageUrl?: string;
}

export interface SetSummary {
  setId: number;
  /** Always "completed" in API mode — the verify contract never serves
   * sealed (active/upcoming) sets (they 404 like nonexistent ones). */
  status: "completed" | "active" | "upcoming";
  cardCount: number;
  /** Absent in API mode — every served set is fully drawn, so cardCount
   * doubles as the ripped count. */
  drawnCount?: number;
}

/** Build-time provenance of a set: genesis inputs + lineup commitment. */
export interface SetProvenanceData {
  /** The served availability root — display/fallback; the on-chain
   * merkleRoots(onChainPackId, setId) read is the commitment (lib/onchain).
   * null for legacy pre-snapshot sets (not verifiable). */
  merkleRoot: string | null;
  /** null for legacy sets with no recorded creation run. */
  genesis: {
    algorithm: string;
    attempts: number;
    triggerTime: string;
    blockNumber: number;
    blockHash: string;
    /** The pack's 32-byte on-chain id — a seed input. */
    onChainPackId: string;
    /** α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂). */
    seed: string;
  } | null;
  /** (tokenId, salt, value) triples — everything needed to recompute the
   * root: leafᵢ = keccak256(abi.encode(tokenIdᵢ, saltᵢ, valueInUsdᵢ)). */
  leaves: { tokenId: string; salt: string; valueInUsd: number }[];
}

/** Verification witness for one draw. No wallet addresses, no settlement salt. */
export interface DrawWitness {
  checkoutId: number;
  setDrawSequence: number;
  blockHash: string;
  /** VRF output β (64 bytes hex). */
  randomness: string;
  /** VRF proof π (80 bytes hex). */
  proof: string;
  /** This draw's own ECVRF public key (API mode — key rotation never breaks
   * historical rows). Absent in mock mode: the global key applies. */
  publicKeyHex?: string;
  /** Absent for a rip lookup's prior draws — a sealed-history replay knows
   * WHICH card each β removed only by deriving it; the record never leaks
   * other buyers' cards. The replay treats an absent record as "nothing to
   * cross-check" (the derived pick stands). */
  resolvedTokenId?: string;
}

/** Result of looking up a permitFund tx (mock of client-side receipt parsing + witness endpoint). */
export interface TxLookupResult {
  txHash: string;
  buyer: string;
  pack: { packId: string; onChainPackId: string; name: string };
  checkoutId: number;
  blockHash: string;
  setId: number;
  witness: DrawWitness;
}
