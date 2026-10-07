"use client";

/**
 * The Behind-the-Rip chart's data, in whichever mode the site is running.
 *
 * Mock mode: the runs are *computed here*, one ECVRF prove plus a full
 * selection loop each, so the chart asks for them a few at a time (`request`)
 * and a set's rejections cost nothing until they are opened.
 *
 * API mode: the runs already exist as records, so there is nothing to execute —
 * pages of them are pulled in the background until the pack's history is
 * complete, and `request` is a no-op. Only the heavy per-run detail (candidate
 * pool + lineup) is deferred, fetched when a node is expanded.
 *
 * Both modes hand the chart the same shape: every run's `RunSpec` newest first,
 * a lookup for the ones that have materialized, the pack's committed sets, and
 * each set's rejected runs paged behind `openRetries`.
 *
 * The packings list is keyed by SET, not by run: one row per set, carrying that
 * set's accepted run and a count of the runs that failed before it. The failed
 * runs themselves come from the set-scoped endpoint, a page at a time.
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
  fetchSetPackingsPage,
  SET_PACKINGS_API_LIMIT,
} from "@/lib/api/renaiss/verify/get-set-packings";
import {
  fetchSetsPage,
  SETS_API_LIMIT,
  type ActiveSetSummary,
} from "@/lib/api/renaiss/verify/get-sets";
import type { SetSummary } from "@/lib/api/types";
import { USE_MOCK_DATA } from "@/lib/config";

/** Rejected runs per page — the API's page size, mirrored in mock mode. */
export const RETRIES_PAGE_SIZE = SET_PACKINGS_API_LIMIT;

/** One page of a set's rejected runs, as the chart renders it. */
export interface RetryPage {
  /** Zero-based page currently being shown. */
  page: number;
  pageCount: number;
  /** The set's total fail count. */
  total: number;
  /** This page's runs — empty while it is still in flight. */
  tasks: readonly SetTask[];
  loading: boolean;
  error: boolean;
}

/** What has been fetched (or asked for) of one set's rejected runs. */
interface RetryState {
  page: number;
  /** Known once a page has landed; null before that. */
  total: number | null;
  pages: ReadonlyMap<number, readonly SetTask[]>;
  /** The page whose fetch failed, if any. */
  failedPage: number | null;
}

export interface Formation {
  /** Every run's shape, newest first — cheap in both modes. */
  specs: readonly RunSpec[];
  /** The run at `index`, once it has been computed (mock) or fetched (API). */
  taskAt: (index: number) => SetTask | undefined;
  /** Ask for these runs to materialize. No-op in API mode. */
  request: (indices: readonly number[]) => void;
  /** Pull the expensive detail for one run — API mode only. */
  requestDetail: (task: SetTask) => void;
  /** The pack's committed sets, by set id. */
  setById: ReadonlyMap<number, SetSummary>;
  /** How many runs were rejected before this set was claimed. */
  retryCountFor: (setId: number) => number;
  /** A set's rejected runs, once asked for. undefined = never opened. */
  retriesFor: (setId: number) => RetryPage | undefined;
  /** Open (or page) a set's rejected runs; fetches what isn't cached. */
  openRetries: (setId: number, page: number) => void;
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
  const [retries, setRetries] = useState<ReadonlyMap<number, RetryState>>(
    new Map(),
  );

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
    setRetries(new Map());
  }, [packId]);

  /* ---------------------------------------------------------------- mock -- */

  const specs = useMemo(
    () => (USE_MOCK_DATA ? RUN_SPECS_NEWEST_FIRST : tasks.map(specOf)),
    [tasks],
  );

  /**
   * Mock mode's rejected runs for one set: the plan's failed runs targeting it,
   * as indices into `specs` — the same indices `buildRunAt` is keyed by. In API
   * mode the list carries no failed rows at all, so this is empty there.
   */
  const retryIndicesFor = useCallback(
    (setId: number): number[] => {
      const out: number[] = [];
      specs.forEach((s, i) => {
        if (s.failed && s.setId === setId) out.push(i);
      });
      return out;
    },
    [specs],
  );

  /** The mock runs an open retry page needs built, on top of the chart's own. */
  const retryWanted = useMemo(() => {
    if (!USE_MOCK_DATA) return [];
    const out: number[] = [];
    for (const [setId, state] of retries) {
      const page = state.page;
      out.push(
        ...retryIndicesFor(setId).slice(
          page * RETRIES_PAGE_SIZE,
          (page + 1) * RETRIES_PAGE_SIZE,
        ),
      );
    }
    return out;
  }, [retries, retryIndicesFor]);

  // Compute only what the chart has asked for, one run at a time, yielding
  // between each: building eagerly pins the main thread for seconds and the
  // page would sit frozen before the first row painted.
  useEffect(() => {
    if (!USE_MOCK_DATA) return;
    let cancelled = false;
    (async () => {
      for (const i of [...wanted, ...retryWanted]) {
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
  }, [wanted, retryWanted, built]);

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
  // reader has actually scrolled: a real pack runs to hundreds of sets, so
  // walking it all up front would be dozens of sequential round-trips for a
  // chart showing four rows.
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

  /**
   * Fetch one run's candidate pool + lineup, merged in place.
   *
   * Takes the task rather than a list index: a rejected run lives in a retry
   * page, not in the pack-scoped list, and both collections have to see the
   * patch — the row the reader expanded is whichever one holds that taskId.
   */
  const detailing = useRef<Set<string>>(new Set());
  const requestDetail = useCallback((task: SetTask) => {
    if (USE_MOCK_DATA) return;
    if (!task.taskId || task.detailState !== "pending") return;
    const { taskId } = task;
    if (detailing.current.has(taskId)) return;
    detailing.current.add(taskId);

    const patch = (fn: (t: SetTask) => SetTask) => {
      setTasks((prev) =>
        prev.some((t) => t.taskId === taskId)
          ? prev.map((t) => (t.taskId === taskId ? fn(t) : t))
          : prev,
      );
      setRetries((prev) => {
        let touchedAny = false;
        const next = new Map(prev);
        for (const [setId, state] of prev) {
          let touched = false;
          const pages = new Map(state.pages);
          for (const [p, list] of state.pages) {
            if (!list.some((t) => t.taskId === taskId)) continue;
            pages.set(
              p,
              list.map((t) => (t.taskId === taskId ? fn(t) : t)),
            );
            touched = true;
          }
          if (touched) {
            next.set(setId, { ...state, pages });
            touchedAny = true;
          }
        }
        return touchedAny ? next : prev;
      });
    };

    fetchRunDetail(taskId)
      .then((d) => patch((t) => mergeRunDetail(t, d)))
      .catch(() => patch((t) => ({ ...t, detailState: "error" as const })));
  }, []);

  /* ------------------------------------------------------------- retries -- */

  const retryFetching = useRef<Set<string>>(new Set());

  const openRetries = useCallback(
    (setId: number, page: number) => {
      setRetries((prev) => {
        const cur = prev.get(setId);
        const next = new Map(prev);
        next.set(setId, {
          page,
          total: cur?.total ?? null,
          pages: cur?.pages ?? new Map(),
          // Re-asking for a page clears its previous failure, so collapsing
          // and reopening is the retry.
          failedPage: cur?.failedPage === page ? null : (cur?.failedPage ?? null),
        });
        return next;
      });
      // Mock mode has no endpoint — the build queue picks the page up from
      // `retries` and materializes those runs locally.
      if (USE_MOCK_DATA) return;

      const key = `${setId}:${page}`;
      if (retryFetching.current.has(key)) return;
      retryFetching.current.add(key);
      const mine = gen.current;
      fetchSetPackingsPage(packId, setId, page * RETRIES_PAGE_SIZE)
        .then((res) => {
          if (mine !== gen.current) return;
          setRetries((prev) => {
            const cur = prev.get(setId);
            if (!cur) return prev;
            const pages = new Map(cur.pages);
            pages.set(page, res.tasks);
            const next = new Map(prev);
            next.set(setId, { ...cur, total: res.total, pages });
            return next;
          });
        })
        .catch(() => {
          if (mine !== gen.current) return;
          setRetries((prev) => {
            const cur = prev.get(setId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(setId, { ...cur, failedPage: page });
            return next;
          });
        })
        .finally(() => {
          retryFetching.current.delete(key);
        });
    },
    [packId],
  );

  const retryCountFor = useCallback(
    (setId: number): number => {
      if (USE_MOCK_DATA) return retryIndicesFor(setId).length;
      // The count rides on the set's accepted run, which is the row the chart
      // is drawing when it asks.
      return tasks.find((t) => t.setId === setId)?.totalFailCount ?? 0;
    },
    [tasks, retryIndicesFor],
  );

  const retriesFor = useCallback(
    (setId: number): RetryPage | undefined => {
      const state = retries.get(setId);
      if (!state) return undefined;
      const { page } = state;
      const error = state.failedPage === page;

      if (USE_MOCK_DATA) {
        const indices = retryIndicesFor(setId);
        const slice = indices.slice(
          page * RETRIES_PAGE_SIZE,
          (page + 1) * RETRIES_PAGE_SIZE,
        );
        const tasksOnPage = slice
          .map((i) => built.get(i))
          .filter((t): t is SetTask => t !== undefined);
        return {
          page,
          pageCount: Math.max(1, Math.ceil(indices.length / RETRIES_PAGE_SIZE)),
          total: indices.length,
          tasks: tasksOnPage,
          loading: tasksOnPage.length < slice.length,
          error: false,
        };
      }

      const tasksOnPage = state.pages.get(page);
      // The count the row already showed carries the pager until the first
      // page lands and replaces it with the endpoint's own total.
      const total = state.total ?? retryCountFor(setId);
      return {
        page,
        pageCount: Math.max(1, Math.ceil(total / RETRIES_PAGE_SIZE)),
        total,
        tasks: tasksOnPage ?? [],
        loading: tasksOnPage === undefined && !error,
        error,
      };
    },
    [retries, built, retryIndicesFor, retryCountFor],
  );

  /* -------------------------------------------------------------- shared -- */

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
    retryCountFor,
    retriesFor,
    openRetries,
    ready,
    error,
    hasMoreRuns,
    loadMoreRuns,
    ensureSetsDownTo,
    activeTask,
    activeSet,
  };
}
