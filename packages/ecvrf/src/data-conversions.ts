/**
 * RFC 9381 §5.5 data conversion primitives for the edwards25519 suites.
 * Only conversions defined by the spec live here:
 *   - int_to_string / string_to_int — little-endian per RFC 8032 §5.1.2
 *   - point_to_string / string_to_point — RFC 8032 §5.1.2 / §5.1.3
 */

import { Point, type EdwardsPoint } from "./ciphersuite";

const ZERO = BigInt(0);
const EIGHT = BigInt(8);
const BYTE = BigInt(0xff);

/** RFC 9381 §5.5 `int_to_string(x, len)` — little-endian octet string. */
export function intToString(x: bigint, len: number): Uint8Array {
  if (x < ZERO) throw new Error("intToString: negative integer");
  const out = new Uint8Array(len);
  let v = x;
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & BYTE);
    v >>= EIGHT;
  }
  if (v !== ZERO) throw new Error("intToString: integer too large for len");
  return out;
}

/** RFC 9381 §5.5 `string_to_int(s)` — octet string as a little-endian integer. */
export function stringToInt(s: Uint8Array): bigint {
  let x = ZERO;
  for (let i = s.length - 1; i >= 0; i--) {
    x = (x << EIGHT) | BigInt(s[i] ?? 0);
  }
  return x;
}

/** RFC 9381 §5.5 `point_to_string(P)` — RFC 8032 §5.1.2 encoding (32 octets). */
export function pointToString(P: EdwardsPoint): Uint8Array {
  return P.toBytes();
}

/**
 * RFC 9381 §5.5 `string_to_point(s)` — RFC 8032 §5.1.3 decoding.
 * Returns null (the spec's "INVALID") if s does not decode to a curve point.
 */
export function stringToPoint(s: Uint8Array): EdwardsPoint | null {
  try {
    return Point.fromBytes(s);
  } catch {
    return null;
  }
}
