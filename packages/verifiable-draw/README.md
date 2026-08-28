# @renaiss/verifiable-draw

The application layer that turns the raw [`@renaiss/ecvrf`](../ecvrf) primitives
into a **verifiable draw pipeline**: hex-friendly wrappers, β→stream expansion,
one-call prove/verify pipelines, and the draw-resolution derivations.

Where `@renaiss/ecvrf` is deliberately 1:1 with RFC 9381 (bytes only, nothing
but the standard), this package holds the conventions an application needs on
top — all of them public and deterministic, so any third party can re-run them.

## The verification recipe

Everything a verifier needs, end to end:

1. proof π is 80 octets: `Gamma(32) ‖ c(16, LE) ‖ s(32, LE)`
2. `ECVRF_verify(PK, α, π)` per RFC 9381 §5.3, suite `0x04`
3. `β = ECVRF_proof_to_hash(π)` — 64 octets
4. stream draw *i* = low 53 bits of `SHA-512(β ‖ i as 32-byte BE)`, over 2⁵³;
   a single card draw resolves to `keccak256(β) mod remaining`

## Usage

```ts
import {
  proveAndExpand,
  verifyAndExpand,
  deriveDrawSeed,
  deriveEligibleIndex,
  ecvrfVerifyBeta,
} from "@renaiss/verifiable-draw";

// ── operator (holds the secret key) ──
const alpha = deriveDrawSeed(blockHash, onChainPackId, checkoutId);
const { rng, proofHex, randomnessHex } = proveAndExpand(sk, alpha);
// publish: public key, alpha inputs, proofHex — never sk

// ── verifier (holds only public values) ──
const verifierRng = verifyAndExpand({ publicKeyHex, alphaHex: alpha, proofHex });
if (verifierRng === null) throw new Error("invalid proof");
// verifierRng now reproduces the operator's stream exactly

// resolve one draw to a card index (sampled without replacement):
const beta = ecvrfVerifyBeta(publicKeyHex, alpha, proofHex);
const index = deriveEligibleIndex(beta!, eligibleCount);
```

## What's in the box

| Layer | Exports |
|---|---|
| Hex wrappers | `ecvrfKeygen`, `ecvrfDerivePublicKey`, `ecvrfProve`, `ecvrfVerify`, `ecvrfVerifyBeta`, `ecvrfProofToHash` |
| β→stream expansion | `randomWordHex`, `randomAt`, `rngFromRandomness`, `Rng` |
| Pipelines | `proveAndExpand` (prover), `verifyAndExpand` (verifier) |
| Draw resolution | `SEED_DOMAIN_TAG`, `deriveDrawSeed`, `deriveEligibleIndex` |

Every value in the expansion stream is independently recomputable from the
proof-authenticated β by its index alone (`randomAt(β, i)`), so a verifier can
check any single draw without replaying the whole stream.

`ecvrfVerify`/`ecvrfVerifyBeta` never throw — malformed input is the spec's
"INVALID" (`false`/`null`), so untrusted data can be fed to them directly.

## Consumers

- [`@renaiss/algorithms`](../algorithms) uses the same expansion
  convention for set creation (implemented there self-contained, by design, so
  the algorithm module can be audited standalone).
- The demo web app verifies live draws with `ecvrfVerifyBeta`,
  `deriveDrawSeed`, and `deriveEligibleIndex`.
