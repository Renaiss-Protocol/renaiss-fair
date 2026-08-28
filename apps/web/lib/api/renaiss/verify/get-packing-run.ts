/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair/packings/{taskId}
 *
 * One run's heavy half, keyed by the opaque taskId from the packings list
 * (get-packing.ts): the candidate pool (stored order — rule 1.3), the
 * selected lineup with salts, and the top-level tokenId→name map (rule 1.7,
 * joined here). Fetched on expand / background prefetch; a finished run is
 * immutable, so responses cache per taskId for the session.
 */
import type { SetTask, TaskToken } from "@/components/task-rows";
import { tierNamesOf } from "./get-packs";
import { verifyFetch } from "./http";
import {
  configOf,
  toTaskToken,
  type WireCardEntry,
  type WireRun,
  type WireRunToken,
} from "./task-adapter";

interface WireRunDetailResponse {
  pack: { onChainPackId: string; name: string };
  cards: WireCardEntry[];
  run: WireRun & {
    inputTokens: WireRunToken[];
    output: {
      expectedValueInUsd: number;
      merkleRoot: string;
      tokens: WireRunToken[];
    } | null;
  };
}

/** The heavy half of a run, ready to merge over its list row. */
export interface RunDetailPatch {
  input: { algoInputTokenCount: number };
  inputTokens: TaskToken[];
  outputTokens?: TaskToken[];
}

/** Results (and in-flight requests — an expand must not duplicate a
 * prefetch) cached per taskId. */
const detailCache = new Map<string, Promise<RunDetailPatch>>();

export function fetchRunDetail(taskId: string): Promise<RunDetailPatch> {
  const cached = detailCache.get(taskId);
  if (cached) return cached;
  const p = verifyFetch<WireRunDetailResponse>(`/packings/${taskId}`)
    .then(async ({ pack, cards, run }) => {
      const cardMap = new Map(cards.map((c) => [c.tokenId, c]));
      const config = configOf(run, await tierNamesOf(pack.onChainPackId));
      return {
        input: { algoInputTokenCount: run.inputTokens.length },
        // Stored array order is part of the contract (rule 1.3) — no sorting.
        inputTokens: run.inputTokens.map((t) => toTaskToken(t, config, cardMap)),
        ...(run.output
          ? {
              outputTokens: run.output.tokens.map((t) =>
                toTaskToken(t, config, cardMap),
              ),
            }
          : {}),
      };
    })
    .catch((e: unknown) => {
      detailCache.delete(taskId); // a failed fetch retries on the next call
      throw e;
    });
  detailCache.set(taskId, p);
  return p;
}

/** Merge a fetched detail over its list row. */
export const mergeRunDetail = (
  task: SetTask,
  d: RunDetailPatch,
): SetTask => ({
  ...task,
  detailState: "loaded",
  input: d.input,
  inputTokens: d.inputTokens,
  ...(task.output && d.outputTokens
    ? { output: { ...task.output, tokens: d.outputTokens } }
    : {}),
});
