/**
 * ECVRF-EDWARDS25519-SHA512-ELL2 — RFC 9381 Verifiable Random Function.
 *
 * This package contains ONLY the functions defined by the spec (RFC 9381,
 * plus the RFC 8032 key derivation it references), one module per section,
 * operating on bytes. Each function's docblock cites the spec name
 * (e.g. `nonceGeneration` = ECVRF_nonce_generation_RFC8032, §5.4.2.2).
 *
 * Conformance is pinned to the official RFC 9381 Appendix B.4 test vectors
 * in `__tests__/rfc9381-appendix-b4.test.ts`.
 *
 * Application-facing conveniences (hex encodings, β→stream expansion) belong
 * in the consuming app — keep this package 1:1 with the paper.
 */

export {
  BETA_LEN,
  C_LEN,
  COFACTOR,
  PI_LEN,
  PT_LEN,
  Q_LEN,
  SUITE_STRING,
  type EdwardsPoint,
} from "./ciphersuite";
export {
  intToString,
  pointToString,
  stringToInt,
  stringToPoint,
} from "./data-conversions";
export {
  challengeGeneration,
  decodeProof,
  encodeToCurve,
  nonceGeneration,
  validateKey,
  type DecodedProof,
} from "./auxiliary";
export { proofToHash } from "./proof-to-hash";
export { prove, type Proof } from "./prove";
export { verify } from "./verify";
export { keygen, secretScalarAndPublicKey } from "./rfc8032-keys";
