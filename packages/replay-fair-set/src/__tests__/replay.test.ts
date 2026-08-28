/**
 * runSelectionLoop — the recorded retry loop over one randomness stream.
 *
 * One VRF output β drives the whole run: each retry keeps consuming the same
 * stream, every draw is logged, and every attempt records what it picked and
 * why it was accepted or rejected — so a full run can be rebuilt and audited
 * attempt by attempt from β alone.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomValue, randomWordHex } from "@renaiss/algorithms/vrf-rng";
import { MAX_RETRIES_PER_ALGO, runSelectionLoop } from "../replay";
import {
  averageValue,
  makeSyntheticConfig,
  makeSyntheticPool,
  makeVrfDraw,
} from "./helpers";

describe("runSelectionLoop", () => {
  test("returns the first accepted attempt with a full, recomputable draw history", () => {
    const beta = makeVrfDraw().randomnessHex;
    const config = makeSyntheticConfig();
    const run = runSelectionLoop(beta, makeSyntheticPool(), config);

    assert.ok(run.winnerIndex >= 0, "the run must find a valid selection");
    assert.equal(run.winnerIndex, run.attempts.length - 1);

    const winner = run.attempts[run.winnerIndex]!;
    assert.equal(winner.outcome, "success");
    assert.ok(winner.picks.length > 0);
    assert.ok(winner.ev >= config.lowerExpectedValueInUsd);
    assert.ok(winner.ev <= config.upperExpectedValueInUsd);
    assert.equal(winner.ev, averageValue(winner.picks));

    // Every logged draw is recomputable from β by its index alone.
    assert.ok(run.draws.length > 0);
    run.draws.forEach((draw, i) => {
      assert.equal(draw.word, randomWordHex(beta, i));
      assert.equal(draw.value, randomValue(draw.word));
    });

    // Attempts tile the one shared stream: each begins exactly where its
    // predecessor stopped, and together they account for every draw.
    let expectedStart = 0;
    for (const attempt of run.attempts) {
      assert.equal(attempt.drawStart, expectedStart);
      expectedStart += attempt.drawsUsed;
    }
    assert.equal(expectedStart, run.draws.length);
  });

  test("stops after the maximum number of retries and reports the run as not accepted", () => {
    // The upper tier's minimum (7) exceeds the 6 upper-tier tokens the pool
    // holds, so the acceptance check rejects every attempt.
    const run = runSelectionLoop(
      makeVrfDraw().randomnessHex,
      makeSyntheticPool(),
      makeSyntheticConfig({
        tiers: [
          {
            tier: "0",
            floorValueInUsd: 0,
            minNumberOfTokens: 1,
            maxNumberOfTokens: 9999,
            targetNumberOfTokensPercentage: 70,
          },
          {
            tier: "1",
            floorValueInUsd: 300,
            minNumberOfTokens: 7,
            maxNumberOfTokens: 9999,
            targetNumberOfTokensPercentage: 30,
          },
        ],
      }),
    );

    assert.equal(run.winnerIndex, -1);
    assert.equal(run.attempts.length, MAX_RETRIES_PER_ALGO);
    for (const attempt of run.attempts) {
      assert.equal(attempt.outcome, "invalid");
      assert.ok(attempt.detail);
    }
  });

  test("stops immediately when the configuration itself is invalid", () => {
    // A lower bound above the target is a config error, not bad luck — the
    // loop must record one error attempt and stop retrying.
    const run = runSelectionLoop(
      makeVrfDraw().randomnessHex,
      makeSyntheticPool(),
      makeSyntheticConfig({ lowerExpectedValueInUsd: 250 }),
    );

    assert.equal(run.winnerIndex, -1);
    assert.equal(run.attempts.length, 1);
    assert.equal(run.attempts[0]!.outcome, "error");
    assert.ok(run.attempts[0]!.detail);
  });
});
