/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/rips/{txHash}
 *
 * Prove-it in one request: a permitFund tx hash in, both verification tiers
 * out. Tier A (always, even mid-set): the target draw's witness + card +
 * Merkle inclusion path against the committed root. Tier B (`replay`,
 * non-null only once the set completes): the set's lineup token ids and
 * every prior draw's proof — the full index-resolution reproduction, without
 * leaking other buyers' cards, names or salts. A BatchCheckoutSuccess tx
 * carries one draws[] entry per checkoutId (a 10-card rip → 10 entries).
 *
 * The server never sends buyer addresses (rule 1.6) — the client reads
 * tx.from off the RPC receipt itself (lib/onchain.ts).
 */
import type { DrawWitness, LineupCard } from "../../types";
import { ApiError } from "../http";
import { verifyFetch } from "./http";
import { tierDisplayMaps } from "./task-adapter";

interface WireRipDraw {
  checkoutId: number;
  /** The doc promises it, the shipped wire omits it — derived client-side. */
  setDrawSequence?: number;
  blockHash: string;
  /** β, 64 bytes. */
  randomness: string;
  /** π, 80 bytes. */
  proof: string;
  /** drawRecord key — per draw, so key rotation never breaks history. */
  publicKeyHex: string;
  /** Rule 1.7 exception: rip's card keeps names + imageUrl inline. */
  card: {
    tokenId: string;
    /** Legacy combined string — fallback only. */
    name: string;
    /** The graded-set line ("PSA 10 Gem Mint 2021 … Vmax Climax"). */
    setName?: string;
    /** The card's own headline ("#195 Zekrom"). */
    displayName?: string;
    imageUrl?: string;
    /** Snapshot tier id, null for legacy runs. */
    tier: string | null;
    /** Raw integer, 2 implied decimals — what the Merkle leaf commits. */
    valueInUsd: number;
    merkleSalt: string;
  };
  /** ⌈log₂(setSize)⌉ sibling hashes — folds the card's leaf to the root. */
  merkleProof: string[];
}

interface WireRipResponse {
  pack: {
    onChainPackId: string;
    name: string;
    tiers: { tier: string; name: string }[];
  };
  setId: number;
  /** rip is the ONE endpoint that may reference an active set (rule 1.5). */
  setStatus: "active" | "completed";
  merkleRoot: string | null;
  draws: WireRipDraw[];
  /** null while the set is active — sealed lineups never leak. */
  replay: {
    /** EVERY card of the set, ids only. */
    lineupTokenIds: string[];
    /** Every draw of this set before the batch's largest target. */
    priorDraws: {
      checkoutId: number;
      blockHash: string;
      randomness: string;
      proof: string;
    }[];
  } | null;
}

/** One draw of the rip, walkthrough-ready. */
export interface RipDraw {
  witness: DrawWitness;
  card: LineupCard;
  merkleProof: string[];
}

export interface RipLookup {
  txHash: string;
  /** Only fixture rips know the buyer — the API never serves addresses;
   * API mode reads tx.from off the RPC receipt when configured. */
  buyer?: string;
  pack: { packId: string; onChainPackId: string; name: string };
  setId: number;
  setStatus: "active" | "completed";
  /** The served root — the on-chain merkleRoots read is the commitment. */
  merkleRoot: string | null;
  draws: RipDraw[];
  /** null ⇒ the set is still sealed: Tier A only, the full replay unlocks
   * when the set completes. Fixture rips always carry it. */
  replay: { lineupTokenIds: string[]; priorDraws: DrawWitness[] } | null;
}

/** One rip lookup, or null when the tx is unknown to the verify API. */
export async function fetchRip(txHash: string): Promise<RipLookup | null> {
  let wire: WireRipResponse;
  try {
    wire = await verifyFetch<WireRipResponse>(`/rips/${txHash}`);
  } catch (e) {
    if (e instanceof ApiError && e.code === "GACHA_V3_VERIFY_TX_NOT_FOUND")
      return null;
    // Envelope-less 404s surface as the transport's "→ HTTP 404" message.
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
  const { letterOf, nameOf, lowestLetter } = tierDisplayMaps(wire.pack.tiers);
  return {
    txHash,
    pack: {
      packId: wire.pack.onChainPackId,
      onChainPackId: wire.pack.onChainPackId,
      name: wire.pack.name,
    },
    setId: wire.setId,
    setStatus: wire.setStatus,
    merkleRoot: wire.merkleRoot,
    draws: [...wire.draws]
      .sort((a, b) => a.checkoutId - b.checkoutId)
      .map((d, i) => ({
        witness: {
          checkoutId: d.checkoutId,
          setDrawSequence: d.setDrawSequence ?? i + 1,
          blockHash: d.blockHash,
          randomness: d.randomness,
          proof: d.proof,
          publicKeyHex: d.publicKeyHex,
          resolvedTokenId: d.card.tokenId,
        },
        card: {
          tokenId: d.card.tokenId,
          // Split names render as two lines (set line above, card headline
          // below); the combined legacy string is the fallback.
          name: d.card.displayName ?? d.card.name,
          ...(d.card.setName !== undefined ? { setName: d.card.setName } : {}),
          tier:
            d.card.tier !== null
              ? (letterOf.get(d.card.tier) ?? d.card.tier)
              : lowestLetter,
          ...(d.card.tier !== null && nameOf.has(d.card.tier)
            ? { tierName: nameOf.get(d.card.tier)! }
            : {}),
          valueInUsd: d.card.valueInUsd,
          merkleSalt: d.card.merkleSalt,
          status: "token-released" as const,
          ...(d.card.imageUrl ? { frontImageUrl: d.card.imageUrl } : {}),
        },
        merkleProof: d.merkleProof,
      })),
    replay: wire.replay
      ? {
          lineupTokenIds: wire.replay.lineupTokenIds,
          priorDraws: wire.replay.priorDraws.map((p, i) => ({
            checkoutId: p.checkoutId,
            setDrawSequence: i + 1,
            blockHash: p.blockHash,
            randomness: p.randomness,
            proof: p.proof,
            // No resolvedTokenId — a prior draw's card is derived, never
            // served (rule 1.6); no per-draw key either, the replay falls
            // back to the target draw's.
          })),
        }
      : null,
  };
}
