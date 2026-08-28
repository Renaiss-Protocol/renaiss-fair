/**
 * Replay layer — run the Fair Set Adaptive Algorithm's retry loop over one VRF
 * output β and record everything each attempt did, so a lineup can be rebuilt
 * and inspected attempt by attempt (what it selected, where it started in the
 * rng stream, why it was accepted or rejected).
 *
 * This sits on top of the core algorithm in @renaiss/algorithms. It is
 * kept in its own package because the per-attempt recording is an inspection
 * aid, not part of the algorithm itself — the algorithm packages stay clean,
 * self-contained implementations.
 */

import type { Hex } from "viem";
import type { AlgoConfig, AlgoToken, Rng } from "@renaiss/algorithms/algo-types";
import { randomValue, randomWordHex } from "@renaiss/algorithms/vrf-rng";
import { validateSelection } from "@renaiss/algorithms/validate";
import { fairSetRanked } from "@renaiss/algorithms/ranked";

export interface RngDraw {
  word: Hex;
  value: number;
}

/**
 * A β-seeded rng that records every draw it produces. Its index is the number
 * of draws taken so far, so the returned `draws` array is a full, replayable
 * log of the stream (word + value per rng() call).
 */
export const makeCountingRng = (
  beta: string,
): { rng: Rng; draws: RngDraw[] } => {
  const draws: RngDraw[] = [];
  const rng = () => {
    const word = randomWordHex(beta, draws.length);
    const value = randomValue(word);
    draws.push({ word, value });
    return value;
  };
  return { rng, draws };
};

/** Max attempts before the loop gives up on finding a valid selection. */
export const MAX_RETRIES_PER_ALGO = 30;

/**
 * The selection algorithm the loop re-runs each attempt. Matches the exported
 * shape of the @renaiss/algorithms designs (`fairSetRanked`, `fairSetTilt`) —
 * the fair API's `algo_used` tells a replayer which one a recorded run was
 * formed with.
 */
export type SelectFn = <T extends AlgoToken>(
  tokens: T[],
  config: AlgoConfig,
  rng: Rng,
) => T[];

export interface SelectionAttempt<T> {
  outcome: "success" | "error" | "invalid";
  detail?: string;
  /**
   * The tokens this attempt selected — present for FAILED attempts too, not
   * just the winner. MUST-SHOW: a run log renders each attempt's picked token
   * ids so a reader can see what every try produced and why it was rejected.
   * The core algorithm returns only a final lineup, so per-attempt picks are
   * captured here by replaying the one rng stream — do NOT drop this field.
   */
  picks: T[];
  ev: number;
  /**
   * Where this attempt began in the shared rng stream. The retry loop consumes
   * ONE stream, so offsets accumulate: attempt 0 starts at 0, and each later
   * attempt starts after all the draws its predecessors consumed (never back
   * at 0). `drawStart + drawsUsed` is the next attempt's `drawStart`.
   */
  drawStart: number;
  /** How many rng draws this attempt consumed. */
  drawsUsed: number;
}

export interface SelectionRun<T> {
  attempts: SelectionAttempt<T>[];
  /** Index of the accepted attempt, or -1 when every retry failed. */
  winnerIndex: number;
  /** Every rng() draw the whole run consumed, in order. */
  draws: RngDraw[];
}

/**
 * The retry loop: one rng stream from β, re-run the algorithm until a selection
 * validates (each retry consumes further draws, so every attempt is distinct
 * yet covered by the one proof), bounded by MAX_RETRIES_PER_ALGO. Deterministic
 * — replaying the same β always reproduces every attempt, in order.
 */
export function runSelectionLoop<T extends AlgoToken>(
  beta: string,
  tokens: T[],
  config: AlgoConfig,
  // The algorithm to re-run — defaults to fairSetRanked, the ranked design
  // ("Fair Set Adaptive Ranked" in the fair API). Pass the algorithm named by
  // the record's `algo_used` when replaying another one.
  selectFn: SelectFn = fairSetRanked,
): SelectionRun<T> {
  const { rng, draws } = makeCountingRng(beta);
  const attempts: SelectionAttempt<T>[] = [];

  for (let attempt = 0; attempt < MAX_RETRIES_PER_ALGO; attempt++) {
    // Snapshot the stream position BEFORE the attempt runs — this is the
    // attempt's rng offset, and it accumulates across the loop.
    const drawStart = draws.length;
    let picks: T[];
    try {
      picks = selectFn(tokens, config, rng);
    } catch (err) {
      attempts.push({
        outcome: "error",
        detail: err instanceof Error ? err.message : String(err),
        picks: [],
        ev: 0,
        drawStart,
        drawsUsed: draws.length - drawStart,
      });
      // An error is config-shaped, not seed-shaped — retrying can't help.
      break;
    }

    const validation = validateSelection(picks, config);
    if (validation.isValid) {
      attempts.push({
        outcome: "success",
        picks,
        ev: validation.expectedValueInUsd,
        drawStart,
        drawsUsed: draws.length - drawStart,
      });
      return { attempts, winnerIndex: attempts.length - 1, draws };
    }

    attempts.push({
      outcome: "invalid",
      detail: validation.errors.join("; "),
      picks,
      ev: validation.expectedValueInUsd,
      drawStart,
      drawsUsed: draws.length - drawStart,
    });
  }

  return { attempts, winnerIndex: -1, draws };
}
