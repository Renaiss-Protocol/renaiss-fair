/**
 * RFC 9381 §5.4 — ECVRF auxiliary functions.
 *
 * Each function implements its section's numbered steps for the
 * ECVRF-EDWARDS25519-SHA512-ELL2 ciphersuite (see ./ciphersuite.ts). The
 * spec's function name is cited in each docblock.
 */

import { ed25519_hasher } from "@noble/curves/ed25519.js";
import { concatBytes } from "@noble/hashes/utils.js";
import {
  C_LEN,
  COFACTOR,
  ENCODE_TO_CURVE_DST,
  Hash,
  PI_LEN,
  Point,
  PT_LEN,
  q,
  SUITE_STRING,
  type EdwardsPoint,
} from "./ciphersuite";
import { pointToString, stringToInt, stringToPoint } from "./data-conversions";

/**
 * §5.4.1.2 `ECVRF_encode_to_curve_h2c_suite(encode_to_curve_salt, alpha_string)`.
 *
 * 1. string_to_be_hashed = encode_to_curve_salt || alpha_string
 * 2. H = encode(string_to_be_hashed)
 * 3. Output H
 *
 * `encode` is the RFC 9380 §8.5 suite edwards25519_XMD:SHA-512_ELL2_NU_
 * (nonuniform, single Elligator2 evaluation, cofactor cleared), with
 * DST = "ECVRF_" || h2c_suite_ID_string || suite_string. For this ciphersuite,
 * encode_to_curve_salt = PK_string (§5.5).
 */
export function encodeToCurve(
  encodeToCurveSalt: Uint8Array,
  alphaString: Uint8Array,
): EdwardsPoint {
  return ed25519_hasher.encodeToCurve(
    concatBytes(encodeToCurveSalt, alphaString),
    { DST: ENCODE_TO_CURVE_DST },
  ) as EdwardsPoint;
}

/**
 * §5.4.2.2 `ECVRF_nonce_generation_RFC8032(SK, h_string)`.
 *
 * 1. hashed_sk_string = Hash(SK)
 * 2. truncated_hashed_sk_string = hashed_sk_string[32]...hashed_sk_string[63]
 * 3. k_string = Hash(truncated_hashed_sk_string || h_string)
 * 4. k = string_to_int(k_string) mod q
 */
export function nonceGeneration(SK: Uint8Array, hString: Uint8Array): bigint {
  const truncatedHashedSkString = Hash(SK).slice(32, 64);
  const kString = Hash(concatBytes(truncatedHashedSkString, hString));
  return stringToInt(kString) % q;
}

/**
 * §5.4.3 `ECVRF_challenge_generation(P1, P2, P3, P4, P5)`.
 *
 * c_string = Hash(suite_string || 0x02 ||
 *                 point_to_string(P1) || ... || point_to_string(P5) || 0x00),
 * truncated to the first cLen octets, interpreted as an integer.
 */
export function challengeGeneration(
  points: readonly [
    EdwardsPoint,
    EdwardsPoint,
    EdwardsPoint,
    EdwardsPoint,
    EdwardsPoint,
  ],
): bigint {
  const str = concatBytes(
    SUITE_STRING,
    new Uint8Array([0x02]),
    ...points.map(pointToString),
    new Uint8Array([0x00]),
  );
  const truncatedCString = Hash(str).slice(0, C_LEN);
  return stringToInt(truncatedCString);
}

export type DecodedProof = {
  Gamma: EdwardsPoint;
  c: bigint;
  s: bigint;
};

/**
 * §5.4.4 `ECVRF_decode_proof(pi_string)`.
 *
 * Splits pi into Gamma (ptLen) || c (cLen) || s (qLen), decodes Gamma, and
 * rejects s >= q. Returns null for the spec's "INVALID".
 */
export function decodeProof(piString: Uint8Array): DecodedProof | null {
  if (piString.length !== PI_LEN) return null;
  const gammaString = piString.slice(0, PT_LEN);
  const cString = piString.slice(PT_LEN, PT_LEN + C_LEN);
  const sString = piString.slice(PT_LEN + C_LEN, PI_LEN);
  const Gamma = stringToPoint(gammaString);
  if (Gamma === null) return null;
  const c = stringToInt(cString);
  const s = stringToInt(sString);
  if (s >= q) return null;
  return { Gamma, c, s };
}

/**
 * §5.4.5 `ECVRF_validate_key(Y)`.
 *
 * Rejects public keys of low order: valid iff cofactor*Y is not the identity.
 */
export function validateKey(Y: EdwardsPoint): boolean {
  return !Y.multiplyUnsafe(COFACTOR).equals(Point.ZERO);
}
