/**
 * RFC 9381 §5.3 — `ECVRF_verify(PK_string, alpha_string, pi_string)`.
 *
 * This implementation always runs §5.4.5 ECVRF_validate_key (i.e. it supports
 * only the validate_key = TRUE option, as the spec permits — and requires
 * stating). Full uniqueness/collision resistance therefore holds even for
 * adversarially chosen public keys (§7.1.1).
 */

import { Point } from "./ciphersuite";
import { stringToPoint } from "./data-conversions";
import {
  challengeGeneration,
  decodeProof,
  encodeToCurve,
  validateKey,
} from "./auxiliary";
import { proofToHash } from "./proof-to-hash";

/**
 * §5.3 `ECVRF_verify` steps:
 *
 *  1–2.  Y = string_to_point(PK_string); INVALID → null
 *  3.    ECVRF_validate_key(Y); INVALID → null
 *  4–6.  (Gamma, c, s) = ECVRF_decode_proof(pi_string); INVALID → null
 *  7.    H = ECVRF_encode_to_curve(PK_string, alpha_string)
 *  8.    U = s*B - c*Y
 *  9.    V = s*H - c*Gamma
 *  10.   c' = ECVRF_challenge_generation(Y, H, Gamma, U, V)
 *  11.   c == c' → ("VALID", ECVRF_proof_to_hash(pi_string)), else INVALID
 *
 * Returns beta_string (64 octets) on VALID, or null for the spec's "INVALID".
 */
export function verify(
  pkString: Uint8Array,
  alphaString: Uint8Array,
  piString: Uint8Array,
): Uint8Array | null {
  const Y = stringToPoint(pkString);
  if (Y === null) return null;
  if (!validateKey(Y)) return null;

  const D = decodeProof(piString);
  if (D === null) return null;
  const { Gamma, c, s } = D;

  const H = encodeToCurve(pkString, alphaString);

  // multiplyUnsafe: c and s come from the (public, attacker-supplied) proof
  // and may be 0; the safe `multiply` throws on 0 instead of returning the
  // identity. No secrets are involved on the verify side.
  const U = Point.BASE.multiplyUnsafe(s).subtract(Y.multiplyUnsafe(c));
  const V = H.multiplyUnsafe(s).subtract(Gamma.multiplyUnsafe(c));

  const cPrime = challengeGeneration([Y, H, Gamma, U, V]);
  if (c !== cPrime) return null;
  return proofToHash(piString);
}
