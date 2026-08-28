/**
 * The input/output contract of the fair-set selection algorithms.
 * The ranked and tilt designs in this package
 * implement the exact same schema: the same config and token shapes in, an
 * array of the selected tokens out, all randomness injected as one `Rng`
 * stream expanded from a VRF output β.
 */

export interface AlgoTierConfig {
  tier: string;
  /** The tier's value floor, in USD (a value >= this reaches the tier).
   *
   * The lowest tier's floor is a hard limit, enforced when the card pool is
   * built: tokens below it are dropped before selection sees them. Higher
   * tiers' floors are classification only — validateSelection classifies a
   * value by the floors and checks the tier counts. */
  floorValueInUsd: number;
  minNumberOfTokens: number;
  maxNumberOfTokens: number;
  targetNumberOfTokensPercentage: number;
  /** Hard cap on how much of the set this tier may hold, in percent
   * (<= semantics); omitted = no cap. */
  maxNumberOfTokensPercentage?: number | undefined;
}

export interface AlgoConfig {
  targetExpectedValueInUsd: number;
  lowerExpectedValueInUsd: number;
  upperExpectedValueInUsd: number;
  /** Set-size bounds: each build attempt draws its size uniformly from
   * [lower, upper]; the upper bound is the only size cap. */
  lowerNumberOfTokensInNewSet: number;
  upperNumberOfTokensInNewSet: number;
  tiers: AlgoTierConfig[];
}

export interface AlgoToken {
  tokenId: string;
  valueInUsd: number;
}

/** An injected source of randomness: () => float in [0, 1). */
export type Rng = () => number;

/** A set-selection algorithm: tokens + config + rng in, selected tokens out. */
export type SelectTokensAlgo = <T extends AlgoToken>(
  tokens: T[],
  config: AlgoConfig,
  rng: Rng,
) => T[];
