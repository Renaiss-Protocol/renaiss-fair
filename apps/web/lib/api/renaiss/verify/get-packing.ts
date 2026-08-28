/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/packs/{packId}/packings
 *
 * The Packing tab's browse list — run records (status, config, attempt
 * outcomes, EV) with NO token arrays; those live on /packings/{taskId}
 * (get-packing-run.ts), fetched on expand. Paged newest first
 * (startedAt DESC), edge-cached 60s.
 */
import type { SetTask } from "@/components/task-rows";
import { tierNamesOf } from "./get-packs";
import { verifyFetch, type WirePagination } from "./http";
import { toTask, type WireRun } from "./task-adapter";

/** API page size (its max; one fetch spans two UI pages of 10 rows). */
export const PACKING_API_LIMIT = 20;

/** The active set's accepted creation run, prepended on the first page only
 * and never counted by `pagination`. Names-only: the run's config, EV,
 * attempts, and artifacts stay behind the reveal watermark until sellout —
 * its /packings/{taskId} detail 404s like an unknown run, so this row must
 * never be expandable. */
interface WireActiveTaskEntry {
  status: "active";
  taskId: string;
  /** The set the run packed — the one the machine is selling from. */
  setId: number;
  algorithm: string;
}

type WirePackingEntry = WireRun | WireActiveTaskEntry;

interface WirePackingResponse {
  pack: { onChainPackId: string; name: string };
  packing: WirePackingEntry[];
  pagination: WirePagination;
}

/** The active row as the chart consumes it. */
export interface ActiveTaskSummary {
  taskId: string;
  setId: number;
  algorithm: string;
}

export interface PackingRunPage {
  total: number;
  tasks: SetTask[];
  /** Only on the first page, and only while the machine has a live set. */
  active: ActiveTaskSummary | null;
}

const isActive = (e: WirePackingEntry): e is WireActiveTaskEntry =>
  e.status === "active";

/** One /verify/packing page (newest first) as row-ready tasks. */
export async function fetchPackingPage(
  packId: string,
  offset: number,
): Promise<PackingRunPage> {
  const [page, tierNames] = await Promise.all([
    verifyFetch<WirePackingResponse>(`/packs/${packId}/packings`, {
      limit: PACKING_API_LIMIT,
      offset,
    }),
    // The pack's tier id → display name map (cached /packs call).
    tierNamesOf(packId),
  ]);
  const active = page.packing.find(isActive);
  return {
    total: page.pagination.total,
    tasks: page.packing
      // The active row rides outside the pagination, so the finished runs
      // alone carry the numbering.
      .filter((e): e is WireRun => !isActive(e))
      .map((run, i) =>
        // Newest run = highest id, stable across pages: total-1 at offset 0.
        toTask(
          run,
          page.pack.onChainPackId,
          page.pagination.total - offset - i,
          tierNames,
        ),
      ),
    active: active
      ? { taskId: active.taskId, setId: active.setId, algorithm: active.algorithm }
      : null,
  };
}
