/**
 * Shared wire shapes + adapters for the packing endpoints (get-packing,
 * get-packing-run): one /verify/packing list entry and how it becomes a
 * row-ready SetTask.
 *
 * Adapter rules (verify-api handover doc):
 *   - money fields are raw integers with 2 implied decimals — never divide
 *     here, display formatting owns the ÷100 (rule 1.2)
 *   - token arrays keep their stored order (rule 1.3)
 *   - β is derived client-side from π (proofToHash) — not on the wire
 *   - recorded attempt metrics (ev / drawStart / drawsUsed) are kept on the
 *     task for the replay cross-check only — they are never rendered
 */
import { deriveTaskSeed } from "@renaiss/replay-fair-set";
import { proofToHash } from "@renaiss/ecvrf";
import type { SetTask, TaskToken } from "@/components/task-rows";

export interface WireVrf {
  blockNumber: number;
  blockHash: string;
  proof: string;
  publicKeyHex: string;
}

/** Legacy rows may predate the size-range refactor — sizes can be absent,
 * and such runs are not replayable (doc §4.4). */
export interface WireConfig {
  targetExpectedValueInUsd: number;
  lowerExpectedValueInUsd: number;
  upperExpectedValueInUsd: number;
  maxTokensInSet: number;
  lowerNumberOfTokensInNewSet?: number;
  upperNumberOfTokensInNewSet?: number;
  timeoutSeconds: number;
  tiers: {
    /** The run snapshot's opaque tier id — the stored numeric id as a
     * string, verbatim. Identity only; display letters are assigned
     * client-side (see configOf). */
    tier: string;
    floorValueInUsd: number;
    minNumberOfTokens: number;
    maxNumberOfTokens: number;
    targetNumberOfTokensPercentage: number;
    maxNumberOfTokensPercentage?: number | null;
  }[];
}

export interface WireAttempt {
  outcome: "success" | "error" | "invalid";
  detail?: string;
  durationMs: number;
  ev: number | null;
  drawStart: number;
  drawsUsed: number;
}

/** One /verify/packing list entry — run record only, no token arrays. */
export interface WireRun {
  taskId: string;
  setId: number;
  status: "success" | "failed";
  triggerSource: "checkout" | "cron" | "manual";
  algoUsed: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  config: WireConfig | null;
  attempts: WireAttempt[];
  output: { expectedValueInUsd: number; merkleRoot: string } | null;
  vrf: WireVrf | null;
}

export interface WireRunToken {
  tokenId: string;
  valueInUsd: number;
  merkleSalt?: string;
}

/** One entry of the detail endpoints' top-level cards map (rule 1.7). */
export interface WireCardEntry {
  tokenId: string;
  /** Legacy combined string ("PSA 10 … #195 Zekrom") — fallback only. */
  name: string;
  /** The graded-set line ("PSA 10 Gem Mint 2021 … Vmax Climax"). */
  setName?: string;
  /** The card's own headline ("#195 Zekrom"). */
  displayName?: string;
  imageUrl?: string;
}

const bytesToHex = (b: Uint8Array): string =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from(h.slice(2).match(/.{2}/g)!.map((x) => parseInt(x, 16)));

/**
 * The config tier a value belongs to — the same last-floor-reached rule the
 * selection run used. A value below every floor belongs to the LOWEST tier
 * (the pool really holds such tokens; fabricating a fallback identity the
 * config doesn't know would break the replay).
 */
const tierEntryOf = (
  valueInUsd: number,
  config: SetTask["config"],
): NonNullable<SetTask["config"]>["tiers"][number] | undefined => {
  const asc = [...(config?.tiers ?? [])].sort(
    (a, b) => a.floorValueInUsd - b.floorValueInUsd,
  );
  let selected = asc[0];
  for (const t of asc) if (valueInUsd >= t.floorValueInUsd) selected = t;
  return selected;
};

/** Display letters by tier rank, highest first — must cover the deepest
 * production tier table (RenaCrypt 250 runs five); ranks past the ladder
 * keep their wire ids (uncolored but correct). Colors live in lib/format.ts
 * TIER_COLORS. Shared with the Sets tab's lineup adapter (get-sets-detail),
 * so the same tier wears the same letter on both tabs. */
export const TIER_LETTERS: readonly string[] = ["s", "a", "b", "c", "d", "e", "f"];

/**
 * A pack's tier table (lowest tier first, as /packs and the detail
 * endpoints serve it) → wire-id lookups for display: the rank letter
 * (highest tier → "s") and the pack's display name. A null card tier
 * (legacy run with no stored config) renders as the pack's lowest tier;
 * a pack with no tier table at all falls back to "c".
 */
export const tierDisplayMaps = (
  packTiers: { tier: string; name: string }[],
): {
  letterOf: Map<string, string>;
  nameOf: Map<string, string>;
  lowestLetter: string;
} => {
  const letterOf = new Map(
    packTiers.map((t, i) => [
      t.tier,
      TIER_LETTERS[packTiers.length - 1 - i] ?? t.tier,
    ]),
  );
  return {
    letterOf,
    nameOf: new Map(packTiers.map((t) => [t.tier, t.name])),
    lowestLetter: letterOf.get(packTiers[0]?.tier ?? "") ?? "c",
  };
};

/**
 * A run's config, only when complete enough to replay (doc §4.4).
 *
 * The wire's tier ids are the run snapshot's opaque identities (numeric, as
 * strings). Re-key them to display letters by floor rank (highest → "s") —
 * ONE bijection applied to the config here and to every token via
 * tierOfValue, so replay identity is preserved while TIER_COLORS / labels
 * keep working unchanged. A run with more than 4 tiers keeps its wire ids
 * past rank 4 (cells render uncolored; the replay stays correct).
 */
export const configOf = (
  run: WireRun,
  tierNames?: Map<string, string>,
): SetTask["config"] => {
  const c = run.config;
  if (
    !c ||
    typeof c.lowerNumberOfTokensInNewSet !== "number" ||
    typeof c.upperNumberOfTokensInNewSet !== "number"
  )
    return undefined;
  const byFloorDesc = [...c.tiers].sort(
    (a, b) => b.floorValueInUsd - a.floorValueInUsd,
  );
  const letterOf = new Map(
    byFloorDesc.map((t, rank) => [t.tier, TIER_LETTERS[rank] ?? t.tier]),
  );
  return {
    ...c,
    tiers: c.tiers.map(({ maxNumberOfTokensPercentage, ...t }) => ({
      ...t,
      tier: letterOf.get(t.tier)!,
      // The pack's display name for this tier (/verify/packs tier map),
      // looked up by the WIRE id before the letter re-keying.
      ...(tierNames?.has(t.tier) ? { name: tierNames.get(t.tier)! } : {}),
      // The share cap must be a number or ABSENT: the algorithm gates on
      // `!== undefined`, so a wire null would read as a 0% cap and derail
      // the replay (the list endpoint serves null where the detail omits
      // the key — normalize both to omission).
      ...(typeof maxNumberOfTokensPercentage === "number"
        ? { maxNumberOfTokensPercentage }
        : {}),
    })),
  } as SetTask["config"];
};

export const toTaskToken = (
  t: WireRunToken,
  config: SetTask["config"],
  cards: Map<string, WireCardEntry>,
): TaskToken => {
  const tier = tierEntryOf(t.valueInUsd, config);
  const card = cards.get(t.tokenId);
  return {
    tokenId: t.tokenId,
    valueInUsd: t.valueInUsd,
    tier: tier?.tier ?? "c",
    ...(tier?.name !== undefined ? { tierName: tier.name } : {}),
    // The split names render as two lines (set line above, card headline
    // below) — same shape the fixtures always had; the combined legacy
    // string is the fallback for an older API.
    ...(card ? { name: card.displayName ?? card.name } : {}),
    ...(card?.setName !== undefined ? { setName: card.setName } : {}),
    // Raw asset URL — renderers wrap it in the shop's image optimizer with
    // a downgrade path (lib/api/renaiss/image.ts).
    ...(card?.imageUrl ? { frontImageUrl: card.imageUrl } : {}),
    ...(t.merkleSalt !== undefined ? { merkleSalt: t.merkleSalt } : {}),
  };
};

export const toTask = (
  run: WireRun,
  onChainPackId: string,
  numericId: number,
  tierNames?: Map<string, string>,
): SetTask => {
  const config = configOf(run, tierNames);
  const β = run.vrf ? proofToHash(hexToBytes(run.vrf.proof)) : false;
  return {
    // Rows sort/expand on a numeric id; the wire id is an opaque uuid kept
    // separately as the /packing/run key.
    id: numericId,
    taskId: run.taskId,
    packId: onChainPackId,
    setId: run.setId,
    triggerSource: run.triggerSource,
    status: run.status,
    algoUsed: run.algoUsed,
    ...(run.errorCode !== null ? { errorCode: run.errorCode } : {}),
    ...(run.errorDetail !== null ? { errorDetail: run.errorDetail } : {}),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    // The heavy arrays live on /packing/run — fetched on expand / prefetch.
    detailState: "pending",
    ...(config ? { config } : {}),
    attempts: run.attempts.map((a) => ({
      algorithm: run.algoUsed ?? "Fair Set Ranked",
      durationMs: a.durationMs,
      outcome: a.outcome,
      ...(a.detail ? { detail: a.detail } : {}),
      // Recorded metrics — replay cross-check only, never rendered.
      recorded: {
        ev: a.ev,
        drawStart: a.drawStart,
        drawsUsed: a.drawsUsed,
      },
    })),
    ...(run.output
      ? {
          output: {
            expectedValueInUsd: run.output.expectedValueInUsd,
            publishedMerkleRoot: run.output.merkleRoot,
          },
        }
      : {}),
    // Pre-run failures carry no proof (§4.4) — no vrf, no verify panel.
    ...(run.vrf && β
      ? {
          vrf: {
            blockNumber: run.vrf.blockNumber,
            blockHash: run.vrf.blockHash,
            onChainPackId,
            // α and β are derived, not served.
            seed: deriveTaskSeed(
              run.vrf.blockHash,
              run.vrf.blockNumber,
              onChainPackId,
              run.setId,
            ),
            publicKeyHex: run.vrf.publicKeyHex,
            proof: run.vrf.proof,
            randomness: bytesToHex(β),
          },
        }
      : {}),
  };
};
