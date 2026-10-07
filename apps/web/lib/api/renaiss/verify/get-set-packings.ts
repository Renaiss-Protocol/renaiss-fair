/**
 * Full endpoint:
 *   GET {NEXT_PUBLIC_RENAISS_API_URL}/v1/fair/packs/{packId}/sets/{setId}/packings
 *
 * One set's retry history — every run that targeted it. The pack-scoped list
 * (get-packing.ts) serves one row per set, its accepted run, and collapses the
 * rejections into `totalFailCount`; this is where those rejections live as
 * rows. Asked for with `status=failed`, so `pagination.total` is exactly the
 * count that list already showed.
 *
 * Same entry shape as the pack-scoped list — no token arrays; those still come
 * per run from /packings/{taskId} (get-packing-run.ts) on expand.
 */
import type { SetTask } from "@/components/task-rows";
import { tierNamesOf } from "./get-packs";
import { verifyFetch, type WirePagination } from "./http";
import { toTask, type WireRun } from "./task-adapter";

/** API page size (its default). One fetch = one page of retry rows. */
export const SET_PACKINGS_API_LIMIT = 10;

interface WireSetPackingsResponse {
  pack: { onChainPackId: string; name: string };
  packing: WireRun[];
  pagination: WirePagination;
}

export interface RetryRunPage {
  /** The set's fail count — the same number `totalFailCount` reported. */
  total: number;
  tasks: SetTask[];
}

/**
 * Row identity for a retry, in the negative space.
 *
 * `SetTask.id` keys row identity, the chart's open-node state and the
 * detail's `cfg-` anchor, so a retry must never collide with a pack-scoped
 * row (those are positive: `total - offset - i`). Derived from the set and
 * the row's absolute position, so a refetch of the same page produces the
 * same ids.
 */
const retryRowId = (setId: number, offset: number, i: number): number =>
  -(setId * 10_000 + offset + i + 1);

/** One page of a set's rejected runs, newest first, as row-ready tasks. */
export async function fetchSetPackingsPage(
  packId: string,
  setId: number,
  offset: number,
): Promise<RetryRunPage> {
  const [page, tierNames] = await Promise.all([
    verifyFetch<WireSetPackingsResponse>(
      `/packs/${packId}/sets/${setId}/packings`,
      { status: "failed", limit: SET_PACKINGS_API_LIMIT, offset },
    ),
    // The pack's tier id → display name map (cached /packs call).
    tierNamesOf(packId),
  ]);
  return {
    total: page.pagination.total,
    tasks: page.packing.map((run, i) =>
      toTask(
        run,
        page.pack.onChainPackId,
        retryRowId(setId, offset, i),
        tierNames,
      ),
    ),
  };
}
