/**
 * fairSetRanked — the behavioral contract of the selection.
 *
 * Every test runs the algorithm over a deterministic VRF-derived rng stream
 * and a hand-built pool (see helpers), so each expected outcome can be
 * reasoned about from the fixture's numbers.
 *
 * The anchor tests pin the two contracts around top-tier "anchor" tokens:
 *
 * 1. Survival — once seeded, an anchor must not be silently swapped out by
 *    the value balancer, even though dropping the most expensive token is
 *    the single biggest EV correction available.
 * 2. Relaxation — anchors are chosen once, and when no set containing all of
 *    them can land inside the EV band, they are given up one at a time
 *    (3 → 2 → 1), keeping as many as the band allows; when even one anchor
 *    is too much, the least-bad set is returned.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AlgoConfig, AlgoToken } from "../algo-types";
import { validateSelection } from "../validate";
import { fairSetRanked } from "../ranked";
import {
  averageValue,
  countTiers,
  makeSyntheticConfig,
  makeSyntheticPool,
  makeVrfDraw,
} from "./helpers";

describe("fairSetRanked invariants", () => {
  test("a selection is non-empty, unique, within the band, respects tier quotas, and is reproducible", () => {
    const config = makeSyntheticConfig();
    const run = () =>
      fairSetRanked(makeSyntheticPool(), config, makeVrfDraw().rng);
    const selected = run();

    assert.ok(selected.length > 0);
    const ids = new Set(selected.map((t) => t.tokenId));
    assert.equal(ids.size, selected.length);

    const ev = averageValue(selected);
    assert.ok(ev >= config.lowerExpectedValueInUsd, `EV ${ev} below band`);
    assert.ok(ev <= config.upperExpectedValueInUsd, `EV ${ev} above band`);

    const counts = countTiers(selected, config);
    for (const tier of config.tiers) {
      const count = counts.get(tier.tier) ?? 0;
      assert.ok(
        count >= tier.minNumberOfTokens,
        `tier ${tier.tier} has ${count}, below its minimum`,
      );
      assert.ok(
        count <= tier.maxNumberOfTokens,
        `tier ${tier.tier} has ${count}, above its maximum`,
      );
    }

    // Identical input and randomness reproduce the identical selection.
    assert.deepEqual(
      run().map((t) => t.tokenId),
      selected.map((t) => t.tokenId),
    );
  });

  test("fills a tier with a high minimum up to that minimum", () => {
    // Size 15 leaves room past the twelve base-tier tokens, so at least three
    // upper-tier tokens always make the cut regardless of the anchor count.
    const config = makeSyntheticConfig({
      lowerNumberOfTokensInNewSet: 15,
      upperNumberOfTokensInNewSet: 15,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 70,
        },
        {
          tier: "1",
          floorValueInUsd: 300,
          minNumberOfTokens: 3,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 30,
        },
      ],
    });
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    const counts = countTiers(selected, config);
    assert.ok((counts.get("1") ?? 0) >= 3);
  });

  test("succeeds even when every tier's target percentage is zero", () => {
    const config = makeSyntheticConfig({
      tiers: makeSyntheticConfig().tiers.map((tier) => ({
        ...tier,
        targetNumberOfTokensPercentage: 0,
      })),
    });
    // With no tier targeted, no anchor tier is eligible; the selection must
    // still resolve without throwing.
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    assert.ok(Array.isArray(selected));
  });

  test("returns an empty selection when too few tokens are available", () => {
    // Fewer tokens than the minimum viable pool size: every drawn size is
    // skipped, so no selection can be formed.
    const pool = [
      { tokenId: "1", valueInUsd: 100 },
      { tokenId: "2", valueInUsd: 100 },
      { tokenId: "3", valueInUsd: 1000 },
    ];
    const selected = fairSetRanked(
      pool,
      makeSyntheticConfig({
        lowerNumberOfTokensInNewSet: 50,
        upperNumberOfTokensInNewSet: 50,
      }),
      makeVrfDraw().rng,
    );
    assert.deepEqual(selected, []);
  });
});

describe("the acceptance check", () => {
  test("validateSelection rejects an empty selection", () => {
    const result = validateSelection([], makeSyntheticConfig());
    assert.equal(result.isValid, false);
    assert.equal(result.expectedValueInUsd, 0);
    assert.ok(result.errors.some((e) => e.includes("empty")));
  });

  test("validateSelection reports every violated constraint", () => {
    // Three upper-tier tokens: EV 300 is above the [120, 280] band, the base
    // tier (min 1) is empty, and the upper tier (max 2) is over its cap —
    // three distinct errors at once.
    const config = makeSyntheticConfig({
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 70,
        },
        {
          tier: "1",
          floorValueInUsd: 300,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 2,
          targetNumberOfTokensPercentage: 30,
        },
      ],
    });
    const selection = [
      { tokenId: "100", valueInUsd: 300 },
      { tokenId: "101", valueInUsd: 300 },
      { tokenId: "102", valueInUsd: 300 },
    ];

    const result = validateSelection(selection, config);
    assert.equal(result.isValid, false);
    assert.equal(result.expectedValueInUsd, 300);
    assert.deepEqual(result.tierCounts, { "0": 0, "1": 3 });
    assert.ok(result.errors.some((e) => e.includes("outside configured bounds")));
    assert.ok(result.errors.some((e) => e.includes("below min")));
    assert.ok(result.errors.some((e) => e.includes("above max")));
  });

  test("validateSelection rejects a selection larger than the upper set size", () => {
    // The build clamps the drawn size to at least MIN_ABSOLUTE_POOL_SIZE, so
    // a config whose upper bound is below that can produce a set bigger than
    // it allows. The operator's acceptance check rejects it; so must ours,
    // or a replay accepts an attempt production refused and picks the wrong
    // winner.
    const config = makeSyntheticConfig({
      lowerNumberOfTokensInNewSet: 3,
      upperNumberOfTokensInNewSet: 3,
    });
    const selection = Array.from({ length: 4 }, (_, i) => ({
      tokenId: String(200 + i),
      valueInUsd: 200,
    }));

    const result = validateSelection(selection, config);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("exceeds upper set size")));

    // Exactly at the bound raises no size error (other constraints aside).
    assert.ok(
      !validateSelection(selection.slice(0, 3), config).errors.some((e) =>
        e.includes("exceeds upper set size"),
      ),
    );
  });

  test("validateSelection tolerates a configuration with no tiers", () => {
    const result = validateSelection(
      [{ tokenId: "1", valueInUsd: 100 }],
      makeSyntheticConfig({ tiers: [] }),
    );
    assert.equal(result.isValid, false); // EV 100 is below the [120, 280] band
    assert.equal(result.expectedValueInUsd, 100);
    assert.ok(result.errors.some((e) => e.includes("outside configured bounds")));
  });
});

describe("degenerate pools and configurations", () => {
  test("still selects when the top tier allows zero tokens", () => {
    // The top tier's cap of 0 disqualifies it as the anchor tier; anchors
    // fall back to the highest tier that still has room.
    const config = makeSyntheticConfig({
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 70,
        },
        {
          tier: "1",
          floorValueInUsd: 300,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 0,
          targetNumberOfTokensPercentage: 30,
        },
      ],
    });
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    assert.ok(Array.isArray(selected));
  });

  test("seeds no anchors when the top tier has no available tokens", () => {
    // Every token sits in the base tier, so the targeted top tier is empty:
    // the selection must proceed anchorless — its unmeetable minimum of 1
    // simply finds no candidates — and still land in band.
    const pool: AlgoToken[] = Array.from({ length: 12 }, (_, i) => ({
      tokenId: String(i + 1),
      valueInUsd: 100,
    }));
    const config = makeSyntheticConfig({
      targetExpectedValueInUsd: 100,
      lowerExpectedValueInUsd: 90,
      upperExpectedValueInUsd: 110,
      lowerNumberOfTokensInNewSet: 10,
      upperNumberOfTokensInNewSet: 10,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 95,
        },
        {
          tier: "1",
          floorValueInUsd: 1000,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 3,
          targetNumberOfTokensPercentage: 5,
        },
      ],
    });
    const selected = fairSetRanked(pool, config, makeVrfDraw().rng);
    assert.ok(selected.length > 0);
    assert.equal(averageValue(selected), 100);
  });

  test("balancing gives up gracefully when no replacement tokens exist", () => {
    // The base tier holds exactly one token, forced in by its minimum of 1;
    // the upper tier is capped at 2 of its identical 600s. The resulting EV
    // sits above the band, but the base tier has no unselected tokens to
    // swap in and every upper-tier swap is value-neutral, so the least-bad
    // set is returned unchanged — with the mandatory token still present.
    const pool: AlgoToken[] = [
      { tokenId: "1", valueInUsd: 100 },
      ...Array.from({ length: 11 }, (_, i) => ({
        tokenId: String(i + 101),
        valueInUsd: 600,
      })),
    ];
    const config = makeSyntheticConfig({
      targetExpectedValueInUsd: 300,
      lowerExpectedValueInUsd: 200,
      upperExpectedValueInUsd: 400,
      lowerNumberOfTokensInNewSet: 10,
      upperNumberOfTokensInNewSet: 10,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 5,
        },
        {
          tier: "1",
          floorValueInUsd: 200,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 2,
          targetNumberOfTokensPercentage: 95,
        },
      ],
    });
    const selected = fairSetRanked(pool, config, makeVrfDraw().rng);
    assert.ok(selected.length > 0);
    assert.ok(averageValue(selected) > config.upperExpectedValueInUsd);
    assert.ok(selected.some((t) => t.tokenId === "1"));
  });

  test("a token below the lowest tier floor is dropped, not classified into the base tier", () => {
    // Token "1" is worth 10, below the base tier's floor of 50, and the
    // fixture is built so the draw wants it: an 11-card set at the target of
    // 95 needs a total
    // of 1045, and the eleven cards at 100..110 total 1155 (an EV of 105,
    // above the band). Swapping the 110 for the 10 lands on 95 exactly. The
    // floor outranks that: the token is dropped, and the algorithm returns the
    // out-of-band set of survivors instead.
    const pool: AlgoToken[] = [
      { tokenId: "1", valueInUsd: 10 },
      ...Array.from({ length: 11 }, (_, i) => ({
        tokenId: String(i + 2),
        valueInUsd: 100 + i,
      })),
    ];
    const config = makeSyntheticConfig({
      targetExpectedValueInUsd: 95,
      lowerExpectedValueInUsd: 60,
      upperExpectedValueInUsd: 100,
      lowerNumberOfTokensInNewSet: 11,
      upperNumberOfTokensInNewSet: 11,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 50,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 100,
        },
      ],
    });
    const selected = fairSetRanked(pool, config, makeVrfDraw().rng);
    assert.ok(selected.length > 0);
    assert.ok(!selected.some((t) => t.tokenId === "1"));
    const counts = countTiers(selected, config);
    assert.equal(counts.get("0"), selected.length);
  });

  test("returns an empty selection when every tier is untargeted and unconstrained", () => {
    // Zero targets admit no tokens during the build and zero minimums force
    // none in afterwards, so every candidate pool is empty.
    const config = makeSyntheticConfig({
      tiers: makeSyntheticConfig().tiers.map((tier) => ({
        ...tier,
        minNumberOfTokens: 0,
        targetNumberOfTokensPercentage: 0,
      })),
    });
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    assert.deepEqual(selected, []);
  });
});

describe("the lowest tier's floor is a hard limit", () => {
  // Tokens straddling the floor of 150: 12 below it (100) and 12 above (160).
  //
  // The band [95, 130] is reachable only with the sub-floor cards. Unfiltered,
  // the algorithm lands on ten 100s plus two 160s for an EV of exactly 110.
  // Drop the 100s and the cheapest card left is 160, so every surviving set
  // averages 160 — above the band. The filter costs the algorithm the band and
  // it returns its least-bad set instead: non-empty, entirely at or above the
  // floor. That is the intended trade — the floor outranks the EV target.
  //
  // One tier, deliberately. A second tier's expensive tokens are anchored in
  // first and drag the average above the band on their own, which would make
  // these tests pass whether or not the floor is enforced.
  const makeFloorConfig = (floor: number): AlgoConfig =>
    makeSyntheticConfig({
      targetExpectedValueInUsd: 110,
      lowerExpectedValueInUsd: 95,
      upperExpectedValueInUsd: 130,
      lowerNumberOfTokensInNewSet: 12,
      upperNumberOfTokensInNewSet: 12,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: floor,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 100,
        },
      ],
    });

  const SUB_FLOOR_IDS = Array.from({ length: 12 }, (_, i) => String(i + 1));

  const makeStraddlingPool = (): AlgoToken[] => [
    ...SUB_FLOOR_IDS.map((tokenId) => ({ tokenId, valueInUsd: 100 })),
    ...Array.from({ length: 12 }, (_, i) => ({
      tokenId: String(100 + i),
      valueInUsd: 160,
    })),
  ];

  test("no selected token falls below the floor", () => {
    const config = makeFloorConfig(150);
    const selected = fairSetRanked(
      makeStraddlingPool(),
      config,
      makeVrfDraw().rng,
    );

    assert.ok(selected.length > 0);
    assert.deepEqual(
      selected.filter((t) => t.valueInUsd < 150),
      [],
    );
  });

  test("the floor holds even when the EV band is only reachable below it", () => {
    const config = makeFloorConfig(150);
    const selected = fairSetRanked(
      makeStraddlingPool(),
      config,
      makeVrfDraw().rng,
    );

    assert.ok(selected.length > 0);
    assert.ok(averageValue(selected) > config.upperExpectedValueInUsd);
  });

  test("the same seed reproduces the same set", () => {
    const config = makeFloorConfig(150);
    const ids = () =>
      fairSetRanked(makeStraddlingPool(), config, makeVrfDraw().rng).map(
        (t) => t.tokenId,
      );

    assert.deepEqual(ids(), ids());
  });

  // Guards the >= comparison: a floor of 0 must admit everything, so the
  // filter cannot be off by one.
  test("a floor of 0 drops nothing", () => {
    const selected = fairSetRanked(
      makeStraddlingPool(),
      makeFloorConfig(0),
      makeVrfDraw().rng,
    );
    const ids = new Set(selected.map((t) => t.tokenId));

    assert.ok(SUB_FLOOR_IDS.some((id) => ids.has(id)));
  });
});

describe("tier share cap (maxNumberOfTokensPercentage)", () => {
  // Same card mix as makeSyntheticPool; tier 0 capped at 25% of the drawn
  // 12-card set => at most floor(12 * 0.25) = 3 base-tier tokens.
  const makeCappedConfig = (tier0Cap: number | undefined): AlgoConfig =>
    makeSyntheticConfig({
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 70,
          maxNumberOfTokensPercentage: tier0Cap,
        },
        {
          tier: "1",
          floorValueInUsd: 300,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 30,
        },
      ],
    });

  test("without a cap, the base tier takes more than 25% of the set (baseline)", () => {
    const config = makeCappedConfig(undefined);
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    const counts = countTiers(selected, config);

    assert.ok((counts.get("0") ?? 0) > 3);
  });

  test("a capped tier never exceeds floor(setSize * cap%) tokens", () => {
    const config = makeCappedConfig(25);
    const selected = fairSetRanked(
      makeSyntheticPool(),
      config,
      makeVrfDraw().rng,
    );
    assert.ok(selected.length > 0);
    const counts = countTiers(selected, config);

    assert.ok((counts.get("0") ?? 0) <= 3);
  });

  test("the cap holds across varied VRF seeds", () => {
    // The rng is VRF-derived, so distinct set ids give genuinely
    // different streams.
    for (const setId of [1, 2, 3, 4, 5]) {
      const config = makeCappedConfig(25);
      const selected = fairSetRanked(
        makeSyntheticPool(),
        config,
        makeVrfDraw({ setId }).rng,
      );
      const counts = countTiers(selected, config);

      assert.ok(
        (counts.get("0") ?? 0) <= 3,
        `setId ${setId} put ${counts.get("0")} tokens in the capped tier`,
      );
    }
  });

  describe("validateSelection: tier share cap", () => {
    // Two tiers: tier 0 below 300, tier 1 at 300 and above. EV bounds are
    // wide so only the share-cap check under test can fail.
    const makeConfig = (tier0ShareCapPct: number | undefined): AlgoConfig =>
      makeSyntheticConfig({
        lowerExpectedValueInUsd: 0,
        upperExpectedValueInUsd: 10_000,
        targetExpectedValueInUsd: 5_000,
        tiers: makeCappedConfig(tier0ShareCapPct).tiers,
      });

    // `tier0Count` cheap (tier 0) tokens + the rest pricey (tier 1), 12 total.
    const makeSelection = (tier0Count: number): AlgoToken[] => [
      ...Array.from({ length: tier0Count }, (_, i) => ({
        tokenId: String(i + 1),
        valueInUsd: 100,
      })),
      ...Array.from({ length: 12 - tier0Count }, (_, i) => ({
        tokenId: String(100 + i),
        valueInUsd: 300,
      })),
    ];

    test("accepts a share exactly at the cap (<= semantics)", () => {
      // 3/12 = 25% with cap 25% — allowed.
      const validation = validateSelection(makeSelection(3), makeConfig(25));
      assert.equal(validation.isValid, true);
      assert.deepEqual(validation.errors, []);
    });

    test("rejects a share above the cap", () => {
      // 4/12 = 33.3% with cap 25% — rejected.
      const validation = validateSelection(makeSelection(4), makeConfig(25));
      assert.equal(validation.isValid, false);
      assert.deepEqual(validation.errors, [
        "Tier 0 has 4/12 tokens, above share cap 25%",
      ]);
    });

    test("no cap configured => share is never checked", () => {
      // 11/12 tokens in tier 0 (~92% share) is fine without a cap. (Not
      // 12/12: that would trip tier 1's separate minNumberOfTokens check.)
      const validation = validateSelection(
        makeSelection(11),
        makeConfig(undefined),
      );
      assert.equal(validation.isValid, true);
    });
  });
});

describe("anchor handling", () => {
  test("the seeded anchor survives value balancing and the result stays in band", () => {
    const ANCHOR_ID = "12"; // the single top-tier token (value 2000)

    // 6x600 + 4x200 give the balancer in-tier swap room (600 → 200) to pull
    // the EV down WITHOUT touching the anchor; the top tier holds only the
    // anchor.
    const pool: AlgoToken[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        tokenId: String(i + 1),
        valueInUsd: 600,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        tokenId: String(i + 7),
        valueInUsd: 200,
      })),
      { tokenId: "11", valueInUsd: 1100 },
      { tokenId: ANCHOR_ID, valueInUsd: 2000 },
    ];

    const config: AlgoConfig = {
      targetExpectedValueInUsd: 580,
      lowerExpectedValueInUsd: 500,
      upperExpectedValueInUsd: 680,
      lowerNumberOfTokensInNewSet: 10,
      upperNumberOfTokensInNewSet: 10,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 0,
        },
        {
          tier: "1",
          floorValueInUsd: 200,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 80,
        },
        {
          tier: "2",
          floorValueInUsd: 1500,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 1,
          targetNumberOfTokensPercentage: 20,
        },
      ],
    };

    const selected = fairSetRanked(pool, config, makeVrfDraw().rng);

    const ev = averageValue(selected);
    assert.ok(ev >= config.lowerExpectedValueInUsd, `EV ${ev} below band`);
    assert.ok(ev <= config.upperExpectedValueInUsd, `EV ${ev} above band`);

    // The top tier contains exactly one token, so it is always the anchor;
    // its tier minimum is 0, so nothing but anchor protection keeps it in.
    const ids = new Set(selected.map((t) => t.tokenId));
    assert.ok(ids.has(ANCHOR_ID), "the seeded anchor was swapped out");
  });

  test("anchors are relaxed one at a time until the band is reachable, else the least-bad set is returned", () => {
    const TOP_TIER_FLOOR = 1000;

    // 40 cheap tokens (100) + 5 top-tier tokens (1000); top tier capped at 3.
    const pool: AlgoToken[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        tokenId: String(i + 1),
        valueInUsd: 100,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        tokenId: String(i + 101),
        valueInUsd: 1000,
      })),
    ];

    const buildConfig = (
      band: {
        lower: number;
        target: number;
        upper: number;
      },
      size = 10,
    ): AlgoConfig => ({
      targetExpectedValueInUsd: band.target,
      lowerExpectedValueInUsd: band.lower,
      upperExpectedValueInUsd: band.upper,
      lowerNumberOfTokensInNewSet: size,
      upperNumberOfTokensInNewSet: size,
      tiers: [
        {
          tier: "0",
          floorValueInUsd: 0,
          minNumberOfTokens: 1,
          maxNumberOfTokens: 9999,
          targetNumberOfTokensPercentage: 95,
        },
        {
          tier: "1",
          floorValueInUsd: TOP_TIER_FLOOR,
          minNumberOfTokens: 0,
          maxNumberOfTokens: 3,
          targetNumberOfTokensPercentage: 5,
        },
      ],
    });

    // The rng's first draw decides the initial anchor count:
    // floor(draw x 10) + 1, capped by the tier maximum of 3. This test pins a
    // set id whose first draw is >= 0.2, so every scenario starts from 3
    // anchors and the band alone decides how many survive: a token worth 1000
    // can only be present as a kept anchor.
    const RELAX_SET_ID = 2;
    assert.ok(makeVrfDraw({ setId: RELAX_SET_ID }).rng() >= 0.2);

    // Every scenario pins the size range to one exact size, so k kept anchors
    // put the average at (1000k + 100(n - k)) / n. Each band isolates one rung
    // of the ladder: 3 anchors at size 10 => 370; size 12 is where a 2-anchor
    // set (2×1000 + 10×100 = 250) or a 1-anchor set (1000 + 11×100 = 175)
    // can land in its band; the last band is below what even one anchor
    // allows, so the least-bad (still off-band) set is returned.
    const ladder = [
      { band: { lower: 315, target: 450, upper: 585 }, size: 10, kept: 3, inBand: true },
      { band: { lower: 193, target: 275, upper: 358 }, size: 12, kept: 2, inBand: true },
      { band: { lower: 150, target: 185, upper: 220 }, size: 12, kept: 1, inBand: true },
      { band: { lower: 100, target: 120, upper: 140 }, size: 10, kept: 1, inBand: false },
    ];

    for (const scenario of ladder) {
      const config = buildConfig(scenario.band, scenario.size);
      const selected = fairSetRanked(
        pool,
        config,
        makeVrfDraw({ setId: RELAX_SET_ID }).rng,
      );
      assert.ok(selected.length > 0);

      const kept = selected.filter((t) => t.valueInUsd >= TOP_TIER_FLOOR);
      assert.equal(
        kept.length,
        scenario.kept,
        `band [${scenario.band.lower}, ${scenario.band.upper}] kept ${kept.length} anchors`,
      );

      const ev = averageValue(selected);
      const inBand =
        ev >= config.lowerExpectedValueInUsd &&
        ev <= config.upperExpectedValueInUsd;
      assert.equal(
        inBand,
        scenario.inBand,
        `band [${scenario.band.lower}, ${scenario.band.upper}] EV ${ev}`,
      );
    }
  });
});
