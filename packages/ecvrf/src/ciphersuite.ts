/**
 * RFC 9381 §5.5 — ciphersuite ECVRF-EDWARDS25519-SHA512-ELL2.
 *
 * Suite parameters, exactly as registered:
 *   - suite_string = 0x04
 *   - EC group: edwards25519 (RFC 8032 §5.1); fLen = qLen = ptLen = 32, cofactor = 8
 *   - cLen = 16
 *   - Hash = SHA-512 (hLen = 64)
 *   - int_to_string / string_to_int: little-endian (RFC 8032 §5.1.2)
 *   - point_to_string / string_to_point: RFC 8032 §5.1.2 / §5.1.3 encoding
 *   - ECVRF_encode_to_curve: §5.4.1.2 with
 *     h2c_suite_ID_string = "edwards25519_XMD:SHA-512_ELL2_NU_" (RFC 9380 §8.5)
 *   - ECVRF_nonce_generation: §5.4.2.2 (RFC 8032 style)
 *   - secret scalar / public key derivation: RFC 8032 §5.1.5
 *
 * Conformance is proven against the official RFC 9381 Appendix B.4 test
 * vectors (Examples 19–21) in `__tests__/rfc9381-appendix-b4.test.ts`.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";

export const SUITE_STRING = new Uint8Array([0x04]);

/** Challenge length in octets (§5.5: cLen = 16). */
export const C_LEN = 16;
/** Point encoding length in octets (§5.5: ptLen = fLen = 32). */
export const PT_LEN = 32;
/** Scalar encoding length in octets (§5.5: qLen = 32). */
export const Q_LEN = 32;
/** VRF proof length: ptLen + cLen + qLen = 80 octets. */
export const PI_LEN = PT_LEN + C_LEN + Q_LEN;
/** VRF output (beta) length: hLen of SHA-512 = 64 octets. */
export const BETA_LEN = 64;

export const COFACTOR = BigInt(8);

/** The suite hash function: SHA-512. */
export const Hash = sha512;

export const Point = ed25519.Point;
export type EdwardsPoint = ReturnType<typeof ed25519.Point.fromBytes>;

/** Prime order q of the edwards25519 group (RFC 8032 "L"). */
export const q = ed25519.Point.Fn.ORDER;

/**
 * Domain separation tag for ECVRF_encode_to_curve_h2c_suite (§5.4.1.2):
 * DST = "ECVRF_" || h2c_suite_ID_string || suite_string.
 */
export const ENCODE_TO_CURVE_DST = new Uint8Array([
  ...new TextEncoder().encode("ECVRF_edwards25519_XMD:SHA-512_ELL2_NU_"),
  ...SUITE_STRING,
]);
