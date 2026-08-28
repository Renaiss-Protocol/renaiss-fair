/**
 * Shared fixtures for the test suite. Everything here is synthetic and
 * deterministic: a fixed RFC 8032 demo secret key drives the VRF, and every
 * input is hand-built so each test's expected behavior can be reasoned about
 * from the numbers alone.
 */

import {
  bytesToHex,
  concat,
  hexToBytes,
  keccak256,
  numberToHex,
  stringToHex,
  type Hex,
} from "viem";
import {
  pointToString,
  proofToHash,
  prove,
  secretScalarAndPublicKey,
} from "@renaiss/ecvrf";
import type { AlgoConfig, AlgoToken, Rng } from "../algo-types";
import { rngFromRandomness } from "../vrf-rng";

/** α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ onChainPackId ‖ setId₃₂) —
 * a local mirror of deriveTaskSeed from @renaiss/replay-fair-set, so this
 * package's tests stay dependency-free of the layer that sits above it. */
const SEED_DOMAIN_TAG_HEX = stringToHex("renaiss-gacha-v3-1");
const deriveTaskSeed = (
  blockHash: string,
  blockNumber: number,
  onChainPackId: string,
  setId: number,
): Hex =>
  keccak256(
    concat([
      SEED_DOMAIN_TAG_HEX,
      blockHash as Hex,
      numberToHex(blockNumber, { size: 32 }),
      onChainPackId as Hex,
      numberToHex(setId, { size: 32 }),
    ]),
  );

/** A fixed RFC 8032 test secret key — demo value, never a production key. */
export const SK = hexToBytes(
  "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
);

/** Public seed inputs: the block anchors the draw in time; the pack id and
 * set id bind it to one specific build. */
const SEED_INPUTS = {
  blockHash: `0x${"ab".repeat(32)}` as Hex,
  blockNumber: 19_400_000,
  packId: `0x${"11".repeat(32)}` as Hex,
  setId: 1,
};

export interface VrfDraw {
  /** α — the seed derived from the public inputs. */
  seedHex: Hex;
  /** π — the ECVRF proof over α. */
  proofHex: Hex;
  /** β — the proof's output hash; the randomness the algorithm consumes. */
  randomnessHex: Hex;
  rng: Rng;
}

/** Derive α, prove it with SK, and expand β into an rng stream — the same
 * prove-then-expand pipeline an operator runs for a real build. */
export const makeVrfDraw = (
  overrides: Partial<typeof SEED_INPUTS> = {},
): VrfDraw => {
  const inputs = { ...SEED_INPUTS, ...overrides };
  const seedHex = deriveTaskSeed(
    inputs.blockHash,
    inputs.blockNumber,
    inputs.packId,
    inputs.setId,
  );
  const { piString } = prove(SK, hexToBytes(seedHex));
  const beta = proofToHash(piString);
  if (!beta) throw new Error("proofToHash failed on a freshly generated proof");
  const randomnessHex = bytesToHex(beta);
  return {
    seedHex,
    proofHex: bytesToHex(piString),
    randomnessHex,
    rng: rngFromRandomness(randomnessHex),
  };
};

// ── synthetic selection inputs ───────────────────────────────────────────────

/** A small, hand-built pool where branch behavior is predictable:
 * 12 base-tier tokens worth 100 and 6 upper-tier tokens worth 300, so a
 * 6x300 + 6x100 selection averages exactly 200 — the band center. */
export const makeSyntheticPool = (): AlgoToken[] => [
  ...Array.from({ length: 12 }, (_, i) => ({
    tokenId: String(i + 1),
    valueInUsd: 100,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    tokenId: String(100 + i),
    valueInUsd: 300,
  })),
];

export const makeSyntheticConfig = (
  overrides: Partial<AlgoConfig> = {},
): AlgoConfig => ({
  targetExpectedValueInUsd: 200,
  lowerExpectedValueInUsd: 120,
  upperExpectedValueInUsd: 280,
  lowerNumberOfTokensInNewSet: 12,
  upperNumberOfTokensInNewSet: 12,
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
      minNumberOfTokens: 1,
      maxNumberOfTokens: 9999,
      targetNumberOfTokensPercentage: 30,
    },
  ],
  ...overrides,
});

/** The average selection value with truncating division — the same EV rule
 * the algorithm and the acceptance check use. */
export const averageValue = (tokens: AlgoToken[]): number =>
  tokens.length === 0
    ? 0
    : Math.floor(
        tokens.reduce((sum, t) => sum + t.valueInUsd, 0) / tokens.length,
      );

/** Count how many selected tokens fall into each configured tier (a token
 * belongs to the most expensive tier whose floor it reaches). */
export const countTiers = (
  tokens: AlgoToken[],
  config: AlgoConfig,
): Map<string, number> => {
  const tiersAsc = [...config.tiers].sort(
    (a, b) => a.floorValueInUsd - b.floorValueInUsd,
  );
  const counts = new Map<string, number>();
  for (const token of tokens) {
    let selected = tiersAsc[0]?.tier ?? "";
    for (const tier of tiersAsc) {
      if (token.valueInUsd >= tier.floorValueInUsd) selected = tier.tier;
    }
    counts.set(selected, (counts.get(selected) ?? 0) + 1);
  }
  return counts;
};
