"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SourceLegend } from "@/components/provenance";
import { PackSelector, PackSelectorSkeleton } from "@/components/pack-selector";
import { allPacks, listPacks } from "@/lib/api/client";
import {
  fetchPackingPage,
  PACKING_API_LIMIT,
} from "@/lib/api/renaiss/verify/get-packing";
import {
  fetchRunDetail,
  mergeRunDetail,
} from "@/lib/api/renaiss/verify/get-packing-run";
import { USE_MOCK_DATA } from "@/lib/config";
import type { PackSummary } from "@/lib/api/types";
import {
  TaskRows,
  TASKS_PAGE_SIZE,
  type SetTask,
  type TaskToken,
} from "@/components/task-rows";
import { deriveTaskSeed, runSelectionLoop } from "@renaiss/replay-fair-set";
import {
  pointToString,
  proofToHash,
  prove,
  secretScalarAndPublicKey,
} from "@renaiss/ecvrf";
import fixtures from "@/lib/api/fixtures.json";

/**
 * /packing — the set-creation packing log. Every set is built by an operator
 * run that records a task record; this page lists those runs. In API mode it
 * fetches the real task records from the fair API and re-runs the algorithm
 * from each record itself; without an API host configured it falls back to
 * demo records generated in the browser.
 *
 * Each demo task is built by ACTUALLY running the same open-source stack
 * (@renaiss/algorithms + @renaiss/ecvrf): the seed follows the real
 * derivation, ECVRF prove is real, and the Fair Set Algorithm
 * attempts run over the β-derived rng stream — so the Re-run and Verify
 * panels recompute genuine matches.
 * The seed inputs (pack id + each set's genesis block) come straight from
 * the Sets-tab fixtures, so a task's `seed α` equals that set's genesis seed
 * on the Sets tab — the same build, two views.
 *
 * Runs are per pack — set numbers restart at 1 inside each pack, and every
 * seed embeds that pack's 32-byte on-chain id — so the log shows one pack at
 * a time, selected with the same pack cards as the Sets tab.
 */

const bytesToHex = (b: Uint8Array): string =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from(h.slice(2).match(/.{2}/g)!.map((x) => parseInt(x, 16)));

// DEMO ONLY — a fixed RFC 8032 test secret key, so the server render and the
// browser derive identical proofs (a random keygen() would hydration-
// mismatch). Real tasks return the operator's π; no secret key ships.
const DEMO_SK = hexToBytes(
  "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
);
const DEMO_PK_HEX = bytesToHex(
  pointToString(secretScalarAndPublicKey(DEMO_SK).Y),
);

// The Sets-tab fixture packs — each run below belongs to one of them, and its
// seed embeds that pack's 32-byte on-chain id, so both tabs derive the same
// seed for the same build.
type FixturePack = (typeof fixtures.packs)[number];

// Sorted highest floor first — the tier table derives each range from it.
// Floors mirror the fixture sets' actual tier values (s ~$100+, a ~$85+…).
// Money is an integer with 2 implied decimals throughout: 10_000 = $100.00.
const TIERS: NonNullable<SetTask["config"]>["tiers"] = [
  { tier: "s", floorValueInUsd: 10_000, minNumberOfTokens: 2, maxNumberOfTokens: 8, targetNumberOfTokensPercentage: 1 },
  { tier: "a", floorValueInUsd: 8_500, minNumberOfTokens: 10, maxNumberOfTokens: 40, targetNumberOfTokensPercentage: 4 },
  { tier: "b", floorValueInUsd: 4_000, minNumberOfTokens: 40, maxNumberOfTokens: 200, targetNumberOfTokensPercentage: 20 },
  { tier: "c", floorValueInUsd: 0, minNumberOfTokens: 60, maxNumberOfTokens: 600, targetNumberOfTokensPercentage: 75 },
];

/** Config for the hand-authored failed runs — EV band target ± $80. */
const mkConfig = (target: number): NonNullable<SetTask["config"]> => ({
  targetExpectedValueInUsd: target,
  lowerExpectedValueInUsd: target - 8_000,
  upperExpectedValueInUsd: target + 8_000,
  maxTokensInSet: 800,
  lowerNumberOfTokensInNewSet: 250,
  upperNumberOfTokensInNewSet: 350,
  timeoutSeconds: 180,
  tiers: TIERS,
});

/** The most expensive tier whose floor the value reaches. */
const tierOfValue = (valueInUsd: number): TaskToken["tier"] => {
  let selected: TaskToken["tier"] = "c";
  for (const t of [...TIERS].sort((a, b) => a.floorValueInUsd - b.floorValueInUsd)) {
    if (valueInUsd >= t.floorValueInUsd) selected = t.tier;
  }
  return selected;
};

/**
 * Per-set config the run is judged against: EV target = the pool's own mean
 * (band ±30%), tier min = max = the pool's actual per-tier counts. With the
 * composition pinned this tightly the algorithm must select the ENTIRE
 * lineup, so the task's output — and its recomputed merkle root — matches
 * the published set exactly.
 */
const configForPool = (pool: TaskToken[]): NonNullable<SetTask["config"]> => {
  const total = pool.reduce((s, t) => s + t.valueInUsd, 0);
  const target = Math.floor(total / pool.length);
  const spread = Math.max(1, Math.floor(target * 0.3));
  const counts: Record<string, number> = { s: 0, a: 0, b: 0, c: 0 };
  for (const t of pool) counts[tierOfValue(t.valueInUsd)]!++;
  return {
    targetExpectedValueInUsd: target,
    lowerExpectedValueInUsd: target - spread,
    upperExpectedValueInUsd: target + spread,
    maxTokensInSet: 1000,
    // Pinned to the pool's exact size, so the algorithm must select the whole
    // lineup and the recomputed Merkle root matches the published set.
    lowerNumberOfTokensInNewSet: pool.length,
    upperNumberOfTokensInNewSet: pool.length,
    timeoutSeconds: 180,
    tiers: TIERS.map((t) => ({
      ...t,
      minNumberOfTokens: counts[t.tier]!,
      maxNumberOfTokens: counts[t.tier]!,
      targetNumberOfTokensPercentage:
        counts[t.tier]! === 0
          ? 0
          : Math.max(1, Math.round((counts[t.tier]! / pool.length) * 100)),
    })),
  };
};

/**
 * A real set lineup from the Sets-tab fixtures — token ids and merkle salts
 * are the set's own, so the task's recomputed root equals the published root.
 */
const lineupCache = new Map<string, TaskToken[]>();
const setLineup = (pack: FixturePack, setId: number): TaskToken[] => {
  const key = `${pack.packId}:${setId}`;
  const cached = lineupCache.get(key);
  if (cached) return cached;
  const sp = pack.sets.find((s) => s.setId === setId);
  if (!sp) throw new Error(`fixture set ${setId} missing`);
  const tokens = sp.cards.map((c) => ({
    tokenId: c.tokenId,
    valueInUsd: c.valueInUsd,
    tier: c.tier as TaskToken["tier"],
    name: c.name,
    status: c.status,
    merkleSalt: c.merkleSalt,
    setName: c.setName,
    gradingCompany: c.gradingCompany,
    grade: c.grade,
    year: c.year,
    frontImageUrl: c.frontImageUrl,
  }));
  lineupCache.set(key, tokens);
  return tokens;
};

/**
 * Collectible identities for the synthetic demo pools below, so their hover
 * cards carry art too. The fixture generator assigns identities to lineup
 * cards by cycling its pool sequentially, so the first cards of the first
 * lineup cover every identity exactly once.
 */
type TokenIdentity = Pick<
  TaskToken,
  "name" | "setName" | "gradingCompany" | "grade" | "year" | "frontImageUrl"
>;
const IDENTITY_POOL: TokenIdentity[] = (() => {
  const seen = new Set<string>();
  const pool: TokenIdentity[] = [];
  for (const c of fixtures.packs[0]!.sets[0]!.cards) {
    if (c.frontImageUrl && !seen.has(c.frontImageUrl)) {
      seen.add(c.frontImageUrl);
      const { name, setName, gradingCompany, grade, year, frontImageUrl } = c;
      pool.push({ name, setName, gradingCompany, grade, year, frontImageUrl });
    }
  }
  return pool;
})();
const identityAt = (i: number): TokenIdentity =>
  IDENTITY_POOL[i % IDENTITY_POOL.length]!;

/** Deterministic dummy pool — for failed runs with no created set. */
const makePool = (base: number, n: number): TaskToken[] =>
  Array.from({ length: n }, (_, i) => {
    const valueInUsd = (10 + ((i * 137 + base * 53) % 120)) * 100;
    return {
      ...identityAt(i + base),
      tokenId: String(40_000 + base * 1000 + i * 3),
      valueInUsd,
      tier: valueInUsd >= 10_000 ? "s" : valueInUsd >= 8_500 ? "a" : valueInUsd >= 4_000 ? "b" : "c",
    } as TaskToken;
  });

const ALGO = "Fair Set Ranked";

/** Deterministic per-task dates — the highest id is newest, one day apart. */
const age = (id: number) => 130 - id;
const startedAtOf = (id: number) =>
  new Date(Date.UTC(2025, 5, 30, 9, 15, 2) - age(id) * 86_400_000).toISOString();

/** The set's genesis block/pack from the Sets-tab fixtures — the same seed
 * inputs the Sets tab shows, so both tabs derive the identical seed α. */
const setGenesis = (pack: FixturePack, setId: number) => {
  const sp = pack.sets.find((s) => s.setId === setId);
  if (!sp) throw new Error(`fixture set ${setId} missing`);
  return sp.genesis;
};

/**
 * The one builder every demo task goes through: derive the seed, prove, run the
 * REAL selection loop, and assemble the task row from whatever the loop did — a
 * winner → a success task, an exhausted loop → a genuine NO_SOLUTION failure.
 * Same code and same shape for both; only the pool + config + block differ.
 * Nothing about the attempts is hand-authored.
 */
const buildTask = (opts: {
  id: number;
  pack: FixturePack;
  setId: number;
  trigger: SetTask["triggerSource"];
  pool: TaskToken[];
  config: NonNullable<SetTask["config"]>;
  blockHash: string;
  blockNumber: number;
  durationMs: number;
}): SetTask => {
  const { id, pack, setId, trigger, pool, config, blockHash, blockNumber, durationMs } =
    opts;

  const seed = deriveTaskSeed(blockHash, blockNumber, pack.onChainPackId, setId);
  const { piString } = prove(DEMO_SK, hexToBytes(seed));
  const beta = proofToHash(piString);
  if (!beta) throw new Error("proofToHash failed on a demo proof");
  const randomness = bytesToHex(beta);

  const run = runSelectionLoop(randomness, pool, config);

  const vrf = {
    blockNumber,
    blockHash,
    onChainPackId: pack.onChainPackId,
    seed,
    publicKeyHex: DEMO_PK_HEX,
    proof: bytesToHex(piString),
    randomness,
  };
  const attempts = run.attempts.map((a, i) => ({
    algorithm: ALGO,
    durationMs: 900 + ((id * 17 + i * 53) % 1500),
    outcome: a.outcome,
    ...(a.detail ? { detail: a.detail } : {}),
  }));
  const base = {
    id,
    packId: pack.packId,
    setId,
    triggerSource: trigger,
    startedAt: startedAtOf(id),
    durationMs,
    input: { algoInputTokenCount: pool.length },
    inputTokens: pool,
    config,
    attempts,
    vrf,
  };

  if (run.winnerIndex >= 0) {
    const win = run.attempts[run.winnerIndex]!;
    return {
      ...base,
      status: "success",
      algoUsed: ALGO,
      output: { tokens: win.picks, expectedValueInUsd: win.ev },
    };
  }

  // Every attempt failed validation — a genuine NO_SOLUTION. errorDetail joins
  // the attempt trail, truncated the way the stored record truncates it.
  const trail = run.attempts
    .map((a) => `${ALGO}=${a.outcome}${a.detail ? `(${a.detail})` : ""}`)
    .join(", ");
  const detail = `No valid algorithm solution for next set. Attempts: ${trail}`;
  return {
    ...base,
    status: "failed",
    algoUsed: null,
    errorCode: "NO_SOLUTION",
    errorDetail:
      detail.length > 2000 ? detail.slice(0, 1985) + "... [truncated]" : detail,
  };
};

/** A success task from a real set lineup — the config is pinned to the pool so
 * the winner reproduces the published set and its Merkle root matches. */
const successTask = (opts: {
  id: number;
  pack: FixturePack;
  setId: number;
}): SetTask => {
  const pool = setLineup(opts.pack, opts.setId);
  const genesis = setGenesis(opts.pack, opts.setId);
  return buildTask({
    ...opts,
    trigger: "cron",
    pool,
    config: configForPool(pool),
    blockHash: genesis.blockHash,
    blockNumber: genesis.blockNumber,
    durationMs: 3800 + ((opts.id * 991) % 9000),
  });
};

/**
 * A GENUINE NO_SOLUTION run through the SAME builder — only the config differs.
 * The EV band ($295–$305) sits far above anything this pool can average, so all
 * 30 tries are rejected for the same reason and the loop gives
 * up. It carries a proof, so — unlike a hand-authored failure — the whole
 * failing run is itself replayable (this relies on the operator persisting π
 * for failed runs too, not only for accepted ones).
 */
const FAIL_BLOCK_HASH =
  "0x9d0c4e7a3b1f8265c0a4938271605f4e3d2c1b0a99887abc5b1c8a2f4d0e7936";
const FAIL_BLOCK_NUMBER = 21_399_010;
const FAIL_CONFIG: NonNullable<SetTask["config"]> = {
  targetExpectedValueInUsd: 30_000,
  lowerExpectedValueInUsd: 29_500,
  upperExpectedValueInUsd: 30_500,
  maxTokensInSet: 1000,
  lowerNumberOfTokensInNewSet: 25,
  upperNumberOfTokensInNewSet: 35,
  timeoutSeconds: 180,
  tiers: TIERS.map((t) => ({ ...t, minNumberOfTokens: 1, maxNumberOfTokens: 55 })),
};

const failedTask = (opts: {
  id: number;
  pack: FixturePack;
  setId: number;
}): SetTask =>
  buildTask({
    ...opts,
    trigger: "cron",
    pool: makePool(7, 60),
    config: FAIL_CONFIG,
    blockHash: FAIL_BLOCK_HASH,
    // Vary the block per task so two failures at the same set number still get
    // distinct seeds (and distinct attempt trails), never identical twin rows.
    blockNumber: FAIL_BLOCK_NUMBER + opts.id,
    durationMs: 171_400,
  });

/**
 * A LARGE, GENUINELY MULTI-ATTEMPT task (the newest): a ~1,200-token candidate
 * pool and a ~344-card accepted set (mostly B/C commons, a few A, one S) at a
 * premium EV (~$120, band $110–$130), so BOTH the input and output token grids
 * scroll. Unlike the other tasks this one takes several tries: the top (anchor)
 * tier holds only high-value cards — "big" (~$1.4k–1.7k) and "huge" ($8k–$40k) —
 * and the config lets in exactly one S card. That single protected anchor swings
 * the EV hard: a "huge" anchor pushes the set far ABOVE the band, while the
 * commons-heavy base can also fall BELOW it, so attempts are rejected on either
 * side until the pieces line up. All real: seed → π → β → selection; every
 * attempt (and the winner's Output + Merkle root) reproduces from the proof.
 * Block pinned so this set's seed lands on 4 rejects then an accept; nothing
 * here is hand-authored.
 */
const MERGE_BLOCK_HASH = "0xaadd" + "f".padStart(60, "0");
const MERGE_BLOCK_NUMBER = 21_406_101;

/** Tier by the merge config's floors (top tier starts at $1,000). */
const mergeTierOf = (v: number): TaskToken["tier"] =>
  v >= 100_000 ? "s" : v >= 10_000 ? "a" : v >= 4_000 ? "b" : "c";

/** Deterministic FNV-1a hash of the token id — a stable per-token sort key so
 * the pool renders in a natural, mixed order (like a real inventory) instead of
 * tidy per-tier blocks. Deterministic, so the run stays reproducible. */
const mergeShuffleKey = (tokenId: string): number => {
  let h = 2166136261;
  for (let k = 0; k < tokenId.length; k++) {
    h ^= tokenId.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mergePool = (): TaskToken[] => {
  // Anchor tier: all high-value, so relaxation can't escape it. "big" cards
  // keep the set in-band when they survive; "huge" cards bust it even alone.
  const big = Array.from({ length: 24 }, (_, i) => ({
    ...identityAt(i),
    tokenId: String(90_000 + i),
    valueInUsd: 140_000 + i * 1_200, // ~$1,400–$1,676
    tier: "s" as const,
  }));
  const huge = Array.from({ length: 36 }, (_, i) => ({
    ...identityAt(i + 7),
    tokenId: String(95_000 + i),
    valueInUsd: 800_000 + i * 92_000, // ~$8,000–$40,200
    tier: "s" as const,
  }));
  // Bulk (~$120 and below) fills tiers A/B/C toward the target EV.
  const bulk = Array.from({ length: 1200 - big.length - huge.length }, (_, i) => {
    const r = i % 10;
    let valueInUsd: number;
    if (r < 6) valueInUsd = 11_800 + (i % 14) * 100;
    else if (r < 8) valueInUsd = 9_000 + (i % 9) * 100;
    else if (r < 9) valueInUsd = 5_000 + (i % 30) * 100;
    else valueInUsd = 2_000 + (i % 18) * 100;
    return {
      ...identityAt(i),
      tokenId: String(80_000 + i),
      valueInUsd,
      tier: mergeTierOf(valueInUsd),
    };
  });
  // Interleave all tiers into a natural, non-blocky order (a real pool isn't
  // grouped by tier). Stable sort by the token-id hash keeps it reproducible.
  return [...big, ...huge, ...bulk].sort(
    (a, b) => mergeShuffleKey(a.tokenId) - mergeShuffleKey(b.tokenId),
  );
};

const MERGE_CONFIG: NonNullable<SetTask["config"]> = {
  targetExpectedValueInUsd: 12_000,
  lowerExpectedValueInUsd: 11_000,
  upperExpectedValueInUsd: 13_000,
  maxTokensInSet: 1200,
  lowerNumberOfTokensInNewSet: 650,
  upperNumberOfTokensInNewSet: 1050,
  timeoutSeconds: 180,
  tiers: [
    { tier: "s", floorValueInUsd: 100_000, minNumberOfTokens: 1, maxNumberOfTokens: 1, targetNumberOfTokensPercentage: 1 },
    { tier: "a", floorValueInUsd: 10_000, minNumberOfTokens: 1, maxNumberOfTokens: 1200, targetNumberOfTokensPercentage: 4 },
    { tier: "b", floorValueInUsd: 4_000, minNumberOfTokens: 1, maxNumberOfTokens: 1200, targetNumberOfTokensPercentage: 20 },
    { tier: "c", floorValueInUsd: 0, minNumberOfTokens: 1, maxNumberOfTokens: 1200, targetNumberOfTokensPercentage: 75 },
  ],
};

const mergeTask = (opts: {
  id: number;
  pack: FixturePack;
  setId: number;
}): SetTask =>
  buildTask({
    ...opts,
    trigger: "cron",
    pool: mergePool(),
    config: MERGE_CONFIG,
    blockHash: MERGE_BLOCK_HASH,
    blockNumber: MERGE_BLOCK_NUMBER,
    durationMs: 24_800 + ((opts.id * 71) % 5000),
  });

/**
 * A timeout run. It goes through the real builder like every other failure, so
 * it carries a genuine, replayable attempt trail (each rejected for landing
 * outside the EV band), then relabels the outcome as a timeout: the EV band
 * ($350–$510) sits far above anything a $10–$129 pool can average, so no attempt
 * validates and the run is recorded as having run out of time.
 */
const timeoutTask = (opts: {
  id: number;
  pack: FixturePack;
  setId: number;
}): SetTask => {
  const real = buildTask({
    ...opts,
    trigger: "cron",
    pool: makePool(4, 305),
    config: mkConfig(43_000),
    blockHash: FAIL_BLOCK_HASH,
    blockNumber: FAIL_BLOCK_NUMBER + opts.id,
    durationMs: 180_000,
  });
  return {
    ...real,
    errorCode: "TIMEOUT",
    errorDetail: "Operation timed out while forming new set",
  };
};

/**
 * Each task is a THUNK, run on the client after a pack is selected (see
 * TasksPageClient) — the selection algorithm never runs at build time.
 *
 * Every pack gets its own plan, authored in CHRONOLOGICAL order (oldest
 * first) so the set numbering is causal: a run always targets the pack's next
 * set to be created, and only a SUCCESS advances that counter. A failed run
 * leaves the set unclaimed, so the run after it retries the SAME set number —
 * which is why a failure and the success that follows it share a "→ Set #N".
 * Task ids are consecutive within a plan, assigned in the same chronological
 * order, so the newest run has the highest id and sits at the top of the
 * page; the second pack launched later, so its ids continue past the first
 * pack's.
 */
type RunKind = "success" | "no_solution" | "timeout" | "merge";

interface PackRunPlan {
  plan: readonly RunKind[];
  /** The first set number this plan builds (earlier sets predate the log). */
  firstSet: number;
  /** The id of the plan's newest (last) run. */
  newestTaskId: number;
}

/** How many times set 14 was rejected before a run finally validated. */
const SET_14_REJECTIONS = 30;

// Indexed like fixtures.packs: [0] the demo pack, [1] the newer pack.
const RUN_PLANS: PackRunPlan[] = [
  {
    plan: [
      "success", //  set 3
      "success", //  set 4
      "no_solution", //  set 5 — rejected, set 5 stays unclaimed
      "success", //  set 5
      "success", //  set 6
      "success", //  set 7
      "no_solution", //  set 8 — rejected
      "success", //  set 8
      "no_solution", //  set 9 — rejected
      "no_solution", //  set 9 — rejected again
      "success", //  set 9
      "success", //  set 10
      "success", //  set 11
      "timeout", //  set 12 — timed out
      "success", //  set 12
      "success", //  set 13
      // Set 14 was the stubborn one: the eligible pool had drifted so far from
      // the EV band that run after run was rejected. Thirty in a row found no
      // lineup that satisfied the band and every tier quota — the set stayed
      // unclaimed the whole time, so all thirty target set 14 and none of them
      // commit anything. The Behind-the-Rip chart collapses this streak into a
      // single stacked slot; shortening it shortens that stack.
      ...Array.from({ length: SET_14_REJECTIONS }, (): RunKind => "no_solution"),
      "success", //  set 14 — claimed at last, on the 31st run
      "merge", //  set 15 — the large merged run, newest
    ],
    firstSet: 3,
    newestTaskId: 130,
  },
  {
    plan: [
      "success", //  set 1
      "success", //  set 2
      "no_solution", //  set 3 — rejected, set 3 stays unclaimed
      "success", //  set 3
      "success", //  set 4
      "timeout", //  set 5 — timed out
      "success", //  set 5
      "success", //  set 6
    ],
    firstSet: 1,
    newestTaskId: 138,
  },
];

/** A pack's run plan — every fixture set as a plain success when a pack has
 * no authored plan (a safety net for newly added fixture packs). */
const planForPack = (packIndex: number): PackRunPlan =>
  RUN_PLANS[packIndex] ?? {
    plan: fixtures.packs[packIndex]!.sets.map(() => "success" as const),
    firstSet: 1,
    newestTaskId:
      160 + packIndex * 40 + fixtures.packs[packIndex]!.sets.length,
  };

const jobsForPack = (packIndex: number): Array<() => SetTask> => {
  const pack = fixtures.packs[packIndex]!;
  const { plan, firstSet, newestTaskId } = planForPack(packIndex);
  const firstTaskId = newestTaskId - (plan.length - 1);
  let nextSet = firstSet;
  const jobs = plan.map((kind, i) => {
    const id = firstTaskId + i;
    const setId = nextSet;
    if (kind === "success" || kind === "merge") nextSet++;
    switch (kind) {
      case "success":
        return () => successTask({ id, pack, setId });
      case "no_solution":
        return () => failedTask({ id, pack, setId });
      case "timeout":
        return () => timeoutTask({ id, pack, setId });
      case "merge":
        return () => mergeTask({ id, pack, setId });
    }
  });
  // Stream newest-first so rows only ever append downward (no reordering as the
  // list fills). The heaviest run is newest, so it computes first and claims the
  // top slot while the page shell + "Running…" placeholder are already painted.
  return jobs.reverse();
};

/**
 * The pack the Behind-the-Rip chart visualizes: the demo pack, whose authored
 * plan carries the long rejection streak the chart's stacking exists to show.
 */
const CHART_PACK_INDEX = 0;

/**
 * What a run *is*, without doing its work. The plan already fixes each run's id,
 * target set and outcome, so this is free — which lets the chart lay out its
 * rows (and collapse a streak of rejections into one) before deciding which runs
 * are actually worth building.
 */
export interface RunSpec {
  id: number;
  setId: number;
  failed: boolean;
  timedOut: boolean;
}

/** A pack's run shapes, in the same newest-first order as `jobsForPack`. */
const specsForPack = (packIndex: number): RunSpec[] => {
  const { plan, firstSet, newestTaskId } = planForPack(packIndex);
  const firstTaskId = newestTaskId - (plan.length - 1);
  let nextSet = firstSet;
  const specs = plan.map((kind, i) => {
    const spec: RunSpec = {
      id: firstTaskId + i,
      setId: nextSet,
      failed: kind === "no_solution" || kind === "timeout",
      timedOut: kind === "timeout",
    };
    if (kind === "success" || kind === "merge") nextSet++;
    return spec;
  });
  return specs.reverse();
};

const CHART_JOBS = jobsForPack(CHART_PACK_INDEX);

/** Every run's shape, newest first — cheap, nothing is executed. */
export const RUN_SPECS_NEWEST_FIRST: ReadonlyArray<RunSpec> =
  specsForPack(CHART_PACK_INDEX);

/**
 * Execute one run. Real work — an ECVRF prove plus the whole selection loop — so
 * callers should build only what they are about to show, yielding between them.
 * Building the full set in one go blocks the main thread for seconds.
 */
export function buildRunAt(index: number): SetTask {
  return CHART_JOBS[index]!();
}

/** The same pack list the Sets tab offers, off the same mock client. */
const PACK_SUMMARIES: PackSummary[] = allPacks;

/** How many run details fetch concurrently in the background. The origin
 * takes ~1–2s per response — a slot pair keeps it warm without hammering. */
const PREFETCH_CONCURRENCY = 2;

/** One pack's fetched run history: the true run count (from the list
 * endpoint's pagination) plus each fetched API page, keyed by offset. One
 * API page (20 runs) spans two UI pages (10 rows each). Carries its packId
 * so state written for one pack can never be filed under another. */
interface ApiPackRuns {
  packId: string;
  total: number;
  pages: Map<number, SetTask[]>;
}

const apiOffsetFor = (uiPage: number): number =>
  Math.floor((uiPage * TASKS_PAGE_SIZE) / PACKING_API_LIMIT) * PACKING_API_LIMIT;

const uiSliceFor = (
  runs: ApiPackRuns,
  uiPage: number,
): SetTask[] | undefined => {
  const start = (uiPage * TASKS_PAGE_SIZE) % PACKING_API_LIMIT;
  return runs.pages
    .get(apiOffsetFor(uiPage))
    ?.slice(start, start + TASKS_PAGE_SIZE);
};

/** Mock-mode pack selection + browser-computed demo runs. */
function useMockTasks(selectedPackId: string | null) {
  const [tasks, setTasks] = useState<SetTask[]>([]);
  const [done, setDone] = useState(false);
  // Runs already computed for a pack — switching back is instant.
  const cacheRef = useRef(new Map<string, SetTask[]>());

  // Load the selected pack's runs one at a time, yielding between each so
  // the browser paints — the page shows up immediately and the runs fill in.
  useEffect(() => {
    if (!USE_MOCK_DATA || selectedPackId === null) return;
    const cached = cacheRef.current.get(selectedPackId);
    if (cached) {
      setTasks(cached);
      setDone(true);
      return;
    }
    let cancelled = false;
    setTasks([]);
    setDone(false);
    const acc: SetTask[] = [];
    (async () => {
      const jobs = jobsForPack(
        fixtures.packs.findIndex((p) => p.packId === selectedPackId),
      );
      for (const job of jobs) {
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;
        acc.push(job());
        setTasks(acc.slice());
      }
      if (!cancelled) {
        cacheRef.current.set(selectedPackId, acc);
        setDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPackId]);

  return { tasks, done };
}

/**
 * API-mode run history: fetch /verify/packing pages on demand for the pager,
 * then prefetch each listed run's /verify/packing/run detail in the
 * background (newest first, PREFETCH_CONCURRENCY at a time). Expanding a row
 * fetches its detail immediately — fetchRunDetail dedupes against an
 * in-flight prefetch, so priority never doubles a request.
 */
function useApiRuns(selectedPackId: string | null) {
  const [runs, setRuns] = useState<ApiPackRuns | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetched history per pack — switching back is instant.
  const cacheRef = useRef(new Map<string, ApiPackRuns>());
  // Bumped on every pack switch/unmount: stale prefetch results are dropped
  // and the stale queue stops pumping.
  const genRef = useRef(0);
  const queueRef = useRef<SetTask[]>([]);
  const activeRef = useRef(0);
  // List pages currently in flight ("packId:offset") — a fast pager
  // double-click must not fetch the same page twice.
  const inflightRef = useRef(new Set<string>());

  // Keep the cache holding the latest merged state, so a revisited pack
  // remembers which details already arrived. Guarded by the state's OWN
  // packId: right after a switch this effect fires once with the previous
  // pack's runs still in state, and keying by selectedPackId alone would
  // file them under the new pack — which then reads as "already fetched"
  // and the list never updates.
  useEffect(() => {
    if (runs && runs.packId === selectedPackId)
      cacheRef.current.set(runs.packId, runs);
  }, [runs, selectedPackId]);

  /** Merge a run detail (or its failure) into wherever the task appears. */
  const applyDetail = useCallback(
    (taskId: string, patch: Parameters<typeof mergeRunDetail>[1] | null) => {
      setRuns((prev) => {
        if (!prev) return prev;
        const pages = new Map(prev.pages);
        let changed = false;
        for (const [offset, tasks] of pages) {
          const i = tasks.findIndex((t) => t.taskId === taskId);
          if (i < 0) continue;
          const next = tasks.slice();
          next[i] = patch
            ? mergeRunDetail(next[i]!, patch)
            : { ...next[i]!, detailState: "error" };
          pages.set(offset, next);
          changed = true;
        }
        return changed ? { ...prev, pages } : prev;
      });
    },
    [],
  );

  const pump = useCallback(
    (gen: number) => {
      while (activeRef.current < PREFETCH_CONCURRENCY) {
        const task = queueRef.current.shift();
        if (!task?.taskId) return;
        activeRef.current++;
        fetchRunDetail(task.taskId)
          .then((patch) => {
            if (gen === genRef.current) applyDetail(task.taskId!, patch);
          })
          .catch(() => {
            // Background failures stay silent — an expand retries and
            // surfaces the error on the row.
          })
          .finally(() => {
            activeRef.current--;
            if (gen === genRef.current) pump(gen);
          });
      }
    },
    [applyDetail],
  );

  /** Fetch one API page if absent, then queue its runs for detail prefetch. */
  const ensureOffset = useCallback(
    (packId: string, offset: number) => {
      const key = `${packId}:${offset}`;
      if (
        cacheRef.current.get(packId)?.pages.has(offset) ||
        inflightRef.current.has(key)
      )
        return;
      inflightRef.current.add(key);
      const gen = genRef.current;
      fetchPackingPage(packId, offset)
        .finally(() => inflightRef.current.delete(key))
        .then((page) => {
          if (gen !== genRef.current) return;
          setRuns((prev) => {
            const base =
              (prev?.packId === packId ? prev : null) ??
              cacheRef.current.get(packId) ??
              { packId, total: 0, pages: new Map<number, SetTask[]>() };
            if (base.pages.has(offset)) return prev;
            const pages = new Map(base.pages);
            pages.set(offset, page.tasks);
            return { packId, total: page.total, pages };
          });
          queueRef.current.push(...page.tasks);
          pump(gen);
        })
        .catch((e: unknown) => {
          if (gen === genRef.current)
            setError(e instanceof Error ? e.message : String(e));
        });
    },
    [pump],
  );

  // Pack switch: retire the old prefetch queue, restore any cached history,
  // and make sure the first page is (being) fetched.
  useEffect(() => {
    if (USE_MOCK_DATA || selectedPackId === null) return;
    genRef.current++;
    queueRef.current = [];
    setError(null);
    setRuns(cacheRef.current.get(selectedPackId) ?? null);
    ensureOffset(selectedPackId, 0);
    return () => {
      genRef.current++;
      queueRef.current = [];
    };
  }, [selectedPackId, ensureOffset]);

  /** Expanded row → its detail jumps the queue (deduped by fetchRunDetail). */
  const prioritize = useCallback(
    (task: SetTask) => {
      if (!task.taskId || task.detailState !== "pending") return;
      const gen = genRef.current;
      fetchRunDetail(task.taskId)
        .then((patch) => {
          if (gen === genRef.current) applyDetail(task.taskId!, patch);
        })
        .catch(() => {
          if (gen === genRef.current) applyDetail(task.taskId!, null);
        });
    },
    [applyDetail],
  );

  return {
    // Only the selected pack's state is ever exposed — in the render between
    // a switch and its effect, `runs` still holds the previous pack's data.
    runs: runs && runs.packId === selectedPackId ? runs : null,
    error,
    ensureOffset,
    prioritize,
  };
}

export function TasksPageClient() {
  // Mock mode knows its packs at module load; API mode fetches them below —
  // the run list needs a selected pack either way (/verify/packing is
  // pack-scoped).
  const [packs, setPacks] = useState<PackSummary[] | null>(
    USE_MOCK_DATA ? PACK_SUMMARIES : null,
  );
  const [packsError, setPacksError] = useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(
    USE_MOCK_DATA ? fixtures.packs[0]!.packId : null,
  );
  const [uiPage, setUiPage] = useState(0);

  const mock = useMockTasks(selectedPackId);
  const api = useApiRuns(selectedPackId);

  // API call order: (1) /verify/packs … then auto-select the first pack,
  // which triggers (2) /verify/packing via useApiRuns.
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    let cancelled = false;
    listPacks()
      .then((list) => {
        if (cancelled) return;
        setPacks(list);
        setSelectedPackId(list[0]?.packId ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setPacksError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectPack = (packId: string) => {
    setUiPage(0);
    setSelectedPackId(packId);
  };

  const gotoPage = (p: number) => {
    setUiPage(p);
    if (!USE_MOCK_DATA && selectedPackId !== null)
      api.ensureOffset(selectedPackId, apiOffsetFor(p));
  };

  const apiRows = api.runs ? uiSliceFor(api.runs, uiPage) : undefined;

  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 pb-2 pt-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Packing.
        </h1>
        <p className="mt-2 max-w-2xl font-body text-[14px] text-muted">
          Every set starts as a packing run: draw a VRF seed, then retry the
          selection algorithm until a lineup fits the EV band and tier quotas.
          Pick a pack to see its runs — each one verified live in your
          browser. Expand a run to see its inputs and attempts, and to check
          the randomness yourself.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <p className="font-body text-[13px] text-muted">
            Hover any value to see where it comes from.
          </p>
          <SourceLegend />
        </div>
      </section>

      <div className="mt-6">
        {packs && selectedPackId !== null ? (
          <PackSelector
            packs={packs}
            selectedPackId={selectedPackId}
            onSelect={selectPack}
          />
        ) : packsError === null ? (
          <PackSelectorSkeleton />
        ) : null}
      </div>

      {packsError !== null ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-loss">
          Could not load the pack list ({packsError}). Reload to retry.
        </div>
      ) : USE_MOCK_DATA ? (
        mock.tasks.length === 0 ? (
          <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-muted">
            Running the selection algorithm for each run…
          </div>
        ) : (
          <>
            {/* Keyed per pack so expansion state resets with the selection. */}
            <TaskRows key={selectedPackId} tasks={mock.tasks} />
            {!mock.done && (
              <p className="mx-auto -mt-14 max-w-5xl px-6 pb-14 text-center font-mono-num text-[12px] text-muted">
                computing more runs…
              </p>
            )}
          </>
        )
      ) : api.error !== null ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-loss">
          Could not load this pack’s runs ({api.error}). Reload to retry.
        </div>
      ) : api.runs === null ? (
        <div className="mx-auto max-w-5xl animate-pulse px-6 py-12 text-center font-body text-[13px] text-muted">
          Loading packing runs…
        </div>
      ) : api.runs.total === 0 ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-muted">
          No packing data has been published for this pack yet.
        </div>
      ) : (
        <TaskRows
          key={selectedPackId}
          tasks={apiRows ?? []}
          pagination={{
            page: uiPage,
            pageCount: Math.ceil(api.runs.total / TASKS_PAGE_SIZE),
            onGoto: gotoPage,
            loading: apiRows === undefined,
          }}
          onExpandTask={api.prioritize}
        />
      )}
    </main>
  );
}
