/**
 * @renaiss/replay-fair-set — the algorithm-agnostic layer around the fair-set
 * selection algorithms: the seed derivation that commits a build to public
 * inputs (./seed) and the retry/record loop that replays a whole run attempt
 * by attempt (./replay). The algorithms themselves — the ranked and tilt
 * designs — live in the peer package @renaiss/algorithms; the fair API's
 * `algo_used` names which one a recorded run was formed with.
 */

export { deriveTaskSeed, SEED_DOMAIN_TAG } from "./seed";
export {
  makeCountingRng,
  MAX_RETRIES_PER_ALGO,
  runSelectionLoop,
  type RngDraw,
  type SelectFn,
  type SelectionAttempt,
  type SelectionRun,
} from "./replay";
