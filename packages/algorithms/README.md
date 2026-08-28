# @renaiss/algorithms

The fair-set selection algorithms. Given a pool of tokens, a pack
configuration, and a VRF-seeded randomness stream, each forms a card set that
hits a target expected value and per-tier rarity quotas. The same VRF output β
always reproduces the exact same set, so every formed set can be replayed and
verified by anyone.

Two peer designs share one contract — the same config and token shapes, the
same acceptance check, all randomness injected as one rng stream:

- **`fairSetRanked`** — an adaptive score-and-rank design.
- **`fairSetTilt`** — a globally monotone max-entropy value tilt.

The fair API's `algo_used` names which design a recorded run was formed with;
the seed derivation and the retry/record replay loop live in
[`@renaiss/replay-fair-set`](../replay-fair-set).

## How the ranked design works

1. **Anchors** — a random number (1–10) of random top-tier chase cards is
   picked once, up front.
2. **Score-and-rank build** — each attempt draws a set size uniformly from the
   configured range, then greedily adds the best-scoring cards: closeness to
   the expected-value band's center, the picking tier's remaining need against
   its target share, plus in-band and in-tier-range bonuses; the ranking is
   refreshed as the set fills.
3. **Tier minimums** — any tier below its minimum is topped up with the cards
   closest to the band center.
4. **EV balancing** — same-tier swaps walk the expected value back inside the
   band (anchors are never swapped out).
5. **Progressive relaxation** — when no attempt lands in band, one anchor is
   dropped at random and the search repeats; the best set seen is returned.

## How the tilt design works

1. **Anchors** — a random number (1–10) of random chase cards from the most
   valuable eligible tier is picked once, up front, and always remains in the
   formed set.
2. **Quota planning** — each attempt draws a set size, apportions per-tier
   quotas inside every hard bound (upper size cap, expected-value band, tier
   min/max, share caps), and shifts counts until the reachable totals hold
   the target.
3. **The tilt** — cards are drawn by one saturated inclusion tilt
   π = min(1, c·e^(s·v)) over the whole non-anchor pool: the maximum-entropy
   distribution under the count constraint, monotone in value — so no
   interior value region can be starved between two well-used ones. The tilt
   is flat-deformed per tier to its quota, and the global slope is bisected
   so the expected value lands on target.
4. **PPS combs** — each tier's quota is realized exactly by one systematic
   probability-proportional-to-size pass, tie-averaged so equal values get
   equal odds.
5. **Repair** — a same-tier window-swap walk polishes the expected value into
   the band.

## Usage

Each module is its own entry point — import exactly what you need:

```ts
import { fairSetRanked } from "@renaiss/algorithms/ranked";
import { fairSetTilt } from "@renaiss/algorithms/tilt";
import { rngFromRandomness } from "@renaiss/algorithms/vrf-rng";
import { validateSelection } from "@renaiss/algorithms/validate";
import type { AlgoConfig, AlgoToken } from "@renaiss/algorithms/algo-types";

const rng = rngFromRandomness(beta); // β from an ECVRF proof
const set = fairSetTilt(tokens, config, rng);
const check = validateSelection(set, config); // the hard acceptance conditions
```

Token values are integers in the API's money unit (USD with two implied
decimals — `1_000` is $10.00); the acceptance check computes the expected
value with truncating (floor) division. All randomness comes from the injected
`rng`; inputs are never mutated. The tilt uses `Math.exp`, so bit-for-bit
replay holds within one JS engine family (verifiers replay on V8/Node).

## The contract

- `fairSetRanked(tokens, config, rng)` / `fairSetTilt(tokens,
  config, rng)` — one full selection run each.
- `rngFromRandomness(beta)` — the β → float stream: wordᵢ = SHA-512(β ‖ i as
  32-byte BE), rᵢ = low 53 bits ÷ 2⁵³. Publicly recomputable from β alone.
- `validateSelection(set, config)` — the hard conditions a formed set must
  pass: non-empty, at or under the upper size cap, expected value inside the
  configured band, and every tier's min/max count and share cap.

The config's remaining fields — the size floor, the target expected value,
and the tier target percentages — are soft: the algorithms steer toward them
but never fail a formation over them.

## Tests

```sh
pnpm test
```

One suite per design (`ranked.test.ts`, `tilt.test.ts`).
The ranked suite drives the algorithm through the same prove-then-expand
ECVRF pipeline an operator runs, and pins the behavioral contract:
determinism, input immutability, anchor survival and relaxation, tier quotas,
and the acceptance conditions. The tilt suite pins its own contract:
determinism, anchors that always remain, the soft size floor, and the strict
config validation (the EV band must stay within 50% of the target).
