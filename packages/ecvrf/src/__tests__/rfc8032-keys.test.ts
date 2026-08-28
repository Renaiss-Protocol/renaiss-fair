/**
 * RFC 8032 §5.1.5 key handling — the parts Appendix B.4 vectors don't reach:
 * the secret-key length guard and fresh keypair generation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { keygen, proofToHash, prove, secretScalarAndPublicKey, verify } from "../index";

test("secretScalarAndPublicKey rejects a secret key that is not 32 octets", () => {
  assert.throws(() => secretScalarAndPublicKey(new Uint8Array(31)));
  assert.throws(() => secretScalarAndPublicKey(new Uint8Array(33)));
  assert.throws(() => secretScalarAndPublicKey(new Uint8Array(0)));
});

test("keygen produces a working keypair: prove → verify → proof_to_hash", () => {
  const { SK, pkString } = keygen();
  assert.equal(SK.length, 32);
  assert.equal(pkString.length, 32);

  const alpha = new TextEncoder().encode("keygen round trip");
  const { piString } = prove(SK, alpha);
  const verified = verify(pkString, alpha, piString);
  assert.ok(verified !== null, "a freshly generated key must verify its own proof");
  assert.deepEqual(verified, proofToHash(piString));
});
