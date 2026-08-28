# @renaiss/replay-fair-set

The algorithm-agnostic layer around the fair-set selection algorithms: the
**seed derivation** that commits a build to public inputs, and the
**retry/record loop** that replays a whole VRF-seeded set formation attempt by
attempt — what each try selected, where it started in the rng stream, and why
it was accepted or rejected.

The algorithms themselves — the ranked and tilt designs — live in the peer
package [`@renaiss/algorithms`](../algorithms); the fair API's
`algo_used` names which one a recorded run was formed with.

## The pipeline

```
seed α    = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂)
proof π   = ECVRF_prove(SK, α), β = proof_to_hash(π)
selection = the retry loop below, consuming β's rng stream
```

## Usage

```ts
import { deriveTaskSeed, runSelectionLoop } from "@renaiss/replay-fair-set";
import { fairSetTilt } from "@renaiss/algorithms/tilt";

const seed = deriveTaskSeed(blockHash, blockNumber, onChainPackId, setId);
// … the operator's VRF proves seed → β …

// Replay a recorded run with the algorithm its `algo_used` names
// (defaults to fairSetRanked when no algorithm is passed):
const run = runSelectionLoop(beta, tokens, config, fairSetTilt);
run.attempts; // every attempt: outcome, picks, EV, rng offsets
run.draws;    // the full rng draw log, word by word
```

## The contract

- `deriveTaskSeed(blockHash, blockNumber, onChainPackId, setId)` — α, bound to
  this derivation by the `SEED_DOMAIN_TAG` domain separator.
- `runSelectionLoop(beta, tokens, config, selectFn?)` — one rng stream from β,
  re-run `selectFn` until a selection passes `validateSelection` (each retry
  consumes further draws, so every attempt is distinct yet covered by the one
  proof), bounded by `MAX_RETRIES_PER_ALGO`. Deterministic — the same β always
  reproduces every attempt, in order.
- `makeCountingRng(beta)` — the β-seeded rng that records every draw it
  produces, for a full, replayable log of the stream.

## Tests

```sh
pnpm test
```

The suite covers the VRF pipeline end to end — seed derivation, the randomness
stream, verification from public data — and the loop's recording contract:
accumulated rng offsets, per-attempt picks, and the give-up bound.
