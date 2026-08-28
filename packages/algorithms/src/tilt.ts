/**
 * Fair Set Adaptive — tilt. Globally monotone max-entropy value tilt, flat-deformed per tier, drawn by PPS combs. Contract: `(tokens, config, rng) => tokens` — all randomness from the injected rng, inputs never mutated, replayable bit for bit on one JS engine family (the tilt uses Math.exp; verifiers replay on V8/Node).
 * Each attempt draws a set size, apportions per-tier quotas inside every hard bound (upper size, EV band, tier min/max, share caps, the 50% band rule), shifts counts until the reachable totals hold the target, then draws by one saturated tilt π = min(1, c·e^{s·v}) over the WHOLE non-anchor pool —
 * max-entropy under the count constraint, monotone in value, so no interior value region can starve between two heavily-used ones — flat-deformed per tier to its quota, the global slope bisected to land the target EV, realized exactly by one systematic PPS comb per tier;
 * a same-tier window-swap repair walks the EV into the band. Anchors (1–10 random chase cards from the most valuable eligible tier; target 0 disables) always remain in the formed set, and the pick stops before an anchor no feasible size could carry to the target EV.
 * Soft conditions are steered for but never force a failure — the best attempt is returned, and the acceptance gate decides what lands.
 */
import type { AlgoConfig, AlgoToken, Rng } from "./algo-types";
const MAX_ATTEMPTS = 16,
  MIN_ABSOLUTE_SET_SIZE = 10,
  MAX_ANCHOR_CARDS = 10,
  REPAIR_SWAPS_BASE = 100,
  SIZE_FIT_ROUNDS = 8,
  QUOTA_SHIFT_LIMIT = 2000; // attempts all keep every anchor; repair budget = base + set size; caps on the size fixed-point and the quota feasibility shifts
const BEND_FRAC = 0.05,
  DIP_TOL = 0.003; // count moves the bend may make (× size); fair-spend drift dip-filling tolerates (× target total)
const TILT_STEEP = 2000,
  TILT_ITERS = 60,
  EV_REPAIR_TOL = 2,
  EV_ACCEPT_FRAC = 0.05; // weight-ratio exponent across the value span at full tilt (x = ±1 reaches the quota window's edges); slope-bisection iterations; repair polishes to ±tol; accept at |ev − target| ≤ frac × half-band
type Card<T> = { token: T; id: string; value: number; tier: number };
type TierInfo = {
  minCards: number;
  maxCards: number;
  targetPct: number;
  maxShare: number | undefined;
};
type Band = { lowerEv: number; upperEv: number; target: number };
type SizePlan = { size: number; quotas: number[] };
type TierPool<T> = { cards: Card<T>[]; vals: number[]; pre: number[] }; // one tier's non-anchor cards, value-ascending; pre[k] = Σ of the k cheapest values
const evBand = ({
  targetExpectedValueInUsd: target,
  lowerExpectedValueInUsd: lowerEv,
  upperExpectedValueInUsd: upperEv,
}: AlgoConfig): Band => {
  const lowerTol = (target - lowerEv) / target,
    upperTol = (upperEv - target) / target; // !(… ≤ 0.5) below also catches the NaN tolerances of a zero/negative target
  if (
    !(lowerTol >= 0) ||
    !(lowerTol <= 0.5) ||
    !(upperTol >= 0) ||
    !(upperTol <= 0.5)
  )
    throw new Error("EV band must be within 50% of the target EV");
  return { lowerEv, upperEv, target };
};
// Cards sorted cheapest → most expensive; the lowest tier's floor is a hard drop, higher floors classify (tier = index in ascending-floor order).
const toCards = <T extends AlgoToken>(
  tokens: readonly T[],
  floors: number[],
): Card<T>[] => {
  const lowest = floors[0],
    tierOf = (v: number): number =>
      floors.reduce((acc, f, i) => (v >= f ? i : acc), 0);
  return tokens
    .filter((t) => lowest === undefined || t.valueInUsd >= lowest)
    .map((t) => ({
      token: t,
      id: t.tokenId,
      value: t.valueInUsd,
      tier: tierOf(t.valueInUsd),
    }))
    .sort((a, b) => a.value - b.value);
};
const tierPool = <T>(cards: Card<T>[]): TierPool<T> => {
  const vals = cards.map((c) => c.value),
    pre = [0];
  for (const [i, v] of vals.entries()) pre.push((pre[i] ?? 0) + v);
  return { cards, vals, pre };
};
// Anchors: the most valuable tier wanting cards (target% > 0, maxCards room, eligible cards) seeds 1–10 random chase cards, capped by availability, maxCards, share cap, affordability, and a quarter of the tier.
const pickAnchorCards = <T>(
  byTier: readonly (readonly Card<T>[])[],
  tiers: TierInfo[],
  floors: number[],
  upperSize: number,
  affordable: (anchors: readonly Card<T>[]) => boolean,
  rng: Rng,
): Card<T>[] => {
  let top = -1;
  tiers.forEach((t, i) => {
    if (
      t.targetPct > 0 &&
      t.maxCards > 0 &&
      (byTier[i]?.length ?? 0) > 0 &&
      (top < 0 || (floors[i] ?? 0) > (floors[top] ?? 0))
    )
      top = i;
  });
  if (top < 0) return [];
  const tier = tiers[top],
    pool = [...(byTier[top] ?? [])],
    howMany = Math.floor(rng() * MAX_ANCHOR_CARDS) + 1;
  const shareRoom =
    tier?.maxShare !== undefined
      ? Math.floor(upperSize * tier.maxShare)
      : Number.POSITIVE_INFINITY;
  const count = Math.min(
      howMany,
      pool.length,
      tier?.maxCards ?? 0,
      shareRoom,
      Math.max(1, Math.ceil(pool.length / 4)),
    ),
    anchors: Card<T>[] = [];
  for (
    let draws = 0;
    anchors.length < count &&
    pool.length > 0 &&
    draws < count + MAX_ANCHOR_CARDS;
    draws++
  ) {
    const [picked] = pool.splice(Math.floor(rng() * pool.length), 1);
    if (!picked) break;
    if (affordable([...anchors, picked])) {
      anchors.push(picked);
      continue;
    }
    if (anchors.length > 0) break; // an unaffordable pick ends the batch — except the very first, where the bounded walk keeps drawing so a lone whale can't doom the formation
  }
  return anchors;
};
const tierCaps = (
  tiers: TierInfo[],
  size: number,
  avail: readonly number[],
): number[] =>
  tiers.map((t, i) =>
    Math.min(
      t.maxCards,
      t.maxShare !== undefined ? Math.floor(size * t.maxShare) : size,
      avail[i] ?? 0,
    ),
  );
// Nudge an infeasible drawn size to the nearest one whose tier floors and caps can both hold, inside [MIN_ABSOLUTE_SET_SIZE, upper]; the size floor is soft, the hard bounds are not.
const fitSize = (
  tiers: TierInfo[],
  drawn: number,
  upper: number,
  avail: readonly number[],
  aCount: readonly number[],
): number => {
  let size = drawn;
  for (let round = 0; round < SIZE_FIT_ROUNDS; round++) {
    const caps = tierCaps(tiers, size, avail),
      floors = tiers.map((t, i) => Math.max(t.minCards, aCount[i] ?? 0));
    const shareNeed = Math.max(
      0,
      ...tiers.map((t, i) =>
        t.maxShare !== undefined && t.maxShare > 0
          ? Math.ceil((floors[i] ?? 0) / t.maxShare)
          : 0,
      ),
    );
    const next = Math.max(
      MIN_ABSOLUTE_SET_SIZE,
      Math.min(
        Math.max(
          size,
          floors.reduce((a, b) => a + b, 0),
          shareNeed,
        ),
        caps.reduce((a, b) => a + b, 0),
        upper,
      ),
    );
    if (next === size) break;
    size = next; // a share-capped tier needs the set big enough for its floor to fit
  }
  return size;
};
// Per-tier counts (anchors included): apportioned to the target shares inside every hard bound, then shifted one at a time until the window of reachable totals holds the target total. Null = size can't work.
const quotasFor = <T>(
  tiers: TierInfo[],
  size: number,
  pools: TierPool<T>[],
  aCount: readonly number[],
  aSum: number,
  band: Band,
  toTarget = false,
): number[] | null => {
  const caps = tierCaps(
      tiers,
      size,
      pools.map((l, i) => l.vals.length + (aCount[i] ?? 0)),
    ),
    floors = tiers.map((t, i) => Math.max(t.minCards, aCount[i] ?? 0));
  if (
    floors.some((f, i) => f > (caps[i] ?? 0)) ||
    floors.reduce((a, b) => a + b, 0) > size ||
    caps.reduce((a, b) => a + b, 0) < size
  )
    return null;
  const ideal = tiers.map((t) => size * t.targetPct),
    q = tiers.map((_t, i) =>
      Math.max(
        floors[i] ?? 0,
        Math.min(caps[i] ?? 0, Math.round(ideal[i] ?? 0)),
      ),
    );
  for (
    let total = q.reduce((a, b) => a + b, 0);
    total !== size;
    total += total < size ? 1 : -1
  ) {
    // walk the total onto `size`, moving the tier furthest from its ideal share; a zero-target tier is aimed empty — it only grows as the last resort (the feasibility shifts may still use it)
    const growing = total < size;
    let pick = -1,
      pickGap = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const within = growing
        ? (q[i] ?? 0) < (caps[i] ?? 0)
        : (q[i] ?? 0) > (floors[i] ?? 0);
      const gap =
        (growing
          ? (ideal[i] ?? 0) - (q[i] ?? 0)
          : (q[i] ?? 0) - (ideal[i] ?? 0)) -
        (growing && (tiers[i]?.targetPct ?? 0) <= 0
          ? Number.MAX_SAFE_INTEGER
          : 0);
      if (within && gap > pickGap) {
        pick = i;
        pickGap = gap;
      }
    }
    if (pick < 0) return null;
    q[pick] = (q[pick] ?? 0) + (growing ? 1 : -1);
  } // reachable totals from q: [aSum + Σ cheapest, aSum + Σ priciest]
  const need = (i: number): number => (q[i] ?? 0) - (aCount[i] ?? 0);
  let minT = aSum + pools.reduce((a, l, i) => a + (l.pre[need(i)] ?? 0), 0);
  let maxT =
    aSum +
    pools.reduce(
      (a, l, i) =>
        a + (l.pre[l.vals.length] ?? 0) - (l.pre[l.vals.length - need(i)] ?? 0),
      0,
    );
  const targetTotal = band.target * size;
  for (
    let guard = 0;
    (minT > targetTotal || maxT < targetTotal) && guard < QUOTA_SHIFT_LIMIT;
    guard++
  ) {
    const down = minT > targetTotal;
    let bi = -1,
      bj = -1,
      bMin = 0,
      bMax = 0,
      bGain = down ? 0 : -Infinity; // down = need cheaper reachable totals; a shift: i loses one card, j gains one
    for (let pass = 0; pass < 2 && bi < 0; pass++) {
      // pass 0 only feeds tiers the config wants (target% > 0); a zero-target tier is the last resort, not the biggest jump
      for (let i = 0; i < q.length; i++) {
        if ((q[i] ?? 0) <= (floors[i] ?? 0) || need(i) <= 0) continue;
        for (let j = 0; j < q.length; j++) {
          const li = pools[i],
            lj = pools[j];
          if (
            j === i ||
            !li ||
            !lj ||
            (q[j] ?? 0) >= (caps[j] ?? 0) ||
            (pass === 0 && (tiers[j]?.targetPct ?? 0) <= 0)
          )
            continue;
          const dMin = (lj.vals[need(j)] ?? 0) - (li.vals[need(i) - 1] ?? 0);
          const dMax =
            (lj.vals[lj.vals.length - need(j) - 1] ?? 0) -
            (li.vals[li.vals.length - need(i)] ?? 0);
          const gain = down ? dMin : dMax;
          if (down ? gain < bGain : gain > bGain) {
            bi = i;
            bj = j;
            bMin = dMin;
            bMax = dMax;
            bGain = gain;
          }
        }
      }
    }
    if (bi < 0) break;
    q[bi] = (q[bi] ?? 0) - 1;
    q[bj] = (q[bj] ?? 0) + 1;
    minT += bMin;
    maxT += bMax; // break = stuck: no shift moves the window further
  }
  return minT <= (toTarget ? targetTotal : band.upperEv * size) + size - 1 &&
    maxT >= (toTarget ? targetTotal : band.lowerEv * size)
    ? q
    : null;
}; // `toTarget` (the anchor-affordability bar) asks for the target EV itself, not just band overlap
// Quota bend, a shared budget of ≤ BEND_FRAC × size count moves. Phase 1 bends the composition toward the one whose plain fair sampling spends the target total (a smaller residual means gentler tilt); phase 2 spends what is left on interior dips of the tier usage-rate staircase via single moves or spend-cancelling pairs, never drifting the fair spend beyond a small tolerance. Moves keep floors/caps, only feed target% > 0 tiers, never worsen the window.
const bendQuotas = <T>(
  q: number[],
  tiers: TierInfo[],
  pools: TierPool<T>[],
  aCount: readonly number[],
  aSum: number,
  size: number,
  target: number,
): void => {
  const avail = pools.map((l, i) => l.vals.length + (aCount[i] ?? 0));
  const caps = tierCaps(tiers, size, avail),
    floors = tiers.map((t, i) => Math.max(t.minCards, aCount[i] ?? 0));
  const m = pools.map((l) => l.vals.length),
    mean = pools.map((l, i) =>
      (m[i] ?? 0) > 0 ? (l.pre[m[i] ?? 0] ?? 0) / (m[i] ?? 1) : 0,
    );
  const need = (i: number): number => (q[i] ?? 0) - (aCount[i] ?? 0),
    T = target * size;
  const window = (): number => {
    const minT =
      aSum +
      pools.reduce(
        (a, l, i) => a + (l.pre[Math.min(need(i), m[i] ?? 0)] ?? 0),
        0,
      );
    const maxT =
      aSum +
      pools.reduce(
        (a, l, i) =>
          a +
          (l.pre[m[i] ?? 0] ?? 0) -
          (l.pre[Math.max(0, (m[i] ?? 0) - need(i))] ?? 0),
        0,
      );
    return Math.max(0, minT - T) + Math.max(0, T - maxT);
  }; // how badly the reachable totals miss holding the target
  const dip = (): number => {
    const r = q.map((qi, i) =>
      (avail[i] ?? 0) > 0 ? qi / (avail[i] ?? 1) : 0,
    );
    return r.reduce(
      (acc, ri, i) =>
        acc +
        (avail[i] ?? 0) *
          Math.max(
            0,
            Math.min(
              Math.max(...r.slice(0, i), 0),
              Math.max(...r.slice(i + 1), 0),
            ) - ri,
          ),
      0,
    );
  }; // card-weighted interior-dip depth of the tier usage rates
  const can = (a: number, b: number): boolean =>
    a !== b &&
    (q[a] ?? 0) > (floors[a] ?? 0) &&
    need(a) > 0 &&
    (q[b] ?? 0) < (caps[b] ?? 0) &&
    (tiers[b]?.targetPct ?? 0) > 0 &&
    need(b) < (m[b] ?? 0);
  const shift = (
    mvs: readonly (readonly [number, number])[],
    dir: number,
  ): void => {
    for (const [a, b] of mvs) {
      q[a] = (q[a] ?? 0) - dir;
      q[b] = (q[b] ?? 0) + dir;
    }
  };
  const gain = (mvs: readonly (readonly [number, number])[]): number =>
    mvs.reduce((acc, [a, b]) => acc + (mean[b] ?? 0) - (mean[a] ?? 0), 0);
  const commit = (mvs: readonly (readonly [number, number])[]): boolean => {
    const before = window();
    shift(mvs, 1);
    if (window() > before) {
      shift(mvs, -1);
      return false;
    }
    fair += gain(mvs);
    return true;
  };
  let fair = aSum + q.reduce((a, _, i) => a + need(i) * (mean[i] ?? 0), 0),
    budget = Math.round(BEND_FRAC * size);
  while (budget > 0) {
    let best: [number, number] | null = null,
      bGap = Math.abs(fair - T) - 1e-9; // phase 1: pull the fair spend onto the target
    for (let a = 0; a < q.length; a++)
      for (let b = 0; b < q.length; b++) {
        if (!can(a, b)) continue;
        const gap = Math.abs(fair + (mean[b] ?? 0) - (mean[a] ?? 0) - T);
        if (gap < bGap) {
          best = [a, b];
          bGap = gap;
        }
      }
    if (!best || !commit([best])) break;
    budget--;
  }
  const gapTol = Math.max(Math.abs(fair - T), DIP_TOL * T * size);
  while (budget > 0) {
    const d0 = dip() - 1e-9;
    let best: { mvs: (readonly [number, number])[]; d: number } | null = null; // phase 2: fill staircase dips without drifting the spend
    const consider = (mvs: (readonly [number, number])[]): void => {
      if (Math.abs(fair + gain(mvs) - T) > gapTol) return;
      shift(mvs, 1);
      const d = dip();
      shift(mvs, -1);
      if (d < d0 && (!best || d < best.d - 1e-9)) best = { mvs, d };
    };
    for (let a = 0; a < q.length; a++)
      for (let b = 0; b < q.length; b++) {
        if (!can(a, b)) continue;
        consider([[a, b]]);
        if (budget < 2) continue;
        const partners: (readonly [number, number])[] = [];
        shift([[a, b]], 1); // a partner move is only legal on top of the first
        for (let c = 0; c < q.length; c++)
          for (let e = 0; e < q.length; e++)
            if (can(c, e)) partners.push([c, e]);
        shift([[a, b]], -1);
        for (const p of partners) consider([[a, b], p]);
      }
    if (!best) break;
    const chosen: { mvs: (readonly [number, number])[]; d: number } = best;
    if (!commit(chosen.mvs)) break;
    budget -= chosen.mvs.length;
  }
};
// π = min(1, c·e^{s·v}) with Σπ = need — max-entropy under the count constraint, monotone in value. Returns the expected spend (fills π when asked): the k heaviest saturate at 1, the rest share the remaining count in proportion to weight; the S underflow guard keeps an extreme slope exact (vanished light tail → simply the heaviest `need` cards).
const saturatedTilt = (
  vals: readonly number[],
  need: number,
  s: number,
  out?: number[],
): number => {
  const m = vals.length;
  if (need <= 0 || m === 0) {
    out?.fill(0);
    return 0;
  }
  if (need >= m) {
    out?.fill(1);
    return vals.reduce((a, b) => a + b, 0);
  }
  const vRef = s >= 0 ? (vals[m - 1] ?? 0) : (vals[0] ?? 0),
    w = vals.map((v) => Math.exp(s * (v - vRef)));
  let S = 0,
    SV = 0;
  for (let j = 0; j < m; j++) {
    S += w[j] ?? 0;
    SV += (w[j] ?? 0) * (vals[j] ?? 0);
  } // Σw, Σw·v over the unsaturated pool
  let k = 0,
    satV = 0,
    p = s >= 0 ? m - 1 : 0; // saturate from the heavy end while π would exceed 1
  while (k < need && ((need - k) * (w[p] ?? 0) > S || S < 1e-280)) {
    k++;
    S -= w[p] ?? 0;
    SV -= (w[p] ?? 0) * (vals[p] ?? 0);
    satV += vals[p] ?? 0;
    if (out) out[p] = 1;
    p += s >= 0 ? -1 : 1;
  }
  const c = k < need && S > 1e-280 ? (need - k) / S : 0;
  if (out)
    for (let j = s >= 0 ? 0 : k, to = s >= 0 ? m - k : m; j < to; j++)
      out[j] = Math.min(1, c * (w[j] ?? 0));
  return satV + c * SV;
};
// Minimal flat deformation of a monotone π-profile to sum `count`: a flat cap min(π, φ) where the base over-covers the tier, a flat floor min(1, max(π, θ)) where it under-covers — each one water-filling walk (`asc` = which end holds the smallest π). Plateaus, not rescalings, so reconciling quotas cannot cut the cross-tier valleys a lift would.
const flatten = (pi: number[], count: number, asc: boolean): void => {
  const m = pi.length,
    at = (k: number): number => pi[asc ? k : m - 1 - k] ?? 0; // k-th smallest π
  if (count <= 0 || m === 0) {
    pi.fill(0);
    return;
  }
  if (count >= m) {
    pi.fill(1);
    return;
  }
  let sum = 0;
  for (let j = 0; j < m; j++) {
    pi[j] = Math.min(1, pi[j] ?? 0);
    sum += pi[j] ?? 0;
  } // clamp and total the base profile
  if (sum > count)
    for (let k = 0, acc = 0; k < m; acc += at(k), k++) {
      // cap: the k smallest keep π, the rest contribute φ each
      const phi = (count - acc) / (m - k);
      if (phi <= at(k)) {
        for (let j = 0; j < m; j++) pi[j] = Math.min(pi[j] ?? 0, phi);
        return;
      }
    }
  else if (sum < count)
    for (let k = 1, pref = at(0); k <= m; pref += at(k), k++) {
      // floor: the k smallest lift to θ, the rest keep π
      const th = (count - sum + pref) / k;
      if (th <= (k < m ? at(k) : 1)) {
        for (let j = 0; j < m; j++) pi[j] = Math.max(pi[j] ?? 0, th);
        return;
      }
    }
};
// Per-tier inclusion probabilities whose expected total spend hits `goal` (clamped to what the needs can reach): one saturated tilt over the whole non-anchor pool (tiers are value bands, so concatenated pools stay value-sorted) is the base, each tier flat-deforms it to its quota, the slope is bisected to land the goal; equal-value runs share averaged π.
const buildPlan = <T>(
  pools: TierPool<T>[],
  need: readonly number[],
  goal: number,
): number[][] => {
  const all: number[] = [],
    off = [0];
  for (const l of pools) {
    all.push(...l.vals);
    off.push(all.length);
  }
  const total = need.reduce((a, b) => a + b, 0),
    span = Math.max(1, (all[all.length - 1] ?? 0) - (all[0] ?? 0));
  const base = new Array<number>(all.length).fill(0),
    pis = pools.map((l) => new Array<number>(l.vals.length).fill(0));
  const spendAt = (x: number): number => {
    saturatedTilt(all, total, (x * TILT_STEEP) / span, base);
    return pools.reduce((spend, l, i) => {
      const pi = pis[i] ?? [];
      for (let j = 0; j < pi.length; j++) pi[j] = base[(off[i] ?? 0) + j] ?? 0;
      flatten(pi, need[i] ?? 0, x >= 0);
      return spend + pi.reduce((a, p, j) => a + p * (l.vals[j] ?? 0), 0);
    }, 0);
  };
  let xLo = -1,
    xHi = 1;
  for (let iter = 0; iter < TILT_ITERS; iter++) {
    const xMid = (xLo + xHi) / 2;
    if (spendAt(xMid) < goal) xLo = xMid;
    else xHi = xMid;
  }
  spendAt(xLo); // the last spend lands the cheap side of the final bracket: never overshooting keeps the repair pull one-sided
  pools.forEach((l, i) => {
    const pi = pis[i] ?? [];
    for (let j = 0; j < pi.length;) {
      let k = j + 1,
        acc = pi[j] ?? 0;
      while (k < pi.length && l.vals[k] === l.vals[j]) {
        acc += pi[k] ?? 0;
        k++;
      } // average π across equal-value runs
      for (let t = j; t < k; t++) pi[t] = acc / (k - j);
      j = k;
    }
  });
  return pis;
};
// One systematic PPS comb per tier: one rng value rotates the comb; card j is taken when a comb point u, u+1, … falls in its π-slice of the cumulative sum. Exactly `count` cards land (float-drift shortfall topped up with the likeliest leftovers), inclusion chance is exactly π_j.
const combSample = <T>(
  tier: TierPool<T>,
  pis: readonly number[],
  count: number,
  rng: Rng,
): { picked: Card<T>[]; rest: Card<T>[] } => {
  const m = tier.cards.length;
  if (count <= 0) return { picked: [], rest: tier.cards };
  if (count >= m) return { picked: tier.cards, rest: [] };
  const take = new Array<boolean>(m).fill(false);
  let r = rng(),
    acc = 0,
    taken = 0; // r ∈ [0,1) rotates the comb
  for (let j = 0; j < m && taken < count; j++) {
    acc += pis[j] ?? 0;
    if (r < acc) {
      take[j] = true;
      taken++;
      r += 1;
    }
  }
  while (taken < count) {
    let best = -1;
    for (let j = 0; j < m; j++)
      if (!take[j] && (best < 0 || (pis[j] ?? 0) > (pis[best] ?? 0))) best = j;
    if (best < 0) break;
    take[best] = true;
    taken++;
  }
  return {
    picked: tier.cards.filter((_, j) => take[j]),
    rest: tier.cards.filter((_, j) => !take[j]),
  };
};
// Repair: while floor(total/size) is off the target EV, swap one selected card for a same-tier spare drawn at random from the value window that moves the total toward the target (anchors protected; tier counts never change).
const repairIntoBand = <T>(
  selected: Card<T>[],
  restByTier: Card<T>[][],
  size: number,
  band: Band,
  anchorIds: ReadonlySet<string>,
  rng: Rng,
): void => {
  let total = selected.reduce((a, c) => a + c.value, 0);
  const done = (): boolean =>
    Math.abs(Math.floor(total / size) - band.target) <= EV_REPAIR_TOL; // integer EV, like the acceptance gate
  for (let swap = 0; swap < REPAIR_SWAPS_BASE + size && !done(); swap++) {
    const delta = band.target * size - total,
      start = Math.floor(rng() * size);
    let swapped = false; // delta > 0 → need pricier cards
    for (let step = 0; step < size && !swapped; step++) {
      const at = (start + step) % size,
        current = selected[at];
      if (!current || anchorIds.has(current.id)) continue;
      const pool = restByTier[current.tier] ?? [];
      const low = Math.min(current.value, current.value + 2 * delta),
        high = Math.max(current.value, current.value + 2 * delta);
      let a = 0,
        b = pool.length;
      while (a < b) {
        const mid = (a + b) >> 1;
        if ((pool[mid]?.value ?? 0) <= low) a = mid + 1;
        else b = mid;
      } // the pool is value-sorted: binary-search the open window (low, high)
      let c = a,
        d = pool.length;
      while (c < d) {
        const mid = (c + d) >> 1;
        if ((pool[mid]?.value ?? 0) < high) c = mid + 1;
        else d = mid;
      }
      if (a >= c) continue;
      const [replacement] = pool.splice(a + Math.floor(rng() * (c - a)), 1);
      if (!replacement) continue;
      total += replacement.value - current.value;
      selected[at] = replacement;
      let back = 0;
      while (back < pool.length && (pool[back]?.value ?? 0) < current.value)
        back++;
      pool.splice(back, 0, current);
      swapped = true; // the swapped-out card returns to the pool in value order
    }
    if (!swapped) return;
  }
}; // stop early when no improving swap exists anywhere
/** One full run of Fair Set Adaptive (tilt) over an injected rng. */
export function fairSetTilt<T extends AlgoToken>(
  tokens: T[],
  config: AlgoConfig,
  rng: Rng,
): T[] {
  const band = evBand(config);
  const tiersAsc = [...config.tiers].sort(
      (a, b) => a.floorValueInUsd - b.floorValueInUsd,
    ),
    floors = tiersAsc.map((t) => t.floorValueInUsd);
  const tiers: TierInfo[] = tiersAsc.map((t) => ({
    minCards: t.minNumberOfTokens,
    maxCards: t.maxNumberOfTokens,
    targetPct: t.targetNumberOfTokensPercentage / 100,
    maxShare:
      t.maxNumberOfTokensPercentage !== undefined
        ? t.maxNumberOfTokensPercentage / 100
        : undefined,
  }));
  const cards = toCards(tokens, floors),
    byTier: Card<T>[][] = tiers.map(() => []);
  for (const card of cards) byTier[card.tier]?.push(card);
  const upperSize = config.upperNumberOfTokensInNewSet,
    lowerSize = Math.min(config.lowerNumberOfTokensInNewSet, upperSize);
  const evAccept = Math.max(
    EV_REPAIR_TOL,
    EV_ACCEPT_FRAC *
      Math.max(band.target - band.lowerEv, band.upperEv - band.target, 1),
  );
  const probeBases = new Set<number>();
  for (let step = 0; step <= 6; step++)
    probeBases.add(
      lowerSize + Math.round(((upperSize - lowerSize) * step) / 6),
    );
  for (
    let s = Math.min(upperSize, cards.length);
    s >= MIN_ABSOLUTE_SET_SIZE;
    s = Math.floor(s / 1.5)
  )
    probeBases.add(s); // probe bases: the drawn size range plus a log-spaced descent to the minimum viable size — the size floor is direction only, and the feasible sizes can sit entirely below it
  // Largest probed size whose quotas can hold the band around the given anchors (rng-free; the quota solver decides, so affordability and buildability agree). A bisection pushes the found size to the feasibility edge — but never past the tier pyramid's cap, above which some tier runs short of its target share (rerun uncapped if the cap holds nothing). `anyHit` takes any feasible size — existence is all the affordability check needs.
  const largestFeasible = (
    poolsX: TierPool<T>[],
    aCountX: readonly number[],
    aSumX: number,
    anyHit = false,
    noCap = false,
  ): SizePlan | null => {
    const availX = poolsX.map((l, i) => l.vals.length + (aCountX[i] ?? 0));
    const cap =
      noCap || anyHit
        ? Infinity
        : Math.floor(
            Math.min(
              ...tiers.map((t, i) =>
                t.targetPct > 0 ? (availX[i] ?? 0) / t.targetPct : Infinity,
              ),
            ),
          );
    const tryAt = (base: number): SizePlan | null => {
      const size = fitSize(
        tiers,
        Math.max(MIN_ABSOLUTE_SET_SIZE, Math.min(base, cap, cards.length)),
        upperSize,
        availX,
        aCountX,
      );
      const quotas = quotasFor(
        tiers,
        size,
        poolsX,
        aCountX,
        aSumX,
        band,
        anyHit,
      );
      return quotas ? { size, quotas } : null;
    };
    let found: SizePlan | null = null,
      ceiling = Math.min(upperSize, cards.length, cap) + 1;
    for (const base of probeBases) {
      if (found && Math.min(base, cap) <= found.size) continue;
      const hit = tryAt(base);
      if (hit && (!found || hit.size > found.size)) found = hit;
      else if (!hit && base < ceiling) ceiling = base;
      if (found && anyHit) return found;
    }
    for (let floor = found?.size ?? 0; found && ceiling - floor > 1;) {
      const mid = (floor + ceiling) >> 1,
        hit = tryAt(mid);
      if (hit && hit.size > found.size) {
        found = hit;
        floor = Math.max(mid, hit.size);
      } else ceiling = mid;
    }
    return (
      found ??
      (!noCap && !anyHit && cap < cards.length
        ? largestFeasible(poolsX, aCountX, aSumX, anyHit, true)
        : null)
    );
  };
  const affordable = (candidate: readonly Card<T>[]): boolean => {
    // affordable = can some allowed size still hold the band around these anchors?
    const ids = new Set(candidate.map((c) => c.id));
    return (
      largestFeasible(
        byTier.map((list) => tierPool(list.filter((c) => !ids.has(c.id)))),
        tiers.map((_, i) => candidate.filter((a) => a.tier === i).length),
        candidate.reduce((a, c) => a + c.value, 0),
        true,
      ) !== null
    );
  };
  const anchors = pickAnchorCards(
      byTier,
      tiers,
      floors,
      upperSize,
      affordable,
      rng,
    ),
    anchorIds = new Set(anchors.map((a) => a.id));
  const aCount = tiers.map(
      (_, i) => anchors.filter((a) => a.tier === i).length,
    ),
    aSum = anchors.reduce((a, c) => a + c.value, 0); // anchors are picked once and always remain in the formed set — every attempt builds around them; nothing may drop or replace them
  const basePools = byTier.map((list) =>
      tierPool(list.filter((c) => !anchorIds.has(c.id))),
    ),
    avail = basePools.map((l, i) => l.vals.length + (aCount[i] ?? 0));
  let probed: SizePlan | null | undefined;
  const probeFeasible = (): SizePlan | null =>
    probed === undefined
      ? (probed = largestFeasible(basePools, aCount, aSum))
      : probed; // sizes with no feasible quotas fall back to the largest feasible probed size (computed once)
  let bestValid: { cards: Card<T>[]; dev: number; roomy: boolean } | null =
      null,
    best: { cards: Card<T>[]; distance: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const drawn = lowerSize + Math.floor(rng() * (upperSize - lowerSize + 1));
    let size = fitSize(
      tiers,
      Math.max(MIN_ABSOLUTE_SET_SIZE, Math.min(drawn, cards.length)),
      upperSize,
      avail,
      aCount,
    );
    if (attempt * 2 < MAX_ATTEMPTS && size * 2 < lowerSize + upperSize)
      continue;
    let quotas = quotasFor(tiers, size, basePools, aCount, aSum, band); // early on, hold out for a roomy set — bigger sets spread usage across more of the pool; later attempts take any feasible size
    if (!quotas) {
      // early on, hold out for a drawn size the quotas can hold — the probed fallback can sit far under the size floor
      if (attempt * 2 < MAX_ATTEMPTS) continue;
      const fallbackPlan = probeFeasible();
      if (!fallbackPlan) continue;
      size = fallbackPlan.size;
      quotas = [...fallbackPlan.quotas];
    }
    bendQuotas(quotas, tiers, basePools, aCount, aSum, size, band.target);
    const need = quotas.map((quota, i) => quota - (aCount[i] ?? 0)),
      pis = buildPlan(basePools, need, band.target * size - aSum);
    const selected = [...anchors],
      restByTier: Card<T>[][] = tiers.map(() => []);
    for (let i = tiers.length - 1; i >= 0; i--) {
      const tier = basePools[i];
      if (!tier) continue;
      const { picked, rest } = combSample(
        tier,
        pis[i] ?? [],
        need[i] ?? 0,
        rng,
      );
      selected.push(...picked);
      restByTier[i] = rest;
    }
    repairIntoBand(selected, restByTier, size, band, anchorIds, rng);
    const total = selected.reduce((a, c) => a + c.value, 0),
      ev = Math.floor(total / size),
      dev = Math.abs(ev - band.target);
    const roomy = size >= lowerSize || size >= (probeFeasible()?.size ?? 0); // sub-floor sizes only land when nothing roomier is feasible
    if (ev >= band.lowerEv && ev <= band.upperEv) {
      if (dev <= evAccept && roomy) return selected.map((c) => c.token);
      if (
        !bestValid ||
        (roomy && !bestValid.roomy) ||
        (roomy === bestValid.roomy && dev < bestValid.dev)
      )
        bestValid = { cards: selected, dev, roomy };
    }
    const distance = Math.abs(total / size - band.target);
    if (!best || distance < best.distance) best = { cards: selected, distance }; // closest build overall, in-band or not
  }
  const fallback = bestValid?.cards ?? best?.cards;
  return fallback ? fallback.map((c) => c.token) : []; // out of attempts: the closest in-band build, else the closest at all — the acceptance gate decides
}
