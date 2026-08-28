/**
 * Behavioral tests for the hex pipeline: round trips, negative cases
 * (tampered/malformed inputs), determinism, and β→stream expansion. Spec
 * conformance itself is pinned by the official RFC vectors in
 * `@renaiss/ecvrf`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import {
  ecvrfDerivePublicKey,
  ecvrfKeygen,
  ecvrfProofToHash,
  ecvrfProve,
  ecvrfVerify,
  ecvrfVerifyBeta,
  proveAndExpand,
  randomAt,
  randomWordHex,
  rngFromRandomness,
  verifyAndExpand,
} from "../index";

const SK = `0x${"02".repeat(32)}` as const;
const ALPHA = `0x${"ab".repeat(32)}` as const;

describe("ECVRF round trip", () => {
  test("proves and verifies with a fresh keypair", () => {
    const { sk, pk } = ecvrfKeygen();
    assert.match(sk, /^0x[0-9a-f]{64}$/);
    assert.match(pk, /^0x[0-9a-f]{64}$/);
    const { proofHex } = ecvrfProve(sk, ALPHA);
    assert.match(proofHex, /^0x[0-9a-f]{160}$/); // 80-byte proof
    assert.equal(ecvrfVerify(pk, ALPHA, proofHex), true);
  });

  test("is deterministic: same (sk, alpha) yields the same proof and beta", () => {
    const a = ecvrfProve(SK, ALPHA);
    const b = ecvrfProve(SK, ALPHA);
    assert.equal(a.proofHex, b.proofHex);
    assert.equal(ecvrfProofToHash(a.proofHex), ecvrfProofToHash(b.proofHex));
  });

  test("produces a 64-byte beta", () => {
    const { proofHex } = ecvrfProve(SK, ALPHA);
    assert.match(ecvrfProofToHash(proofHex), /^0x[0-9a-f]{128}$/);
  });

  test("ecvrfVerifyBeta returns the same beta the prover computed", () => {
    const pk = ecvrfDerivePublicKey(SK);
    const { proofHex } = ecvrfProve(SK, ALPHA);
    assert.equal(ecvrfVerifyBeta(pk, ALPHA, proofHex), ecvrfProofToHash(proofHex));
  });

  test("rejects a proof against the wrong public key", () => {
    const { proofHex } = ecvrfProve(SK, ALPHA);
    const otherPk = ecvrfDerivePublicKey(`0x${"03".repeat(32)}`);
    assert.equal(ecvrfVerify(otherPk, ALPHA, proofHex), false);
  });

  test("rejects a proof for a different alpha", () => {
    const pk = ecvrfDerivePublicKey(SK);
    const { proofHex } = ecvrfProve(SK, ALPHA);
    assert.equal(ecvrfVerify(pk, `0x${"cd".repeat(32)}`, proofHex), false);
  });

  test("rejects a tampered proof", () => {
    const pk = ecvrfDerivePublicKey(SK);
    const { proofHex } = ecvrfProve(SK, ALPHA);
    const tampered =
      `0x${proofHex.slice(2, 10)}${proofHex[10] === "0" ? "1" : "0"}${proofHex.slice(11)}` as Hex;
    assert.equal(ecvrfVerify(pk, ALPHA, tampered), false);
  });

  test("ecvrfProofToHash rejects a wrong-length proof", () => {
    assert.throws(() => ecvrfProofToHash("0x1234"), /Invalid proof length/);
  });

  test("ecvrfProofToHash rejects a proof whose Gamma does not decode", () => {
    // 80 bytes, but the first 32 (Gamma) are a non-canonical point encoding.
    assert.throws(
      () => ecvrfProofToHash(`0x${"ff".repeat(80)}`),
      /invalid Gamma/,
    );
  });

  test("returns false (not throw) on malformed inputs", () => {
    const pk = ecvrfDerivePublicKey(SK);
    assert.equal(ecvrfVerify(pk, ALPHA, "0x1234"), false); // wrong length
    assert.equal(ecvrfVerify(pk, ALPHA, `0x${"00".repeat(80)}`), false);
    assert.equal(
      ecvrfVerify("0xnothex" as Hex, ALPHA, `0x${"00".repeat(80)}`),
      false,
    );
    // identity/low-order public key fails ECVRF_validate_key
    assert.equal(
      ecvrfVerify(`0x${"00".repeat(32)}`, ALPHA, `0x${"00".repeat(80)}`),
      false,
    );
  });
});

describe("beta expansion", () => {
  test("expands beta into a deterministic stream in [0, 1)", () => {
    const { rng, randomnessHex } = proveAndExpand(SK, ALPHA);
    const values = Array.from({ length: 100 }, () => rng());
    for (const [i, v] of values.entries()) {
      assert.ok(v >= 0);
      assert.ok(v < 1);
      assert.equal(v, randomAt(randomnessHex, i)); // stream == indexed access
    }
    const replay = rngFromRandomness(randomnessHex);
    for (const v of values) assert.equal(replay(), v);
  });

  test("randomWordHex is SHA-512 sized and stable", () => {
    const { randomnessHex } = proveAndExpand(SK, ALPHA);
    const word = randomWordHex(randomnessHex, 0);
    assert.match(word, /^0x[0-9a-f]{128}$/);
    assert.equal(randomWordHex(randomnessHex, 0), word);
    assert.notEqual(randomWordHex(randomnessHex, 1), word);
  });

  test("verifyAndExpand rebuilds the identical stream from public values only", () => {
    const pk = ecvrfDerivePublicKey(SK);
    const prover = proveAndExpand(SK, ALPHA);
    const rng = verifyAndExpand({
      publicKeyHex: pk,
      alphaHex: ALPHA,
      proofHex: prover.proofHex,
    });
    assert.notEqual(rng, null);
    for (let i = 0; i < 25; i++) assert.equal(rng!(), prover.rng());
  });

  test("verifyAndExpand returns null for an invalid proof", () => {
    const pk = ecvrfDerivePublicKey(SK);
    const { proofHex } = ecvrfProve(SK, ALPHA);
    assert.equal(
      verifyAndExpand({
        publicKeyHex: pk,
        alphaHex: `0x${"cd".repeat(32)}`,
        proofHex,
      }),
      null,
    );
  });
});
