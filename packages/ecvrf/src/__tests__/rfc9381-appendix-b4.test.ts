/**
 * Conformance suite — RFC 9381 Appendix B.4
 * (ECVRF-EDWARDS25519-SHA512-ELL2, suite_string = 0x04).
 *
 * https://www.rfc-editor.org/rfc/rfc9381.html#appendix-B.4
 *
 * RFC 9381's Appendix B lists test vectors for four ciphersuites; only the
 * three in B.4 (Examples 19-21) apply to this package. Examples 10-18 belong
 * to the other suites (P-256 curves, or the try-and-increment hash-to-curve)
 * and by design produce different proofs for the same keys and inputs, so
 * they cannot exercise this implementation.
 *
 * The three official example key pairs (the RFC 8032 test keys reused by
 * RFC 9381) are checked here. Every value the RFC publishes for Examples
 * 19-21 is pinned byte-for-byte: the public key, the encode_to_curve output
 * H, the 80-byte proof π, and the output β. Reproducing the RFC's exact
 * proofs for known keys and inputs is the definitive statement that this
 * code IS the standard, not a lookalike; each example also exercises the
 * full prove → verify → proof_to_hash round trip. Negative cases confirm
 * the spec's "INVALID" (null) results.
 *
 * Run: `pnpm --filter @renaiss/ecvrf test`
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  encodeToCurve,
  decodeProof,
  pointToString,
  proofToHash,
  prove,
  secretScalarAndPublicKey,
  stringToPoint,
  verify,
} from "../index";

const hexToBytes = (hex: string): Uint8Array =>
  hex.length === 0
    ? new Uint8Array(0)
    : Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Vector {
  name: string;
  /** 32-octet RFC 8032 secret key (hex). */
  sk: string;
  /** Expected public key Y = x·B, point_to_string (hex). */
  pk: string;
  /** alpha_string (hex; "" = empty message). */
  alpha: string;
  /** Expected ECVRF_encode_to_curve output H, point_to_string (hex). */
  h?: string;
  /** Expected 80-octet proof π (hex). Present where pinned to the RFC. */
  pi?: string;
  /** Expected 64-octet output β (hex). Present where pinned to the RFC. */
  beta?: string;
}

// Appendix B.4, Examples 19–21 — every published value, pinned verbatim.
const VECTORS: Vector[] = [
  {
    name: "Example 19 (alpha empty)",
    sk: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    pk: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    alpha: "",
    h: "b8066ebbb706c72b64390324e4a3276f129569eab100c26b9f05011200c1bad9",
    pi: "7d9c633ffeee27349264cf5c667579fc583b4bda63ab71d001f89c10003ab46f14adf9a3cd8b8412d9038531e865c341cafa73589b023d14311c331a9ad15ff2fb37831e00f0acaa6d73bc9997b06501",
    beta: "9d574bf9b8302ec0fc1e21c3ec5368269527b87b462ce36dab2d14ccf80c53cccf6758f058c5b1c856b116388152bbe509ee3b9ecfe63d93c3b4346c1fbc6c54",
  },
  {
    name: "Example 20 (alpha = 72)",
    sk: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    pk: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    alpha: "72",
    h: "76ac3ccb86158a9104dff819b1ca293426d305fd76b39b13c9356d9b58c08e57",
    pi: "47b327393ff2dd81336f8a2ef10339112401253b3c714eeda879f12c509072ef055b48372bb82efbdce8e10c8cb9a2f9d60e93908f93df1623ad78a86a028d6bc064dbfc75a6a57379ef855dc6733801",
    beta: "38561d6b77b71d30eb97a062168ae12b667ce5c28caccdf76bc88e093e4635987cd96814ce55b4689b3dd2947f80e59aac7b7675f8083865b46c89b2ce9cc735",
  },
  {
    name: "Example 21 (alpha = af82)",
    sk: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    pk: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    alpha: "af82",
    h: "13d2a8b5ca32db7e98094a61f656a08c6c964344e058879a386a947a4e189ed1",
    pi: "926e895d308f5e328e7aa159c06eddbe56d06846abf5d98c2512235eaa57fdce35b46edfc655bc828d44ad09d1150f31374e7ef73027e14760d42e77341fe05467bb286cc2c9d7fde29120a0b2320d04",
    beta: "121b7f9b9aaaa29099fc04a94ba52784d44eac976dd1a3cca458733be5cd090a7b5fbd148444f17f8daf1fb55cb04b1ae85a626e30a54b4b0f8abf4a43314a58",
  },
];

for (const v of VECTORS) {
  const sk = hexToBytes(v.sk);
  const pk = hexToBytes(v.pk);
  const alpha = hexToBytes(v.alpha);

  test(`${v.name} — public key Y = x·B (RFC 8032 §5.1.5)`, () => {
    const { Y } = secretScalarAndPublicKey(sk);
    assert.equal(bytesToHex(pointToString(Y)), v.pk);
  });

  if (v.h !== undefined) {
    test(`${v.name} — encode_to_curve output H (§5.4.1.2)`, () => {
      const H = encodeToCurve(pk, alpha);
      assert.equal(bytesToHex(pointToString(H)), v.h);
    });
  }

  if (v.pi !== undefined) {
    test(`${v.name} — proof π matches the RFC byte-for-byte (§5.1)`, () => {
      const { piString } = prove(sk, alpha);
      assert.equal(bytesToHex(piString), v.pi);
    });
  }

  if (v.pi !== undefined && v.beta !== undefined) {
    test(`${v.name} — proof_to_hash β matches the RFC (§5.2)`, () => {
      const beta = proofToHash(hexToBytes(v.pi!));
      assert.ok(beta !== null);
      assert.equal(bytesToHex(beta), v.beta);
    });

    test(`${v.name} — verify(PK, alpha, π) returns the RFC β (§5.3)`, () => {
      const beta = verify(pk, alpha, hexToBytes(v.pi!));
      assert.ok(beta !== null);
      assert.equal(bytesToHex(beta), v.beta);
    });
  }

  test(`${v.name} — prove → verify → proof_to_hash round trip`, () => {
    const { piString } = prove(sk, alpha);
    const verified = verify(pk, alpha, piString);
    assert.ok(verified !== null, "self-produced proof must verify");
    const hashed = proofToHash(piString);
    assert.ok(hashed !== null);
    assert.deepEqual(verified, hashed);
  });
}

// ── the spec's "INVALID" (null) paths ───────────────────────────────────────

const EX19 = VECTORS[0]!;

test("verify rejects a proof with a tampered final octet", () => {
  const pi = hexToBytes(EX19.pi!);
  pi[pi.length - 1] = (pi[pi.length - 1]! ^ 0x01) & 0xff; // flip one bit of s
  assert.equal(verify(hexToBytes(EX19.pk), new Uint8Array(0), pi), null);
});

test("verify rejects a valid proof under the wrong alpha", () => {
  const pi = hexToBytes(EX19.pi!);
  assert.equal(
    verify(hexToBytes(EX19.pk), hexToBytes("deadbeef"), pi),
    null,
  );
});

test("verify rejects a valid proof under the wrong public key", () => {
  const pi = hexToBytes(EX19.pi!);
  assert.equal(verify(hexToBytes(VECTORS[1]!.pk), new Uint8Array(0), pi), null);
});

test("decodeProof rejects a wrong-length proof (§5.4.4)", () => {
  assert.equal(decodeProof(hexToBytes(EX19.pi!).slice(0, 79)), null);
});

test("stringToPoint returns null on a non-canonical point (§5.5)", () => {
  assert.equal(stringToPoint(new Uint8Array(32).fill(0xff)), null);
});
