/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/packs/{packId}/sets/{setId}
 *
 * One set's reveal, keyed by (onChainPackId, setId) from /sets: the full
 * lineup with salts + per-card draw proofs, the served merkleRoot, the
 * genesis record, and the top-level tokenId→name/image map (rule 1.7).
 * Only completed sets are served — a sealed set 404s exactly like a
 * nonexistent one (rule 1.5). A completed set is immutable, so responses
 * cache per (pack, set) for the session; one fetch feeds all three of the
 * expanded row's consumers (provenance, lineup, draw history).
 */
import { deriveTaskSeed } from "@renaiss/replay-fair-set";
import type {
  DrawWitness,
  LineupCard,
  SetProvenanceData,
} from "../../types";
import { listPacks } from "./get-packs";
import { verifyFetch } from "./http";
import { tierDisplayMaps } from "./task-adapter";

export interface WireSetDrawInfo {
  checkoutId: number;
  /** The doc promises it, the shipped wire omits it — the adapter derives
   * the ordinal from checkoutId order either way. */
  setDrawSequence?: number;
  blockHash: string;
  /** β, 64 bytes. */
  randomness: string;
  /** π, 80 bytes — CARD RESOLUTION proof. */
  proof: string;
  /** drawRecord key (distinct from the set-creation key). */
  publicKeyHex: string;
}

export interface WireSetDetailCard {
  tokenId: string;
  /** The creation run's opaque snapshot tier id (stored numeric id as a
   * string, classified from the snapshotted edgeConfig — never the live
   * pack tier table). null for legacy runs with no stored config. */
  tier: string | null;
  /** Raw integer, 2 implied decimals — the value the Merkle leaf commits. */
  valueInUsd: number;
  /** 32-byte hex, left-zero-padded. */
  merkleSalt: string;
  /** Nullable in the schema, but every card of a served (fully drawn) set
   * has one. */
  drawInfo: WireSetDrawInfo | null;
}

export interface WireSetGenesis {
  algorithm: string;
  attempts: number;
  triggerTime: string;
  blockNumber: number;
  blockHash: string;
  /** 80 bytes — set CREATION proof. */
  proof: string;
  /** 32 bytes — createPack key. */
  publicKeyHex: string;
}

export interface WireSetDetailResponse {
  pack: { onChainPackId: string; name: string };
  /** Top-level name map (rule 1.7); [] only for legacy pre-snapshot sets. */
  cards: {
    tokenId: string;
    /** Legacy combined string — fallback only. */
    name: string;
    /** The graded-set line ("PSA 10 Gem Mint 2021 … Vmax Climax"). */
    setName?: string;
    /** The card's own headline ("#195 Zekrom"). */
    displayName?: string;
    imageUrl?: string;
  }[];
  set: {
    setId: number;
    /** Always "completed" — sealed sets 404 (rule 1.5). */
    status: "completed" | "active" | "upcoming";
    cardCount: number | null;
    /** null only for legacy pre-snapshot sets (not verifiable). Recomputed
     * from the live lineup at request time — the on-chain merkleRoots read
     * is the commitment to compare against (doc §3b.3). */
    merkleRoot: string | null;
    /** null for legacy sets with no task row. */
    genesis: WireSetGenesis | null;
    /** null only for legacy pre-snapshot sets; tokenId ASC. */
    cards?: WireSetDetailCard[] | null;
  };
}

/** One set's reveal, adapted for the expanded row's three consumers. */
export interface SetDetail {
  provenance: SetProvenanceData;
  lineup: LineupCard[];
  draws: DrawWitness[];
}

/** Results (and in-flight requests — an expand must not duplicate a
 * prefetch) cached per (pack, set); a completed set is immutable. */
const detailCache = new Map<string, Promise<SetDetail>>();

export function fetchSetDetail(
  onChainPackId: string,
  setId: number,
): Promise<SetDetail> {
  const key = `${onChainPackId}:${setId}`;
  const cached = detailCache.get(key);
  if (cached) return cached;
  const p = Promise.all([
    verifyFetch<WireSetDetailResponse>(`/packs/${onChainPackId}/sets/${setId}`),
    listPacks(),
  ])
    .then(([response, packs]) =>
      toSetDetail(
        response,
        onChainPackId,
        packs.find((pk) => pk.onChainPackId === onChainPackId)?.tiers ?? [],
      ),
    )
    .catch((e: unknown) => {
      detailCache.delete(key); // a failed fetch retries on the next call
      throw e;
    });
  detailCache.set(key, p);
  return p;
}

function toSetDetail(
  { cards, set }: WireSetDetailResponse,
  onChainPackId: string,
  packTiers: { tier: string; name: string }[],
): SetDetail {
  const cardMap = new Map(cards.map((c) => [c.tokenId, c]));
  // The pack's tier table arrives lowest tier first — re-key wire ids to
  // display letters by rank (highest → "s"), the same ladder the Packing
  // tab's adapter assigns by floor rank, so both tabs agree.
  const { letterOf, nameOf, lowestLetter } = tierDisplayMaps(packTiers);

  const wireCards = set.cards ?? [];

  const lineup: LineupCard[] = wireCards.map((c) => {
    const card = cardMap.get(c.tokenId);
    const tierName = c.tier !== null ? nameOf.get(c.tier) : undefined;
    return {
      tokenId: c.tokenId,
      // Split names render as two lines (set line above, card headline
      // below); the combined legacy string is the fallback.
      name: card?.displayName ?? card?.name ?? `Token ${c.tokenId}`,
      ...(card?.setName !== undefined ? { setName: card.setName } : {}),
      tier: c.tier !== null ? (letterOf.get(c.tier) ?? c.tier) : lowestLetter,
      ...(tierName !== undefined ? { tierName } : {}),
      valueInUsd: c.valueInUsd,
      merkleSalt: c.merkleSalt,
      // Every card of a served (fully drawn) set has been drawn.
      status: c.drawInfo ? ("token-released" as const) : ("created" as const),
      // Raw asset URL — renderers wrap it in the shop's image optimizer
      // with a downgrade path (lib/api/renaiss/image.ts).
      ...(card?.imageUrl ? { frontImageUrl: card.imageUrl } : {}),
    };
  });

  const draws: DrawWitness[] = wireCards
    .filter(
      (c): c is WireSetDetailCard & { drawInfo: WireSetDrawInfo } =>
        c.drawInfo !== null,
    )
    .sort((a, b) => a.drawInfo.checkoutId - b.drawInfo.checkoutId)
    .map((c, i) => ({
      checkoutId: c.drawInfo.checkoutId,
      // The shipped wire has no draw-sequence column — draws replay in
      // checkoutId order, so the ordinal IS the position in that order.
      setDrawSequence: c.drawInfo.setDrawSequence ?? i + 1,
      blockHash: c.drawInfo.blockHash,
      randomness: c.drawInfo.randomness,
      proof: c.drawInfo.proof,
      publicKeyHex: c.drawInfo.publicKeyHex,
      // There is no resolvedTokenId column — the draw nesting on its card
      // IS the resolution.
      resolvedTokenId: c.tokenId,
    }));

  const g = set.genesis;
  const provenance: SetProvenanceData = {
    merkleRoot: set.merkleRoot,
    genesis: g
      ? {
          algorithm: g.algorithm,
          attempts: g.attempts,
          triggerTime: g.triggerTime,
          blockNumber: g.blockNumber,
          blockHash: g.blockHash,
          onChainPackId,
          // α is derived, not served.
          seed: deriveTaskSeed(g.blockHash, g.blockNumber, onChainPackId, set.setId),
        }
      : null,
    leaves: wireCards.map((c) => ({
      tokenId: c.tokenId,
      salt: c.merkleSalt,
      valueInUsd: c.valueInUsd,
    })),
  };

  return { provenance, lineup, draws };
}
