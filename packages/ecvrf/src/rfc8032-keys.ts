/**
 * RFC 8032 §5.1.5 — key generation for the edwards25519 suites.
 *
 * RFC 9381 §5.5: "The secret key and generation of the secret scalar and the
 * public key are specified in Section 5.1.5 of [RFC8032]."
 */

import { randomBytes } from "@noble/hashes/utils.js";
import { Hash, Point, q, type EdwardsPoint } from "./ciphersuite";
import { stringToInt } from "./data-conversions";

export type SecretExpansion = {
  /** The VRF secret scalar x (already reduced mod q — see note below). */
  x: bigint;
  /** The VRF public key point Y = x*B. */
  Y: EdwardsPoint;
};

/**
 * RFC 8032 §5.1.5 steps 1–3: hash the 32-octet secret key with SHA-512,
 * clamp the lower half into the secret scalar x, and derive Y = x*B.
 *
 * Note: the clamped scalar can exceed the group order q. Since B generates
 * the prime-order-q subgroup, x*B == (x mod q)*B, so we store x mod q; this
 * also keeps s = (k + c*x) mod q identical to the spec's arithmetic.
 */
export function secretScalarAndPublicKey(SK: Uint8Array): SecretExpansion {
  if (SK.length !== 32) {
    throw new Error("RFC 8032 secret key must be 32 octets");
  }
  const h = Hash(SK);
  const head = h.slice(0, 32);
  head[0] = (head[0] ?? 0) & 0xf8;
  head[31] = ((head[31] ?? 0) & 0x7f) | 0x40;
  const x = stringToInt(head) % q;
  return { x, Y: Point.BASE.multiply(x) };
}

/** Generate a fresh keypair. Any 32-octet string is a valid RFC 8032 secret key. */
export function keygen(): { SK: Uint8Array; pkString: Uint8Array } {
  const SK = randomBytes(32);
  const { Y } = secretScalarAndPublicKey(SK);
  return { SK, pkString: Y.toBytes() };
}
