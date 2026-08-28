/**
 * Which selection algorithm a recorded run replays with, keyed by the fair
 * API's `algo_used` — the PUBLIC REPLAY DISPATCH KEY. The API serves each
 * algorithm's un-renameable public alias: a name can never change once a set
 * has been formed under it, so these keys are stable forever. Unmapped names (e.g. the limited clone) are not publicly
 * replayable: resolve to null and say so, never fall back to the wrong
 * algorithm and report a false mismatch.
 */
import { fairSetRanked } from "@renaiss/algorithms/ranked";
import { fairSetTilt } from "@renaiss/algorithms/tilt";
import type { SelectFn } from "@renaiss/replay-fair-set";

const REPLAY_ALGOS: Record<string, SelectFn> = {
  // The names the fair API serves today.
  "Fair Set Ranked": fairSetRanked,
  "Fair Set Tilt": fairSetTilt as SelectFn,
  // deprecated
  "Fair Set Adaptive Ranked": fairSetRanked,
  "Fair Set Adaptive Tilt": fairSetTilt as SelectFn,
  "Fair Set Adaptive Algorithm": fairSetRanked,
};

/**
 * The algorithm to replay a run recorded under `algoUsed`, or null when this
 * build cannot replay it. A null `algoUsed` (legacy rows without the column)
 * replays through Ranked — the only algorithm that existed then.
 */
export const replayAlgoFor = (algoUsed: string | null): SelectFn | null =>
  algoUsed === null ? fairSetRanked : (REPLAY_ALGOS[algoUsed] ?? null);
