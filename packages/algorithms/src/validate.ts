/**
 * The acceptance check for a formed set — the hard conditions every formed
 * set must pass: non-empty, at or under the upper size cap, an expected value
 * inside the configured band (floor division over integer money units), and
 * every tier's min/max count and share cap.
 */

import type { AlgoConfig, AlgoTierConfig, AlgoToken } from "./algo-types";

// The most expensive tier whose floor the value still reaches (tiers ASC).
const tierOf = (value: number, tiersAsc: AlgoTierConfig[]): string => {
  let selected = tiersAsc[0]?.tier ?? "";
  for (const tier of tiersAsc) {
    if (value >= tier.floorValueInUsd) selected = tier.tier;
  }
  return selected;
};

export interface SelectionValidation {
  isValid: boolean;
  errors: string[];
  expectedValueInUsd: number;
  tierCounts: Record<string, number>;
}

export function validateSelection<T extends AlgoToken>(
  selectedTokens: T[],
  config: AlgoConfig,
): SelectionValidation {
  const errors: string[] = [];
  const tiersAsc = [...config.tiers].sort(
    (a, b) => a.floorValueInUsd - b.floorValueInUsd,
  );
  const tierCounts = Object.fromEntries(
    config.tiers.map((tier) => [tier.tier, 0]),
  ) as Record<string, number>;

  if (selectedTokens.length === 0) {
    errors.push("Selected tokens are empty");
  }

  // The upper set-size bound is the only size cap. The build clamps its
  // drawn size to MIN_ABSOLUTE_POOL_SIZE, so a config whose upper bound is
  // below that can hand back a bigger set than it allows — the operator's
  // acceptance check rejects it, and this one must agree or a replay accepts
  // an attempt production refused.
  if (selectedTokens.length > config.upperNumberOfTokensInNewSet) {
    errors.push(
      `Selected token count ${selectedTokens.length} exceeds upper set size ${config.upperNumberOfTokensInNewSet}`,
    );
  }

  const totalValue = selectedTokens.reduce(
    (sum, token) => sum + token.valueInUsd,
    0,
  );
  // Values are integers; use truncating (floor) division for the average.
  const expectedValueInUsd =
    selectedTokens.length === 0
      ? 0
      : Math.floor(totalValue / selectedTokens.length);

  if (
    expectedValueInUsd < config.lowerExpectedValueInUsd ||
    expectedValueInUsd > config.upperExpectedValueInUsd
  ) {
    errors.push(
      `Expected value ${expectedValueInUsd} is outside configured bounds [${config.lowerExpectedValueInUsd}, ${config.upperExpectedValueInUsd}]`,
    );
  }

  for (const token of selectedTokens) {
    const tierId = tierOf(token.valueInUsd, tiersAsc);
    tierCounts[tierId] = (tierCounts[tierId] ?? 0) + 1;
  }

  for (const tier of config.tiers) {
    const count = tierCounts[tier.tier] ?? 0;
    if (count < tier.minNumberOfTokens) {
      errors.push(
        `Tier ${tier.tier} has ${count} tokens, below min ${tier.minNumberOfTokens}`,
      );
    }

    if (count > tier.maxNumberOfTokens) {
      errors.push(
        `Tier ${tier.tier} has ${count} tokens, above max ${tier.maxNumberOfTokens}`,
      );
    }

    const shareCapPct = tier.maxNumberOfTokensPercentage;
    if (
      shareCapPct !== undefined &&
      count * 100 > shareCapPct * selectedTokens.length
    ) {
      errors.push(
        `Tier ${tier.tier} has ${count}/${selectedTokens.length} tokens, above share cap ${shareCapPct}%`,
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    expectedValueInUsd,
    tierCounts,
  };
}
