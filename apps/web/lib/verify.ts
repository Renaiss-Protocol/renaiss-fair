/**
 * REAL verification — nothing here is mocked.
 *
 * Runs the exact production draw math in the browser via
 * `@renaiss/verifiable-draw`:
 *
 *   α     = keccak256(tag ‖ blockHash ‖ onChainPackId ‖ checkoutId as 32-byte BE)
 *   β     = ECVRF_verify(PK, α, π)        // RFC 9381 §5.3, suite 0x04
 *   index = keccak256(β) mod remaining    // sampled without replacement,
 *                                         // lineup sorted by tokenId ASC,
 *                                         // draws in checkoutId order
 */
import type { Hex } from "viem";
import {
  deriveDrawSeed,
  deriveEligibleIndex,
  ecvrfVerifyBeta,
  SEED_DOMAIN_TAG,
} from "@renaiss/verifiable-draw";
import type { DrawWitness, LineupCard } from "./api/types";

// Re-exported under the names this app has always used.
export { SEED_DOMAIN_TAG, deriveEligibleIndex };
export { deriveDrawSeed as deriveSeed };

/** String-friendly alias: the app feeds untrusted (possibly malformed) input;
 * the package returns null for anything invalid, never throwing. */
export const ecvrfVerifyHex = (
  publicKeyHex: string,
  alphaHex: string,
  proofHex: string,
): Hex | null =>
  ecvrfVerifyBeta(publicKeyHex as Hex, alphaHex as Hex, proofHex as Hex);

export interface ReplayStep {
  ordinal: number;
  checkoutId: number;
  alpha: Hex;
  /** ECVRF proof π verified against the published public key (real check). */
  proofValid: boolean;
  /** β recomputed from π equals the stored randomness (real check). */
  betaMatches: boolean;
  randomness: string;
  eligibleCount: number;
  derivedIndex: number;
  pickedTokenId: string;
  /** Matches the operator's recorded resolution — replay did not diverge. */
  matchesRecord: boolean;
  isTarget: boolean;
}

export interface ReplayResult {
  steps: ReplayStep[];
  /** tokenIds sorted ASC — the initial eligible ordering (index 0 = lowest). */
  initialOrder: string[];
  allValid: boolean;
}

/**
 * Replays a set's draws up to and including `targetCheckoutId`
 * (or all draws when omitted), verifying every ECVRF proof along the way.
 * A draw carrying its own publicKeyHex (API mode — key rotation never
 * breaks historical rows) is verified against that key; `vrfPublicKeyHex`
 * is the fallback for draws without one (mock mode).
 */
export function replaySet(
  vrfPublicKeyHex: string | undefined,
  onChainPackId: string,
  lineup: LineupCard[],
  draws: DrawWitness[],
  targetCheckoutId?: number,
): ReplayResult {
  const initialOrder = [...lineup]
    .map((c) => c.tokenId)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

  const eligible = [...initialOrder];
  const ordered = [...draws].sort((a, b) => a.checkoutId - b.checkoutId);

  const steps: ReplayStep[] = [];
  for (const draw of ordered) {
    const alpha = deriveDrawSeed(draw.blockHash, onChainPackId, draw.checkoutId);
    const beta = ecvrfVerifyBeta(
      (draw.publicKeyHex ?? vrfPublicKeyHex ?? "0x") as Hex,
      alpha,
      draw.proof as Hex,
    );
    const proofValid = beta !== null;
    const betaMatches =
      proofValid && beta.toLowerCase() === draw.randomness.toLowerCase();

    const derivedIndex = deriveEligibleIndex(draw.randomness, eligible.length);
    const eligibleCount = eligible.length;
    const [picked] = eligible.splice(derivedIndex, 1);

    const isTarget = draw.checkoutId === targetCheckoutId;
    steps.push({
      ordinal: draw.setDrawSequence,
      checkoutId: draw.checkoutId,
      alpha,
      proofValid,
      betaMatches,
      randomness: draw.randomness,
      eligibleCount,
      derivedIndex,
      pickedTokenId: picked!,
      // No recorded resolution (a rip's prior draws) ⇒ nothing to diverge
      // from — the derived pick IS the resolution.
      matchesRecord:
        draw.resolvedTokenId === undefined || picked === draw.resolvedTokenId,
      isTarget,
    });
    if (isTarget) break;
  }

  return {
    steps,
    initialOrder,
    allValid: steps.every((s) => s.proofValid && s.betaMatches && s.matchesRecord),
  };
}
