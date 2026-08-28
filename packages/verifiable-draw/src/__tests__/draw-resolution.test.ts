/**
 * Draw resolution: the seed a single draw is committed to, and the
 * eligible-card index its verified randomness resolves to.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveDrawSeed,
  deriveEligibleIndex,
  ecvrfProofToHash,
  ecvrfProve,
} from "../index";

const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const PACK_ID = `0x${"11".repeat(32)}`;

describe("draw resolution", () => {
  test("the draw seed is deterministic and 32 bytes", () => {
    const seed = deriveDrawSeed(BLOCK_HASH, PACK_ID, 42);
    assert.match(seed, /^0x[0-9a-f]{64}$/);
    assert.equal(deriveDrawSeed(BLOCK_HASH, PACK_ID, 42), seed);
  });

  test("changing any seed input changes the seed", () => {
    const base = deriveDrawSeed(BLOCK_HASH, PACK_ID, 42);
    assert.notEqual(deriveDrawSeed(BLOCK_HASH, PACK_ID, 43), base);
    assert.notEqual(deriveDrawSeed(BLOCK_HASH, `0x${"22".repeat(32)}`, 42), base);
    assert.notEqual(deriveDrawSeed(`0x${"cd".repeat(32)}`, PACK_ID, 42), base);
  });

  test("the eligible index is deterministic and always within range", () => {
    const { proofHex } = ecvrfProve(
      `0x${"02".repeat(32)}`,
      deriveDrawSeed(BLOCK_HASH, PACK_ID, 1),
    );
    const beta = ecvrfProofToHash(proofHex);
    for (const count of [1, 2, 7, 500, 1000]) {
      const index = deriveEligibleIndex(beta, count);
      assert.ok(Number.isInteger(index));
      assert.ok(index >= 0, `index ${index} negative for count ${count}`);
      assert.ok(index < count, `index ${index} out of range for count ${count}`);
      assert.equal(deriveEligibleIndex(beta, count), index);
    }
  });

  test("a single-card pool always resolves to index 0", () => {
    const { proofHex } = ecvrfProve(
      `0x${"02".repeat(32)}`,
      deriveDrawSeed(BLOCK_HASH, PACK_ID, 2),
    );
    assert.equal(deriveEligibleIndex(ecvrfProofToHash(proofHex), 1), 0);
  });
});
