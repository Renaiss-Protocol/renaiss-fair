/**
 * RFC 9381 §5.2 — `ECVRF_proof_to_hash(pi_string)`.
 *
 * Important note (from the spec): run this only on a pi_string known to have
 * been produced by ECVRF_prove, or from within ECVRF_verify.
 */

import { concatBytes } from "@noble/hashes/utils.js";
import { COFACTOR, Hash, SUITE_STRING } from "./ciphersuite";
import { pointToString } from "./data-conversions";
import { decodeProof } from "./auxiliary";

/**
 * §5.2 `ECVRF_proof_to_hash` steps:
 *
 * 1–3. (Gamma, c, s) = ECVRF_decode_proof(pi_string); INVALID → null
 * 4–6. beta_string = Hash(suite_string || 0x03 ||
 *                         point_to_string(cofactor * Gamma) || 0x00)
 *
 * Returns the 64-octet beta_string, or null for the spec's "INVALID".
 */
export function proofToHash(piString: Uint8Array): Uint8Array | null {
  const D = decodeProof(piString);
  if (D === null) return null;
  const { Gamma } = D;
  return Hash(
    concatBytes(
      SUITE_STRING,
      new Uint8Array([0x03]),
      pointToString(Gamma.multiplyUnsafe(COFACTOR)),
      new Uint8Array([0x00]),
    ),
  );
}
