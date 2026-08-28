/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/packs
 *
 * The pack picker — every pack with verifiable history (≥1 formed set or
 * ≥1 finished creation run). The Sets and Packing tabs both require an
 * onChainPackId from here. One call on load, edge-cached 300s.
 */
import type { PackSummary } from "../../types";
import { verifyFetch } from "./http";

interface WirePacksResponse {
  packs: {
    onChainPackId: string;
    name: string;
    imageUrl: string;
    /** Snapshot tier id → display name ("0" → "common"). */
    tiers: { tier: string; name: string }[];
    /** Sets fully drawn — browsable reveals. */
    allCardDrawnSetCount: number;
  }[];
}

let packsCache: Promise<PackSummary[]> | null = null;

/** Every pack with verifiable history. One call, cached for the session. */
export function listPacks(): Promise<PackSummary[]> {
  packsCache ??= verifyFetch<WirePacksResponse>("/packs")
    .then((r) =>
      r.packs.map((p) => ({
        // The wire has no separate display id — the on-chain id is the id.
        packId: p.onChainPackId,
        onChainPackId: p.onChainPackId,
        name: p.name,
        imgUrl: p.imageUrl,
        tiers: p.tiers,
        drawnSetCount: p.allCardDrawnSetCount,
        // The verify contract serves no lifecycle status, set totals, or
        // backdrop art — those chips render only when present.
        bgUrl: "",
      })),
    )
    .catch((e: unknown) => {
      packsCache = null; // a failed load retries on the next call
      throw e;
    });
  return packsCache;
}

/** A pack's snapshot-tier-id → display-name map ("0" → "common"). Empty for
 * unknown packs — callers degrade to letters only. */
export async function tierNamesOf(
  onChainPackId: string,
): Promise<Map<string, string>> {
  const packs = await listPacks();
  const pack = packs.find((p) => p.onChainPackId === onChainPackId);
  return new Map((pack?.tiers ?? []).map((t) => [t.tier, t.name]));
}
