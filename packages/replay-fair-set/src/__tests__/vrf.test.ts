/**
 * The VRF pipeline: seed derivation, the randomness stream, and verification
 * from public data.
 *
 * The seed α commits a draw to public inputs (block hash + number, pack id,
 * set id); the VRF proof π over α yields the randomness β; and β expands into
 * the float stream the algorithm consumes. These tests pin the fairness
 * properties of that pipeline — deterministic, verifiable, and bound to its
 * inputs — and then walk the transparency claim end to end: a verifier who
 * holds only the public key, α, and π reconstructs the identical selection,
 * while tampered proofs and wrong keys are rejected.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import {
  pointToString,
  secretScalarAndPublicKey,
  verify,
} from "@renaiss/ecvrf";
import type { AlgoConfig, AlgoToken, Rng } from "@renaiss/algorithms/algo-types";
import { randomValue, randomWordHex, rngFromRandomness } from "@renaiss/algorithms/vrf-rng";
import { fairSetRanked } from "@renaiss/algorithms/ranked";
import { makeVrfDraw, PK_HEX } from "./helpers";

// A realistic, fully synthetic pool: 85 base-tier tokens, 13 mid-tier, 2 top.
const buildPool = (): AlgoToken[] => {
  const tokens: AlgoToken[] = [];
  let id = 1;
  for (let i = 0; i < 85; i++)
    tokens.push({ tokenId: String(id++), valueInUsd: 100 + i });
  for (let i = 0; i < 13; i++)
    tokens.push({ tokenId: String(id++), valueInUsd: 223 + i * 50 });
  for (let i = 0; i < 2; i++)
    tokens.push({ tokenId: String(id++), valueInUsd: 2001 + i * 500 });
  return tokens;
};

const buildConfig = (): AlgoConfig => ({
  targetExpectedValueInUsd: 220,
  lowerExpectedValueInUsd: 200,
  upperExpectedValueInUsd: 230,
  lowerNumberOfTokensInNewSet: 50,
  upperNumberOfTokensInNewSet: 50,
  tiers: [
    {
      tier: "0",
      floorValueInUsd: 100,
      minNumberOfTokens: 1,
      maxNumberOfTokens: 9999,
      targetNumberOfTokensPercentage: 85,
    },
    {
      tier: "1",
      floorValueInUsd: 223,
      minNumberOfTokens: 1,
      maxNumberOfTokens: 999,
      targetNumberOfTokensPercentage: 14,
    },
    {
      tier: "2",
      floorValueInUsd: 2001,
      minNumberOfTokens: 1,
      maxNumberOfTokens: 1,
      targetNumberOfTokensPercentage: 1,
    },
  ],
});

const drawSelection = (rng: Rng): string[] =>
  fairSetRanked(buildPool(), buildConfig(), rng).map((t) => t.tokenId);

describe("the VRF pipeline", () => {
  test("identical inputs produce an identical seed, proof, and randomness stream", () => {
    const a = makeVrfDraw();
    const b = makeVrfDraw();
    assert.equal(a.seedHex, b.seedHex);
    assert.equal(a.proofHex, b.proofHex);
    assert.equal(a.randomnessHex, b.randomnessHex);
    const streamA = Array.from({ length: 6 }, () => a.rng());
    const streamB = Array.from({ length: 6 }, () => b.rng());
    assert.deepEqual(streamA, streamB);
  });

  test("changing any public seed input changes the entire draw", () => {
    const base = makeVrfDraw();
    for (const variant of [
      makeVrfDraw({ setId: 2 }),
      makeVrfDraw({ packId: `0x${"22".repeat(32)}` }),
    ]) {
      assert.notEqual(variant.seedHex, base.seedHex);
      assert.notEqual(variant.randomnessHex, base.randomnessHex);
      assert.notEqual(variant.rng(), rngFromRandomness(base.randomnessHex)());
    }
  });

  test("every value in the stream lies in [0, 1)", () => {
    const rng = rngFromRandomness(makeVrfDraw().randomnessHex);
    for (let i = 0; i < 200; i++) {
      const value = rng();
      assert.ok(value >= 0, `draw ${i} is ${value}, below 0`);
      assert.ok(value < 1, `draw ${i} is ${value}, not below 1`);
    }
  });

  test("a full selection is reconstructed from only the public key, seed, and proof", () => {
    // ── prover (holds the secret key) ──
    // Record every value the algorithm pulls while generating the selection.
    const draw = makeVrfDraw();
    const drawn: number[] = [];
    const recordingRng = () => {
      const value = draw.rng();
      drawn.push(value);
      return value;
    };
    const generated = drawSelection(recordingRng);
    assert.ok(generated.length > 0);
    assert.ok(drawn.length > 0);

    // The operator publishes only { public key, α, π } — never the secret key.
    const published = {
      publicKeyHex: PK_HEX,
      alphaHex: draw.seedHex,
      proofHex: draw.proofHex,
    };

    // ── verifier (holds only the published values) ──
    const beta = verify(
      hexToBytes(published.publicKeyHex),
      hexToBytes(published.alphaHex),
      hexToBytes(published.proofHex),
    );
    assert.notEqual(beta, null, "the published proof must verify");
    const betaHex = bytesToHex(beta!);

    // Each individual draw is independently recomputable from β by its index
    // alone — no per-draw proof needed.
    drawn.forEach((value, i) => {
      assert.equal(value, randomValue(randomWordHex(betaHex, i)));
    });

    // Replaying the same algorithm over the same public input reconstructs
    // the identical selection.
    assert.deepEqual(drawSelection(rngFromRandomness(betaHex)), generated);
  });

  test("a tampered proof or wrong public key is rejected", () => {
    const draw = makeVrfDraw();

    const lastNibble = draw.proofHex.endsWith("0") ? "1" : "0";
    const tampered = `${draw.proofHex.slice(0, -1)}${lastNibble}` as Hex;
    assert.equal(
      verify(hexToBytes(PK_HEX), hexToBytes(draw.seedHex), hexToBytes(tampered)),
      null,
    );

    const wrongPk = pointToString(
      secretScalarAndPublicKey(hexToBytes(`0x${"03".repeat(32)}`)).Y,
    );
    assert.equal(
      verify(wrongPk, hexToBytes(draw.seedHex), hexToBytes(draw.proofHex)),
      null,
    );
  });
});
