/**
 * RFC 9381 §5.1 — `ECVRF_prove(SK, alpha_string)`.
 */

import { concatBytes } from "@noble/hashes/utils.js";
import { C_LEN, Point, q, Q_LEN, type EdwardsPoint } from "./ciphersuite";
import { intToString, pointToString } from "./data-conversions";
import {
  challengeGeneration,
  encodeToCurve,
  nonceGeneration,
} from "./auxiliary";
import { secretScalarAndPublicKey } from "./rfc8032-keys";

export type Proof = {
  /** pi_string — the 80-octet VRF proof. */
  piString: Uint8Array;
  /** Gamma — the proof's curve point, exposed for callers that publish it. */
  Gamma: EdwardsPoint;
};

/**
 * §5.1 `ECVRF_prove` steps:
 *
 * 1. Derive the secret scalar x and public key Y = x*B from SK (RFC 8032 §5.1.5)
 * 2. H = ECVRF_encode_to_curve(Y, alpha_string)   (salt = PK_string, §5.5)
 * 3. h_string = point_to_string(H)
 * 4. Gamma = x*H
 * 5. k = ECVRF_nonce_generation(SK, h_string)
 * 6. c = ECVRF_challenge_generation(Y, H, Gamma, k*B, k*H)
 * 7. s = (k + c*x) mod q
 * 8. pi_string = point_to_string(Gamma) || int_to_string(c, cLen) ||
 *                int_to_string(s, qLen)
 */
export function prove(SK: Uint8Array, alphaString: Uint8Array): Proof {
  const { x, Y } = secretScalarAndPublicKey(SK);

  const H = encodeToCurve(pointToString(Y), alphaString);
  const hString = pointToString(H);

  // multiplyUnsafe: scalars here may legitimately be 0 mod q with negligible
  // probability (~2^-252); the safe `multiply` throws on 0 instead of
  // returning the identity.
  const Gamma = H.multiplyUnsafe(x);

  const k = nonceGeneration(SK, hString);
  const c = challengeGeneration([
    Y,
    H,
    Gamma,
    Point.BASE.multiplyUnsafe(k),
    H.multiplyUnsafe(k),
  ]);
  const s = (k + c * x) % q;

  const piString = concatBytes(
    pointToString(Gamma),
    intToString(c, C_LEN),
    intToString(s, Q_LEN),
  );
  return { piString, Gamma };
}
