/**
 * Fair Set Adaptive — ranked. Adaptive score-and-rank pool building.
 * Contract: `(tokens, config, rng) => tokens` —
 * all randomness from the injected rng, inputs never mutated, the same β
 * always reproduces the same set.
 *
 * Anchors (a random number of top-tier chase cards) are picked once; each
 * attempt builds a pool at a freshly drawn random size by greedy
 * score-and-rank (EV closeness + tier need + in-band and in-tier-range
 * bonuses, rescored as the pool fills), tops up tier minimums, then swaps
 * within tiers until the expected value is back in band; progressive
 * relaxation drops one anchor at random when no attempt lands in-band.
 */

import type { AlgoConfig, AlgoTierConfig, AlgoToken, Rng } from "./algo-types";

// ── the algorithm ────────────────────────────────────────────────────────────
// Tuning constants.

const MAX_POOLS_PER_LEVEL = 15; // never build more than this many pools per anchor level
const MIN_ABSOLUTE_POOL_SIZE = 10;
const EARLY_TERMINATION_THRESHOLD = 0.1;
const EV_SCORE_WEIGHT = 0.7;
const TIER_NEED_WEIGHT = 0.3;
const TOLERANCE_BONUS = 0.2;
const TIER_RANGE_BONUS = 0.1;
const TIER_OVERAGE_MULTIPLIER = 1.2;
const MAX_BALANCING_ITERATIONS = 30;
const MAX_ANCHOR_CARDS = 10;
const MIN_POOL_SIZE_FOR_EV_CHECK = 5;
const MIN_POOL_SIZE_PERCENT_FOR_EV_CHECK = 0.3;
const BUILD_PHASE_EV_FLEXIBILITY = 0.08;
const RESCORE_INTERVAL = 15;

type Card<T> = { token: T; id: string; value: number; tier: string };

type Tier = {
  id: string;
  low: number;
  high: number; // inclusive; Infinity for the top tier
  targetPct: number;
  minCards: number;
  maxCards: number;
  maxShare?: number | undefined; // hard cap on the tier's share of the pool, 0..1; undefined = no cap
};

// The most expensive tier whose floor the value still reaches (tiers ASC).
const tierOf = (value: number, tiersAsc: AlgoTierConfig[]): string => {
  let selected = tiersAsc[0]?.tier ?? "";
  for (const tier of tiersAsc) {
    if (value >= tier.floorValueInUsd) selected = tier.tier;
  }
  return selected;
};

const toTiers = (tiersAsc: AlgoTierConfig[]): Tier[] =>
  tiersAsc.map((tier, i) => {
    const low = tier.floorValueInUsd;
    const next = tiersAsc[i + 1];
    return {
      id: tier.tier,
      low,
      high: next ? Math.max(low, next.floorValueInUsd - 1) : Infinity,
      targetPct: tier.targetNumberOfTokensPercentage / 100,
      minCards: tier.minNumberOfTokens,
      maxCards: tier.maxNumberOfTokens,
      maxShare:
        tier.maxNumberOfTokensPercentage !== undefined
          ? tier.maxNumberOfTokensPercentage / 100
          : undefined,
    };
  });

const tierTargetCounts = (
  tiers: Tier[],
  poolSize: number,
): Map<string, number> => {
  const targets = new Map<string, number>();
  for (const tier of tiers) {
    targets.set(tier.id, Math.round(poolSize * tier.targetPct));
  }
  return targets;
};

// step 1: seed a RANDOM NUMBER (1..MAX_ANCHOR_CARDS) of random top-tier cards.
const pickAnchorCards = <T>(
  cardsByTier: Map<string, Card<T>[]>,
  tiers: Tier[],
  tierTargets: Map<string, number>,
  selectedIds: Set<string>,
  tierCounts: Map<string, number>,
  rng: Rng,
): Card<T>[] => {
  let topTier: Tier | null = null;
  for (const tier of tiers) {
    const taken = tierCounts.get(tier.id) ?? 0;
    if (taken >= tier.maxCards) continue;
    if ((tierTargets.get(tier.id) ?? 0) <= 0) continue;
    if (!topTier || tier.low > topTier.low) topTier = tier;
  }
  if (!topTier) return [];

  const tierCards = cardsByTier.get(topTier.id);
  if (!tierCards || tierCards.length === 0) return [];

  const available = tierCards.filter((c) => !selectedIds.has(c.id));
  if (available.length === 0) return [];

  const howMany = Math.floor(rng() * MAX_ANCHOR_CARDS) + 1;
  const cardsWeHave = available.length;
  const spareRoom = topTier.maxCards - (tierCounts.get(topTier.id) ?? 0);
  const count = Math.min(howMany, cardsWeHave, spareRoom);

  const pool = [...available];
  const anchors: Card<T>[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * pool.length);
    const [picked] = pool.splice(index, 1);
    if (picked) anchors.push(picked);
  }
  return anchors;
};

const dropOneAnchor = <T>(anchors: Card<T>[], rng: Rng): Card<T>[] => {
  const index = Math.floor(rng() * anchors.length);
  return anchors.filter((_, i) => i !== index);
};

// step 2: score a card as the NEXT pick (bigger = better).
const scoreCard = <T>(
  card: Card<T>,
  tiers: Map<string, Tier>,
  tierTargets: Map<string, number>,
  tierCounts: Map<string, number>,
  center: number,
  maxDistance: number,
  lowerBound: number,
  upperBound: number,
): number => {
  const evScore = Math.max(
    0,
    1 - Math.abs(card.value - center) / (maxDistance * 2),
  );

  const inBand = card.value >= lowerBound && card.value <= upperBound;
  const toleranceBonus = inBand ? TOLERANCE_BONUS : 0;

  const target = tierTargets.get(card.tier) ?? 0;
  const current = tierCounts.get(card.tier) ?? 0;
  const deficit = Math.max(0, target - current);
  const tierNeedScore = target > 0 ? Math.min(1, deficit / target) : 0;

  const tier = tiers.get(card.tier);
  const inTierRange =
    tier !== undefined && card.value >= tier.low && card.value <= tier.high;
  const tierRangeBonus = inTierRange ? TIER_RANGE_BONUS : 0;

  return (
    evScore * EV_SCORE_WEIGHT +
    tierNeedScore * TIER_NEED_WEIGHT +
    toleranceBonus +
    tierRangeBonus
  );
};

const scoreAndSort = <T>(
  cards: Card<T>[],
  tiers: Map<string, Tier>,
  tierTargets: Map<string, number>,
  tierCounts: Map<string, number>,
  center: number,
  maxDistance: number,
  lowerBound: number,
  upperBound: number,
): Card<T>[] =>
  cards
    .map((card) => ({
      card,
      score: scoreCard(
        card,
        tiers,
        tierTargets,
        tierCounts,
        center,
        maxDistance,
        lowerBound,
        upperBound,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.card);

// step 3: any tier below its minimum is topped up (closest to centre first),
// never growing the pool past `poolSize`.
const fillTierMinimums = <T>(
  selected: Card<T>[],
  selectedIds: Set<string>,
  cardsByTier: Map<string, Card<T>[]>,
  tiers: Tier[],
  tierCounts: Map<string, number>,
  poolSize: number,
  center: number,
): void => {
  for (const tier of tiers) {
    const have = tierCounts.get(tier.id) ?? 0;
    if (have >= tier.minCards) continue;

    const needed = tier.minCards - have;
    const candidates = (cardsByTier.get(tier.id) ?? [])
      .filter((c) => !selectedIds.has(c.id))
      .sort((a, b) => Math.abs(a.value - center) - Math.abs(b.value - center));

    for (const card of candidates.slice(0, needed)) {
      if (selected.length >= poolSize) break;
      selected.push(card);
      selectedIds.add(card.id);
      tierCounts.set(tier.id, (tierCounts.get(tier.id) ?? 0) + 1);
    }
  }
};

// step 4: same-tier swaps until the EV is back in-band (anchors protected).
const balanceEv = <T>(
  selected: Card<T>[],
  selectedIds: Set<string>,
  cardsByTier: Map<string, Card<T>[]>,
  startTotal: number,
  lowerBound: number,
  upperBound: number,
  center: number,
  anchorIds: Set<string>,
): void => {
  if (selected.length === 0) return;

  const poolSize = selected.length;
  let total = startTotal;

  const availableByTier = new Map<string, Card<T>[]>();
  for (const [tier, cards] of cardsByTier) {
    availableByTier.set(
      tier,
      cards.filter((c) => !selectedIds.has(c.id)),
    );
  }

  for (let iteration = 0; iteration < MAX_BALANCING_ITERATIONS; iteration++) {
    const currentEV = total / poolSize;
    if (currentEV >= lowerBound && currentEV <= upperBound) break;

    const needsHigher = currentEV < lowerBound;

    let bestSwap: {
      removeIdx: number;
      removeCard: Card<T>;
      addCard: Card<T>;
      valueDiff: number;
      improvement: number;
    } | null = null;

    for (const [i, currentCard] of selected.entries()) {
      if (anchorIds.has(currentCard.id)) continue;

      const replacements = availableByTier.get(currentCard.tier);
      if (!replacements || replacements.length === 0) continue;

      for (const replacement of replacements) {
        const valueDiff = replacement.value - currentCard.value;
        if (
          (needsHigher && valueDiff <= 0) ||
          (!needsHigher && valueDiff >= 0)
        ) {
          continue;
        }

        const newEV = (total + valueDiff) / poolSize;
        const improvement =
          Math.abs(currentEV - center) - Math.abs(newEV - center);

        if (
          improvement > 0 &&
          (!bestSwap || improvement > bestSwap.improvement)
        ) {
          bestSwap = {
            removeIdx: i,
            removeCard: currentCard,
            addCard: replacement,
            valueDiff,
            improvement,
          };
        }
      }
    }

    if (!bestSwap) break;

    const removed = bestSwap.removeCard;
    selectedIds.delete(removed.id);
    selected[bestSwap.removeIdx] = bestSwap.addCard;
    selectedIds.add(bestSwap.addCard.id);

    const pool = availableByTier.get(removed.tier);
    if (pool) {
      const addIdx = pool.findIndex((c) => c.id === bestSwap!.addCard.id);
      if (addIdx !== -1) pool.splice(addIdx, 1);
      pool.push(removed);
    }

    total += bestSwap.valueDiff;
  }
};

type Pool<T> = {
  cards: Card<T>[];
  ev: number;
  distanceFromCenter: number;
  inBand: boolean;
  meetsTierMinimums: boolean; // every tier holds at least its minCards
};

const buildPool = <T>(
  cards: Card<T>[],
  cardsByTier: Map<string, Card<T>[]>,
  tiers: Tier[],
  tierMap: Map<string, Tier>,
  poolSize: number,
  center: number,
  maxDistance: number,
  lowerBound: number,
  upperBound: number,
  anchors: Card<T>[],
): Pool<T> => {
  const tierTargets = tierTargetCounts(tiers, poolSize);
  const tierCounts = new Map<string, number>(tiers.map((t) => [t.id, 0]));
  const selected: Card<T>[] = [];
  const selectedIds = new Set<string>();

  const anchorIds = new Set<string>();
  for (const anchor of anchors) {
    selected.push(anchor);
    selectedIds.add(anchor.id);
    anchorIds.add(anchor.id);
    tierCounts.set(anchor.tier, (tierCounts.get(anchor.tier) ?? 0) + 1);
  }
  let total = anchors.reduce((sum, anchor) => sum + anchor.value, 0);

  let ranked = scoreAndSort(
    cards,
    tierMap,
    tierTargets,
    tierCounts,
    center,
    maxDistance,
    lowerBound,
    upperBound,
  );

  const flexLower = lowerBound * (1 - BUILD_PHASE_EV_FLEXIBILITY);
  const flexUpper = upperBound * (1 + BUILD_PHASE_EV_FLEXIBILITY);
  const minPoolForEVCheck =
    anchors.length > 0
      ? Math.max(MIN_POOL_SIZE_FOR_EV_CHECK, Math.floor(poolSize * 0.5))
      : Math.min(
          MIN_POOL_SIZE_FOR_EV_CHECK,
          Math.floor(poolSize * MIN_POOL_SIZE_PERCENT_FOR_EV_CHECK),
        );

  for (const card of ranked) {
    if (selected.length >= poolSize) break;
    if (selectedIds.has(card.id)) continue;

    const tier = tierMap.get(card.tier);
    if (!tier) continue;

    const taken = tierCounts.get(card.tier) ?? 0;
    const target = tierTargets.get(card.tier) ?? 0;
    if (taken >= tier.maxCards) continue;
    // Hard share cap: the tier may hold at most floor(poolSize * maxShare)
    // cards of this pool.
    if (
      tier.maxShare !== undefined &&
      taken >= Math.floor(poolSize * tier.maxShare)
    ) {
      continue;
    }
    if (taken >= Math.ceil(target * TIER_OVERAGE_MULTIPLIER)) continue;

    const newEV = (total + card.value) / (selected.length + 1);
    if (selected.length >= minPoolForEVCheck) {
      if (newEV < flexLower || newEV > flexUpper) continue;
    }

    selected.push(card);
    selectedIds.add(card.id);
    total += card.value;
    tierCounts.set(card.tier, taken + 1);

    if (
      selected.length % RESCORE_INTERVAL === 0 &&
      selected.length < poolSize
    ) {
      ranked = scoreAndSort(
        cards.filter((c) => !selectedIds.has(c.id)),
        tierMap,
        tierTargets,
        tierCounts,
        center,
        maxDistance,
        lowerBound,
        upperBound,
      );
    }
  }

  fillTierMinimums(
    selected,
    selectedIds,
    cardsByTier,
    tiers,
    tierCounts,
    poolSize,
    center,
  );

  total = selected.reduce((sum, c) => sum + c.value, 0);
  balanceEv(
    selected,
    selectedIds,
    cardsByTier,
    total,
    lowerBound,
    upperBound,
    center,
    anchorIds,
  );

  const finalTotal = selected.reduce((sum, c) => sum + c.value, 0);
  const ev = selected.length > 0 ? finalTotal / selected.length : 0;
  // tierCounts is still accurate here: balanceEv only swaps within a tier.
  return {
    cards: selected,
    ev,
    distanceFromCenter: Math.abs(ev - center),
    inBand: ev >= lowerBound && ev <= upperBound,
    meetsTierMinimums: tiers.every(
      (t) => (tierCounts.get(t.id) ?? 0) >= t.minCards,
    ),
  };
};

const pickBestPool = <T>(pools: Pool<T>[]): Pool<T> | null => {
  const nonEmpty = pools.filter((p) => p.cards.length > 0);
  if (nonEmpty.length === 0) return null;

  // Prefer pools that meet every tier minimum (the acceptance check
  // hard-rejects ones that don't); fall back to all if none do.
  const meetsMin = nonEmpty.filter((p) => p.meetsTierMinimums);
  const candidates = meetsMin.length > 0 ? meetsMin : nonEmpty;

  const inBand = candidates.filter((p) => p.inBand);
  const pickFrom = inBand.length > 0 ? inBand : candidates;
  return pickFrom.reduce((best, p) =>
    p.distanceFromCenter < best.distanceFromCenter ? p : best,
  );
};

type EvBand = {
  targetEv: number;
  lowerBound: number;
  upperBound: number;
  center: number;
  maxDistance: number;
};

const evBand = (config: AlgoConfig): EvBand => {
  const targetEv = config.targetExpectedValueInUsd;
  const lowerEv = config.lowerExpectedValueInUsd;
  const upperEv = config.upperExpectedValueInUsd;

  const lowerTol = (targetEv - lowerEv) / targetEv;
  const upperTol = (upperEv - targetEv) / targetEv;
  if (lowerTol < 0 || lowerTol > 0.5 || upperTol < 0 || upperTol > 0.5) {
    throw new Error("EV band must be within 50% of the target EV");
  }

  const lowerBound = targetEv * (1 - lowerTol);
  const upperBound = targetEv * (1 + upperTol);
  return {
    targetEv,
    lowerBound,
    upperBound,
    center: (lowerBound + upperBound) / 2,
    maxDistance: (upperBound - lowerBound) / 2,
  };
};

// Cards sorted cheapest → most expensive (later steps assume value order).
//
// The lowest tier's floor is a hard limit: sub-floor tokens are dropped here,
// before they can be classified (tierOf would otherwise bucket them into the
// lowest tier) or picked. This is the only place that builds Cards, so nothing
// downstream — anchors, greedy add, tier-minimum fill, EV balancing — can see
// them. Higher tiers' floors stay classification only: a value between two
// floors just lands in the lower tier.
const toCards = <T extends AlgoToken>(
  tokens: T[],
  tiersAsc: AlgoTierConfig[],
): Card<T>[] => {
  // tiersAsc is already sorted by floor, so [0] is the lowest floor.
  const floor = tiersAsc[0]?.floorValueInUsd;
  const eligible =
    floor === undefined
      ? tokens
      : tokens.filter((token) => token.valueInUsd >= floor);

  return [...eligible]
    .sort((a, b) =>
      a.valueInUsd === b.valueInUsd ? 0 : a.valueInUsd < b.valueInUsd ? -1 : 1,
    )
    .map((token) => ({
      token,
      id: token.tokenId,
      value: token.valueInUsd,
      tier: tierOf(token.valueInUsd, tiersAsc),
    }));
};

const groupByTier = <T>(cards: Card<T>[]): Map<string, Card<T>[]> => {
  const byTier = new Map<string, Card<T>[]>();
  for (const card of cards) {
    const list = byTier.get(card.tier);
    if (list) list.push(card);
    else byTier.set(card.tier, [card]);
  }
  return byTier;
};

// Anchors picked ONCE; each attempt builds a pool at a freshly drawn random
// size (uniform over the configured [lower, upper] range); progressive
// relaxation drops one anchor at random when no attempt lands in-band.
const searchBestPool = <T>(
  cards: Card<T>[],
  cardsByTier: Map<string, Card<T>[]>,
  tiers: Tier[],
  tierMap: Map<string, Tier>,
  band: EvBand,
  lowerSize: number,
  upperSize: number,
  rng: Rng,
): Pool<T> | null => {
  const earlyTerminationDistance = band.targetEv * EARLY_TERMINATION_THRESHOLD;

  // Tier eligibility for the anchor pick uses the middle of the size range.
  const tierTargets = tierTargetCounts(
    tiers,
    Math.round((lowerSize + upperSize) / 2),
  );
  const emptyCounts = new Map<string, number>(tiers.map((t) => [t.id, 0]));
  let anchors = pickAnchorCards(
    cardsByTier,
    tiers,
    tierTargets,
    new Set<string>(),
    emptyCounts,
    rng,
  );

  let bestSeen: Pool<T> | null = null;
  let relaxing = true;
  while (relaxing) {
    const pools: Pool<T>[] = [];
    for (let attempt = 0; attempt < MAX_POOLS_PER_LEVEL; attempt++) {
      // A fresh uniform integer draw over [lower, upper] for every attempt.
      const drawnSize =
        lowerSize + Math.floor(rng() * (upperSize - lowerSize + 1));
      const poolSize = Math.max(MIN_ABSOLUTE_POOL_SIZE, drawnSize);
      if (poolSize > cards.length) continue; // not enough cards for this size

      const pool = buildPool(
        cards,
        cardsByTier,
        tiers,
        tierMap,
        poolSize,
        band.center,
        band.maxDistance,
        band.lowerBound,
        band.upperBound,
        anchors,
      );
      pools.push(pool);

      if (pool.inBand && pool.distanceFromCenter < earlyTerminationDistance) {
        break;
      }
    }

    const best = pickBestPool(pools);
    if (
      best &&
      (!bestSeen || best.distanceFromCenter < bestSeen.distanceFromCenter)
    ) {
      bestSeen = best;
    }

    if (best?.inBand) return best;
    if (anchors.length <= 1) relaxing = false;
    else anchors = dropOneAnchor(anchors, rng);
  }
  return bestSeen;
};

/** One full run of the Fair Set Adaptive Algorithm over an injected rng. */
export function fairSetRanked<T extends AlgoToken>(
  tokens: T[],
  config: AlgoConfig,
  rng: Rng,
): T[] {
  const band = evBand(config);
  const tiersAsc = [...config.tiers].sort(
    (a, b) => a.floorValueInUsd - b.floorValueInUsd,
  );
  const tiers = toTiers(tiersAsc);
  const tierMap = new Map(tiers.map((t) => [t.id, t]));
  const cards = toCards(tokens, tiersAsc);
  const cardsByTier = groupByTier(cards);

  // Size bounds for the random draws. upperNumberOfTokensInNewSet is the
  // only size cap.
  const upperSize = config.upperNumberOfTokensInNewSet;
  const lowerSize = Math.min(config.lowerNumberOfTokensInNewSet, upperSize);

  const best = searchBestPool(
    cards,
    cardsByTier,
    tiers,
    tierMap,
    band,
    lowerSize,
    upperSize,
    rng,
  );

  return best ? best.cards.map((c) => c.token) : [];
}

