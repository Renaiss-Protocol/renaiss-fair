import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, stringToHex } from "viem";
import type { AlgoConfig, AlgoToken } from "../algo-types";
import { rngFromRandomness } from "../vrf-rng";
import { validateSelection } from "../validate";
import { fairSetTilt } from "../tilt";

const beta = (label: string): string => keccak256(stringToHex(`tilt-test:${label}`));

// A synthetic pool: 120 cheap, 40 mid, 12 rare, 4 chase cards.
const makePool = (): AlgoToken[] => {
  const tokens: AlgoToken[] = [];
  for (let i = 0; i < 120; i++) tokens.push({ tokenId: `c${i}`, valueInUsd: 2000 + i * 25 });
  for (let i = 0; i < 40; i++) tokens.push({ tokenId: `m${i}`, valueInUsd: 6000 + i * 90 });
  for (let i = 0; i < 12; i++) tokens.push({ tokenId: `r${i}`, valueInUsd: 10000 + i * 400 });
  for (let i = 0; i < 4; i++) tokens.push({ tokenId: `x${i}`, valueInUsd: 25000 + i * 2000 });
  return tokens;
};

const makeConfig = (): AlgoConfig => ({
  targetExpectedValueInUsd: 5184,
  lowerExpectedValueInUsd: 5080,
  upperExpectedValueInUsd: 5235,
  lowerNumberOfTokensInNewSet: 40,
  upperNumberOfTokensInNewSet: 120,
  tiers: [
    { tier: "0", floorValueInUsd: 2000, minNumberOfTokens: 1, maxNumberOfTokens: 9999, targetNumberOfTokensPercentage: 80, maxNumberOfTokensPercentage: 88 },
    { tier: "1", floorValueInUsd: 6000, minNumberOfTokens: 5, maxNumberOfTokens: 999, targetNumberOfTokensPercentage: 15, maxNumberOfTokensPercentage: 20 },
    { tier: "2", floorValueInUsd: 10000, minNumberOfTokens: 3, maxNumberOfTokens: 99, targetNumberOfTokensPercentage: 4, maxNumberOfTokensPercentage: 10 },
    { tier: "3", floorValueInUsd: 25000, minNumberOfTokens: 1, maxNumberOfTokens: 4, targetNumberOfTokensPercentage: 1, maxNumberOfTokensPercentage: 3 },
  ],
});

describe("fairSetTilt", () => {
  it("is deterministic: the same β reproduces the same set, a different β varies it", () => {
    const tokens = makePool();
    const config = makeConfig();
    const a = fairSetTilt(tokens, config, rngFromRandomness(beta("det")));
    const b = fairSetTilt(tokens, config, rngFromRandomness(beta("det")));
    assert.deepEqual(a.map((t) => t.tokenId), b.map((t) => t.tokenId));
    const c = fairSetTilt(tokens, config, rngFromRandomness(beta("det-other")));
    assert.notDeepEqual(a.map((t) => t.tokenId), c.map((t) => t.tokenId));
  });

  it("forms sets the production acceptance check accepts", () => {
    const tokens = makePool();
    const config = makeConfig();
    for (let i = 0; i < 12; i++) {
      const picked = fairSetTilt(tokens, config, rngFromRandomness(beta(`gate-${i}`)));
      const check = validateSelection(picked, config);
      assert.equal(check.isValid, true, check.errors.join("; "));
    }
  });

  it("never mutates its inputs", () => {
    const tokens = makePool();
    const config = makeConfig();
    const tokensSnapshot = JSON.stringify(tokens);
    const configSnapshot = JSON.stringify(config);
    fairSetTilt(tokens, config, rngFromRandomness(beta("pure")));
    assert.equal(JSON.stringify(tokens), tokensSnapshot);
    assert.equal(JSON.stringify(config), configSnapshot);
  });

  it("keeps chase cards from the top tier (anchors) in every formed set", () => {
    const tokens = makePool();
    const config = makeConfig();
    for (let i = 0; i < 12; i++) {
      const picked = fairSetTilt(tokens, config, rngFromRandomness(beta(`anchor-${i}`)));
      assert.ok(picked.some((t) => t.valueInUsd >= 25000), `set ${i} holds no chase card`);
    }
  });

  it("skips the top tier for anchors when its target percentage is 0", () => {
    const tokens = makePool();
    const config = makeConfig();
    const noChase: AlgoConfig = {
      ...config,
      tiers: config.tiers.map((t) =>
        t.tier === "3" ? { ...t, targetNumberOfTokensPercentage: 0, minNumberOfTokens: 0 } : t),
    };
    // Zero target disables anchoring: no 1–10 chase seeding. The quota solver
    // may still lean on the tier as a feasibility escape, so a stray card or
    // two is allowed — an anchor batch (bounded only by maxCards) is not.
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const picked = fairSetTilt(tokens, noChase, rngFromRandomness(beta(`nochase-${i}`)));
      const chase = picked.filter((t) => t.valueInUsd >= 25000).length;
      assert.ok(chase <= 2, `set ${i} holds ${chase} top-tier cards`);
      total += chase;
    }
    assert.ok(total <= 4, `top tier appeared ${total} times over 6 sets`);
  });

  it("drops tokens below the lowest tier floor before selection", () => {
    const tokens = [...makePool(), { tokenId: "dust", valueInUsd: 100 }];
    const config = makeConfig();
    const picked = fairSetTilt(tokens, config, rngFromRandomness(beta("floor")));
    assert.equal(picked.some((t) => t.tokenId === "dust"), false);
  });

  it("respects every hard limit in the formed set", () => {
    const tokens = makePool();
    const config = makeConfig();
    const picked = fairSetTilt(tokens, config, rngFromRandomness(beta("hard")));
    assert.ok(picked.length <= config.upperNumberOfTokensInNewSet);
    const chase = picked.filter((t) => t.valueInUsd >= 25000).length;
    assert.ok(chase <= 4);
    assert.ok(chase * 100 <= 3 * picked.length);
  });

  it("throws on a band wider than 50% of the target", () => {
    const config = { ...makeConfig(), lowerExpectedValueInUsd: 100 };
    assert.throws(
      () => fairSetTilt(makePool(), config, rngFromRandomness(beta("band"))),
      /EV band must be within 50%/,
    );
  });

  it("lands under the drawn size when hard caps demand it (soft size floor)", () => {
    // Only 30 eligible cards but a size floor of 100: the formed set must
    // shrink to what the caps hold instead of failing.
    const tokens: AlgoToken[] = Array.from({ length: 30 }, (_, i) => ({
      tokenId: `s${i}`, valueInUsd: 5000 + i * 20,
    }));
    const config: AlgoConfig = {
      targetExpectedValueInUsd: 5290,
      lowerExpectedValueInUsd: 5000,
      upperExpectedValueInUsd: 5600,
      lowerNumberOfTokensInNewSet: 100,
      upperNumberOfTokensInNewSet: 500,
      tiers: [{ tier: "0", floorValueInUsd: 1000, minNumberOfTokens: 1, maxNumberOfTokens: 9999, targetNumberOfTokensPercentage: 100 }],
    };
    const picked = fairSetTilt(tokens, config, rngFromRandomness(beta("shrink")));
    const check = validateSelection(picked, config);
    assert.equal(check.isValid, true, check.errors.join("; "));
    assert.equal(picked.length, 30);
  });
});
