"use client";

/**
 * The Behind-the-Rip chart's data, in whichever mode the site is running.
 *
 * Mock mode: the runs are *computed here*, one ECVRF prove plus a full
 * selection loop each, so the chart asks for them a few at a time (`request`)
 * and a collapsed streak of rejections costs nothing until it is opened.
 *
 * API mode: the runs already exist as records, so there is nothing to execute —
 * pages of them are pulled in the background until the pack's history is
 * complete, and `request` is a no-op. Only the heavy per-run detail (candidate
 * pool + lineup) is deferred, fetched when a node is expanded.
 *
 * Both modes hand the chart the same shape: every run's `RunSpec` newest first,
 * a lookup for the ones that have materialized, and the pack's committed sets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildRunAt,
  RUN_SPECS_NEWEST_FIRST,
  type RunSpec,
} from "@/app/packing/page-client";
import type { SetTask } from "@/components/task-rows";
import { DEFAULT_PACK_ID, listSets } from "@/lib/api/client";
import {
  fetchPackingPage,
  type ActiveTaskSummary,
} from "@/lib/api/renaiss/verify/get-packing";
import {
  fetchRunDetail,
  mergeRunDetail,
} from "@/lib/api/renaiss/verify/get-packing-run";
import {
  fetchSetsPage,
  SETS_API_LIMIT,
  type ActiveSetSummary,
} from "@/lib/api/renaiss/verify/get-sets";
import type { SetSummary } from "@/lib/api/types";
import { USE_MOCK_DATA } from "@/lib/config";

export interface Formation {
  /** Every run's shape, newest first — cheap in both modes. */
  specs: readonly RunSpec[];
  /** The run at `index`, once it has been computed (mock) or fetched (API). */
  taskAt: (index: number) => SetTask | undefined;
  /** Ask for these runs to materialize. No-op in API mode. */
  request: (indices: readonly number[]) => void;
  /** Pull the expensive detail for one run — API mode only. */
  requestDetail: (index: number) => void;
  /** The pack's committed sets, by set id. */
  setById: ReadonlyMap<number, SetSummary>;
  /** Enough has landed to draw the chart. */
  ready: boolean;
  /** The pack's history could not be read. */
  error: string | null;
  /** More runs exist on the server than `specs` covers. */
  hasMoreRuns: boolean;
  /** Pull the next page of runs. */
  loadMoreRuns: () => void;
  /** Make sure the sets down to this id are loaded. */
  ensureSetsDownTo: (setId: number) => void;
  /** The accepted creation run of the set the machine is selling from —
   * names only, never expandable (its detail is watermark-sealed). null in
   * mock mode, while page one is in flight, and once the machine drains. */
  activeTask: ActiveTaskSummary | null;
  /** The live set that run committed — ids, root, and algorithm only. */
  activeSet: ActiveSetSummary | null;
}

/** A run record already carries everything its spec needs. */
const specOf = (t: SetTask): RunSpec => ({
  id: t.id,
  setId: t.setId,
  failed: t.status === "failed",
  timedOut: t.errorCode === "TIMEOUT",
});

/**
 * The chart's runs and sets for one pack.
 *
 * `packId` is the fixture pack id in mock mode and the on-chain pack id in API
 * mode — the same value each mode's endpoints are keyed by.
 */
export function useFormation(packId: string): Formation {
  const [tasks, setTasks] = useState<readonly SetTask[]>([]);
  const [built, setBuilt] = useState<ReadonlyMap<number, SetTask>>(
    new Map(),
  );
  const [sets, setSets] = useState<readonly SetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState<readonly number[]>([]);
  const [activeTask, setActiveTask] = useState<ActiveTaskSummary | null>(null);
  const [activeSet, setActiveSet] = useState<ActiveSetSummary | null>(null);

  // Switching packs starts over — otherwise the previous pack's runs would
  // show under the new pack's name until its first page landed.
  useEffect(() => {
    setTasks([]);
    setBuilt(new Map());
    setSets([]);
    setError(null);
    setWanted([]);
    setActiveTask(null);
    setActiveSet(null);
  }, [packId]);

  /* ---------------------------------------------------------------- mock -- */

  // Compute only what the chart has asked for, one run at a time, yielding
  // between each: building eagerly pins the main thread for seconds and the
  // page would sit frozen before the first row painted.
  useEffect(() => {
    if (!USE_MOCK_DATA) return;
    let cancelled = false;
    (async () => {
      for (const i of wanted) {
        if (built.has(i)) continue;
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;
        const task = buildRunAt(i);
        setBuilt((prev) => {
          if (prev.has(i)) return prev;
          const next = new Map(prev);
          next.set(i, task);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, built]);

  useEffect(() => {
    if (!USE_MOCK_DATA) return;
    let cancelled = false;
    listSets(DEFAULT_PACK_ID).then((s) => {
      if (!cancelled) setSets(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ----------------------------------------------------------------- api -- */

  // Run history arrives a page at a time, newest first, and only as far as the
  // reader has actually scrolled: a real pack runs to hundreds of runs (715 on
  // the dev API's largest), so walking it all up front would be dozens of
  // sequential round-trips for a chart showing four rows.
  const runsTotal = useRef(Infinity);
  const runsOffset = useRef(0);
  const runsBusy = useRef(false);
  // The generation this paging belongs to — a pack switch bumps it, so a page
  // still in flight for the old pack can't append onto the new one's list.
  const gen = useRef(0);

  const loadMoreRuns = useCallback(() => {
    if (USE_MOCK_DATA) return;
    if (runsBusy.current || runsOffset.current >= runsTotal.current) return;
    runsBusy.current = true;
    const mine = gen.current;
    const offset = runsOffset.current;
    fetchPackingPage(packId, offset)
      .then((page) => {
        if (mine !== gen.current) return;
        runsTotal.current = page.total;
        runsOffset.current = offset + page.tasks.length;
        // A page that comes back empty before `total` would otherwise leave
        // the pager spinning on the same offset forever.
        if (page.tasks.length === 0) runsTotal.current = offset;
        // The active row rides the first page only; later pages stay silent
        // about it rather than clearing what page one established.
        if (offset === 0) setActiveTask(page.active);
        setTasks((prev) => [...prev, ...page.tasks]);
      })
      .catch(() => {
        if (mine !== gen.current) return;
        runsTotal.current = offset; // stop paging; keep whatever landed
        if (offset === 0) setError("Could not load this pack's packing runs.");
      })
      .finally(() => {
        if (mine === gen.current) runsBusy.current = false;
      });
  }, [packId]);

  // Sets are pulled the same way — far enough down to cover the runs on
  // screen. Both lists are newest-first, so they advance together.
  const setsTotal = useRef(Infinity);
  const setsOffset = useRef(0);
  const setsBusy = useRef(false);
  const lowestSet = useRef(Infinity);

  const ensureSetsDownTo = useCallback(
    (setId: number) => {
      if (USE_MOCK_DATA) return;
      if (setsBusy.current || setsOffset.current >= setsTotal.current) return;
      // Already have sets at or below the one asked for.
      if (lowestSet.current <= setId) return;
      setsBusy.current = true;
      const mine = gen.current;
      const offset = setsOffset.current;
      fetchSetsPage(packId, offset)
        .then((page) => {
          if (mine !== gen.current) return;
          setsTotal.current = page.total;
          setsOffset.current = offset + SETS_API_LIMIT;
          if (page.sets.length === 0) setsTotal.current = offset;
          if (offset === 0) setActiveSet(page.active);
          for (const s of page.sets) {
            lowestSet.current = Math.min(lowestSet.current, s.setId);
          }
          setSets((prev) => [...prev, ...page.sets]);
        })
        .catch(() => {
          // The runs alone still tell the story — a set that never arrives
          // just renders as the "not yet committed" node it already has.
          if (mine === gen.current) setsTotal.current = offset;
        })
        .finally(() => {
          if (mine === gen.current) setsBusy.current = false;
        });
    },
    [packId],
  );

  // A new pack starts its paging over.
  useEffect(() => {
    if (USE_MOCK_DATA) return;
    gen.current++;
    runsTotal.current = Infinity;
    runsOffset.current = 0;
    runsBusy.current = false;
    setsTotal.current = Infinity;
    setsOffset.current = 0;
    setsBusy.current = false;
    lowestSet.current = Infinity;
    loadMoreRuns();
    // Pull the first sets page unconditionally: the live set rides it, and a
    // brand-new machine (an active set, zero finished runs) serves no run
    // rows — waiting for a run to ask for its set would wait forever. -1 is
    // below every real set id, so the lowest-loaded guard can't skip the
    // fetch.
    ensureSetsDownTo(-1);
  }, [packId, loadMoreRuns, ensureSetsDownTo]);

  /** Fetch one run's candidate pool + lineup, merged in place. */
  const detailing = useRef<Set<string>>(new Set());
  const requestDetail = useCallback(
    (index: number) => {
      if (USE_MOCK_DATA) return;
      const task = tasks[index];
      if (!task?.taskId || task.detailState !== "pending") return;
      const { taskId } = task;
      if (detailing.current.has(taskId)) return;
      detailing.current.add(taskId);
      fetchRunDetail(taskId)
        .then((patch) => {
          setTasks((prev) =>
            prev.map((t) =>
              t.taskId === taskId ? mergeRunDetail(t, patch) : t,
            ),
          );
        })
        .catch(() => {
          setTasks((prev) =>
            prev.map((t) =>
              t.taskId === taskId ? { ...t, detailState: "error" as const } : t,
            ),
          );
        });
    },
    [tasks],
  );

  /* -------------------------------------------------------------- shared -- */

  const specs = useMemo(
    () => (USE_MOCK_DATA ? RUN_SPECS_NEWEST_FIRST : tasks.map(specOf)),
    [tasks],
  );

  const setById = useMemo(
    () => new Map(sets.map((s) => [s.setId, s])),
    [sets],
  );

  const request = useCallback((indices: readonly number[]) => {
    if (!USE_MOCK_DATA) return;
    // Same contents in the same order ⇒ same array identity, so the build
    // effect above doesn't restart on every render.
    setWanted((prev) =>
      prev.length === indices.length && prev.every((v, i) => v === indices[i])
        ? prev
        : indices.slice(),
    );
  }, []);

  const taskAt = useCallback(
    (index: number) => (USE_MOCK_DATA ? built.get(index) : tasks[index]),
    [built, tasks],
  );

  // A machine can be brand new: an active set and not one finished run yet.
  // The active row alone is then the whole story — paint it. Either half
  // counts: the two lists land independently, whichever arrives first.
  const ready = USE_MOCK_DATA
    ? built.size > 0
    : tasks.length > 0 || activeTask !== null || activeSet !== null;
  const hasMoreRuns = !USE_MOCK_DATA && tasks.length < runsTotal.current;

  return {
    specs,
    taskAt,
    request,
    requestDetail,
    setById,
    ready,
    error,
    hasMoreRuns,
    loadMoreRuns,
    ensureSetsDownTo,
    activeTask,
    activeSet,
  };
}
