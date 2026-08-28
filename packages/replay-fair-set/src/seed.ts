/**
 * Seed derivation — the public inputs that commit a build to one draw:
 *
 *   seed α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂)
 *
 * α is what the operator's VRF key signs; the resulting proof's output β feeds
 * the rng stream (rngFromRandomness in @renaiss/algorithms) that the
 * selection algorithm consumes.
 */

import {
  concat,
  keccak256,
  numberToHex,
  stringToHex,
  type Hex,
} from "viem";

/** Domain-separation tag that binds α to this derivation. */
export const SEED_DOMAIN_TAG = "renaiss-gacha-v3-1";
const SEED_DOMAIN_TAG_HEX = stringToHex(SEED_DOMAIN_TAG);

/** α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ onChainPackId ‖ setId₃₂). */
export const deriveTaskSeed = (
  blockHash: string,
  blockNumber: number,
  onChainPackId: string,
  setId: number,
): Hex =>
  keccak256(
    concat([
      SEED_DOMAIN_TAG_HEX,
      blockHash as Hex,
      numberToHex(blockNumber, { size: 32 }),
      onChainPackId as Hex,
      numberToHex(setId, { size: 32 }),
    ]),
  );
