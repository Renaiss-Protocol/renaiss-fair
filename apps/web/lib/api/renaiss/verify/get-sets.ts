/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/packs/{packId}/sets
 *
 * The Sets tab's browse list — one pack's fully drawn sets, newest first
 * (setId DESC), a few KB per page: setId, cardCount and the genesis record,
 * NO lineup data. The heavy reveal (cards, salts, draw proofs, root) lives
 * on /sets/set (get-sets-detail.ts), fetched on expand. Sealed
 * (active/upcoming) sets are never listed (rule 1.5) — every row is
 * completed and §3b will serve it in full. Requires onChainPackId,
 * edge-cached 60s.
 */
import type { SetSummary } from "../../types";
import type { WireSetGenesis } from "./get-sets-detail";
import { verifyFetch, type WirePagination } from "./http";

/** API page size (its max — conveniently exactly one UI page of rows). */
export const SETS_API_LIMIT = 10;

/** A fully drawn set — the browse rows proper, and all `pagination` counts. */
interface WireSoldSetEntry {
  status: "sold";
  setId: number;
  cardCount: number;
  /** null for legacy sets with no recorded creation run. The expanded row
   * re-reads it off /sets/set, so the list copy goes unused here. */
  genesis: WireSetGenesis | null;
}

/** The ONE set the machine is selling from, prepended on the first page only
 * and never counted by `pagination`. Names-only: everything else about it
 * stays behind the reveal watermark until sellout. */
interface WireActiveSetEntry {
  status: "active";
  setId: number;
  /** The pack's on-chain id. */
  packId: string;
  merkleRoot: string;
  algorithm: string;
}

type WireSetListEntry = WireSoldSetEntry | WireActiveSetEntry;

interface WireSetsResponse {
  pack: {
    onChainPackId: string;
    name: string;
    tiers: { tier: string; name: string }[];
  };
  sets: WireSetListEntry[];
  pagination: WirePagination;
}

/** The active row as the chart consumes it — same fields, minus the
 * discriminant the union needed on the wire. */
export interface ActiveSetSummary {
  setId: number;
  packId: string;
  merkleRoot: string;
  algorithm: string;
}

export interface SetsPage {
  total: number;
  sets: SetSummary[];
  /** Only on the first page, and only while the machine has a live set. */
  active: ActiveSetSummary | null;
}

/** One /verify/sets page (newest first) as row-ready summaries. */
export async function fetchSetsPage(
  onChainPackId: string,
  offset: number,
): Promise<SetsPage> {
  const page = await verifyFetch<WireSetsResponse>(
    `/packs/${onChainPackId}/sets`,
    { limit: SETS_API_LIMIT, offset },
  );
  const active = page.sets.find(
    (s): s is WireActiveSetEntry => s.status === "active",
  );
  return {
    total: page.pagination.total,
    sets: page.sets
      .filter((s): s is WireSoldSetEntry => s.status === "sold")
      .map((s) => ({
        // "sold" is the wire vocabulary; the site's row status stays
        // "completed" (SetSummary is shared with mock mode).
        setId: s.setId,
        status: "completed" as const,
        cardCount: s.cardCount,
      })),
    active: active
      ? {
          setId: active.setId,
          packId: active.packId,
          merkleRoot: active.merkleRoot,
          algorithm: active.algorithm,
        }
      : null,
  };
}
