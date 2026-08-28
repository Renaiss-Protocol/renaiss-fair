"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import logoFull from "@/public/logo-full.svg";
import { gsap, useGSAP } from "@/components/gsap";
import { type RunSpec } from "@/app/packing/page-client";
import {
  STATUS_LABEL,
  STATUS_TONE,
  TaskDetail,
  type SetTask,
} from "@/components/task-rows";
import { DetailSheet } from "@/components/detail-sheet";
import { formatUsd } from "@/lib/format";
import { SetProvenance } from "@/components/set-provenance";
import { SetDetailBody } from "@/components/set-detail";
import { Tag } from "@/components/tag";
import { getVrfPublicKey } from "@/lib/api/client";
import { USE_MOCK_DATA } from "@/lib/config";
import { useFormation } from "@/lib/use-formation";
import { getOnChainMerkleRoot } from "@/lib/onchain";
import { truncateHex } from "@/lib/format";
import { DataChip } from "@/components/provenance";
import type { SetSummary, VrfPublicKey } from "@/lib/api/types";
import type { ActiveTaskSummary } from "@/lib/api/renaiss/verify/get-packing";
import type { ActiveSetSummary } from "@/lib/api/renaiss/verify/get-sets";

/** Height of a collapsed card header — the connector matches it so the status
 *  pill and dashed arrows line up with the card's title, not its expanded body. */
const NODE_H = "min-h-[58px]";

/** Lazy load: render this many rows first, then reveal more per click. */
/**
 * Rows, not runs. Four is enough to tell the story on first paint — the newest
 * runs, the rejected streak, and the run that finally claimed the set — while
 * keeping the initial build to three runs. Each run is real cryptography, so
 * every extra row on first paint is real main-thread time.
 */
const INITIAL_ROWS = 4;
const LOAD_MORE = 5;

/** The one node open at a time drives the column widths. */
type Open = { side: "task" | "set"; id: number } | null;

/** The live row's run in the one-open-node state — finished runs number from
 *  1, so 0 can never collide with one. */
const ACTIVE_TASK_ID = 0;

/**
 * Phone-sized viewports open a node's detail as a full-screen sheet rather than
 * inline — the panel runs to about three phone screens, which buries the
 * surrounding flow. Decided in JS rather than rendering both copies and letting
 * CSS pick, because the detail re-verifies proofs; two copies would do that
 * work twice.
 */
function useIsPhone() {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isPhone;
}

/** Column widths: the expanded side grows, the other shrinks. */
const gridColsFor = (open: Open): string =>
  open?.side === "task"
    ? "minmax(0,2.6fr) minmax(90px,0.5fr) minmax(150px,0.85fr)"
    : open?.side === "set"
      ? "minmax(150px,0.85fr) minmax(90px,0.5fr) minmax(0,2.6fr)"
      : "minmax(0,1fr) minmax(120px,0.7fr) minmax(0,1fr)";

/**
 * The headline of a packing run: how many attempts the selection loop needed,
 * what it produced, and how long it took. A run retries until a lineup fits the
 * EV band and every tier quota, so the attempt count is the story — the accepted
 * lineup's size and expected value are what it committed.
 *
 * The wall-clock start time is deliberately absent: runs already read
 * newest-first, so the date is redundant, and the exact trigger timestamp is in
 * the expanded detail. Only the duration varies meaningfully run to run.
 */
const runHeadline = (t: SetTask): string => {
  const tries = t.attempts?.length ?? 0;
  const attempts = `${tries} ${tries === 1 ? "attempt" : "attempts"}`;
  const took =
    t.durationMs === undefined ? "" : ` · ${(t.durationMs / 1000).toFixed(1)}s`;
  if (t.status === "success" && t.output) {
    // A run fetched from the API may carry its EV without the lineup itself.
    const cards =
      t.output.tokens === undefined ? "" : ` · ${t.output.tokens.length} cards`;
    return `${attempts}${cards} · EV ${formatUsd(t.output.expectedValueInUsd)}${took}`;
  }
  const why = t.errorCode === "TIMEOUT" ? "timed out" : "no valid lineup";
  return `${attempts} · ${why}${took}`;
};

/**
 * How a run is named on screen. API mode has an opaque wire id, of which the
 * Packing tab shows the first segment — the chart matches it so the same run
 * reads the same on both. Mock runs have no wire id and keep their number.
 */
const runLabel = (t: SetTask): string =>
  t.taskId?.split("-")[0] ?? String(t.id);

/** The same story in the width a phone column can spare: attempts, then what it
 *  produced (or why it didn't). EV and duration wait for the expanded panel. */
const runHeadlineShort = (t: SetTask): string => {
  const tries = t.attempts?.length ?? 0;
  // Branch on the run's status, never on whether its lineup has arrived: an
  // API-served success carries no tokens until the node is expanded, and
  // falling through to the failure wording would label it "no lineup" — the
  // exact opposite of what it did.
  if (t.status === "success") {
    return t.output?.tokens
      ? `${tries}× · ${t.output.tokens.length} cards`
      : `${tries}× · packed`;
  }
  return `${tries}× · ${t.errorCode === "TIMEOUT" ? "timed out" : "no lineup"}`;
};

/**
 * "Verify a Gacha" as a flow chart: every packing run is a node on the left,
 * a dashed arrow through its status carries it to the set it committed on the
 * right. A failed run's arrow stops at the status — it produced no set.
 * Expanding a node grows its column and shrinks the other side.
 */
export function FormationChart({
  packId,
  onChainPackId,
}: {
  /** The pack whose formation is charted — a fixture id in mock mode, the
   *  on-chain id in API mode. */
  packId: string;
  onChainPackId: string;
}) {
  const searchParams = useSearchParams();
  const isPhone = useIsPhone();
  const {
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
  } = useFormation(packId);
  const [vrfKey, setVrfKey] = useState<VrfPublicKey | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
  const [openStacks, setOpenStacks] = useState<ReadonlySet<string>>(new Set());

  const toggleStack = (key: string) =>
    setOpenStacks((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /**
   * The chart's rows, derived from each run's shape alone — no run is executed
   * (mock) or expanded (API) to work this out. More than one rejection in a row
   * collapses into a single stacked row; a lone rejection stays its own row,
   * since stacking one thing hides it behind a click for nothing. Because this
   * is free, "load more" can advance by ROWS, so the next click always brings
   * the next real step of the story rather than five more rejections
   * disappearing into a stack.
   */
  const allRows = useMemo(() => {
    type Row =
      | { kind: "run"; key: string; index: number; spec: RunSpec }
      | { kind: "stack"; key: string; indices: number[]; specs: RunSpec[] };
    const out: Row[] = [];
    let streak: number[] = [];
    const flush = () => {
      if (streak.length > 1) {
        out.push({
          kind: "stack",
          key: `stack-${specs[streak[0]!]!.id}`,
          indices: streak,
          specs: streak.map((i) => specs[i]!),
        });
      } else {
        for (const i of streak) {
          const spec = specs[i]!;
          out.push({ kind: "run", key: `run-${spec.id}`, index: i, spec });
        }
      }
      streak = [];
    };
    specs.forEach((spec, i) => {
      if (spec.failed) {
        streak.push(i);
        return;
      }
      flush();
      out.push({ kind: "run", key: `run-${spec.id}`, index: i, spec });
    });
    flush();
    return out;
  }, [specs]);

  const shownRows = useMemo(
    () => allRows.slice(0, visibleRows),
    [allRows, visibleRows],
  );

  /**
   * Which runs actually need executing: the standalone rows on screen, plus the
   * contents of any stack the reader has opened. A collapsed stack states its
   * count from the plan, so thirty rejections cost nothing until asked for.
   */
  const neededIndices = useMemo(() => {
    const need: number[] = [];
    for (const row of shownRows) {
      if (row.kind === "run") need.push(row.index);
      else if (openStacks.has(row.key)) need.push(...row.indices);
    }
    return need;
  }, [shownRows, openStacks]);

  // Hand the data layer the runs on screen; it decides what that costs.
  useEffect(() => {
    request(neededIndices);
  }, [request, neededIndices]);

  // Keep a page of rows in hand beyond what the reader has revealed, so
  // "Load more" always has something to show rather than a pause. A stack can
  // swallow a whole page of rejections into one row, so this may need several
  // passes — each arrival re-runs it.
  // `specs.length` is the trigger that keeps this going: a page of pure
  // rejections is swallowed whole by a trailing stack, leaving the row count
  // unchanged, and without it the pager would stall one page in.
  useEffect(() => {
    if (hasMoreRuns && allRows.length - visibleRows < LOAD_MORE) loadMoreRuns();
  }, [hasMoreRuns, loadMoreRuns, allRows.length, visibleRows, specs.length]);

  // The sets those runs flow into, pulled down to the oldest one on screen.
  useEffect(() => {
    const oldest = shownRows.at(-1);
    if (!oldest) return;
    const setId =
      oldest.kind === "run" ? oldest.spec.setId : oldest.specs.at(-1)!.setId;
    ensureSetsDownTo(setId);
  }, [shownRows, ensureSetsDownTo, setById]);

  // The live set rides page one of the sets list; a brand-new machine has no
  // finished-run rows to trigger the effect above, so the active row asks on
  // its own.
  useEffect(() => {
    if (activeTask) ensureSetsDownTo(activeTask.setId);
  }, [activeTask, ensureSetsDownTo]);

  // The global demo key backs mock replays only — API-mode draws each carry
  // their own publicKeyHex, so nothing here should wait on (or fall back to)
  // a fixture value when the site is running on the API.
  useEffect(() => {
    if (!USE_MOCK_DATA) return;
    let cancelled = false;
    getVrfPublicKey().then((key) => {
      if (!cancelled) setVrfKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const linkedSet = searchParams.get("set");
  useEffect(() => {
    if (linkedSet === null || !/^\d+$/.test(linkedSet)) return;
    const id = Number(linkedSet);
    setOpen({ side: "set", id });
    // A deep-linked set is usually further down than the rows shown so far;
    // reveal enough of the chart to reach it, or opening it would do nothing.
    const idx = allRows.findIndex(
      (r) => r.kind === "run" && !r.spec.failed && r.spec.setId === id,
    );
    if (idx >= 0) setVisibleRows((v) => Math.max(v, idx + 1));
    // activeSet is a dependency for the ?root= deep link: the active node
    // mounts only once its row arrives, and re-opening then re-runs the
    // scroll effect below so the link actually lands on it.
  }, [linkedSet, allRows, activeSet]);

  // Focus the node the user just opened — scroll it into view. On a phone the
  // detail takes over the screen and the chart behind it is frozen, so there is
  // nothing to scroll to and doing so would fight the sheet's scroll lock.
  useEffect(() => {
    if (!open || isPhone) return;
    const el = scope.current?.querySelector(
      `[data-node="${open.side}-${open.id}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open, isPhone]);

  // Only mock mode has a global key to wait for.
  const chartReady = ready && (!USE_MOCK_DATA || !!vrfKey);
  // Re-key the entrance on the selected machine so switching packs replays it.
  const machineSlug = searchParams.get("machine");
  // Entrance when the chart shows up (tab switch / machine select): the
  // inventory slides in from the left, then the flow rows stagger up.
  useGSAP(
    () => {
      if (!chartReady) return;
      // A backgrounded tab suspends requestAnimationFrame, which freezes these
      // tweens mid-flight and would leave the chart stuck invisible (opening the
      // page in a new background tab is enough to hit it). The entrance is
      // decoration — it must never be able to hide content, so skip it and paint
      // the chart plainly. clearProps drops the inline styles once it lands, so
      // an interrupted tween can't leave anything hidden either.
      if (typeof document !== "undefined" && document.hidden) return;
      const settle = "opacity,visibility,transform";
      gsap.from("[data-inventory]", {
        autoAlpha: 0,
        x: -16,
        duration: 0.7,
        ease: "power2.out",
        clearProps: settle,
      });
      gsap.from("[data-flow-row]", {
        autoAlpha: 0,
        y: 18,
        duration: 0.6,
        stagger: 0.07,
        ease: "power2.out",
        delay: 0.2,
        clearProps: settle,
      });
    },
    { scope, dependencies: [chartReady, machineSlug] },
  );

  /**
   * Unstacking: each run fades in as it lands. The runs are executed one at a
   * time, so this fires once per arrival — animate only the rows that haven't
   * been animated yet, or every already-settled row would be yanked back to
   * invisible on each new arrival, which reads as flicker rather than a reveal.
   * Ids are pruned to what's still mounted, so collapsing and reopening a stack
   * plays the reveal again.
   */
  const revealed = useRef<Set<string>>(new Set());
  useGSAP(
    () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const rows = gsap.utils.toArray<HTMLElement>(
        "[data-stack-body] [data-flow-row]",
      );
      const mounted = new Set(rows.map((el) => el.dataset["rowId"] ?? ""));
      for (const id of revealed.current) {
        if (!mounted.has(id)) revealed.current.delete(id);
      }
      const fresh = rows.filter(
        (el) => !revealed.current.has(el.dataset["rowId"] ?? ""),
      );
      if (fresh.length === 0) return;
      fresh.forEach((el) => revealed.current.add(el.dataset["rowId"] ?? ""));
      gsap.from(fresh, {
        autoAlpha: 0,
        y: -8,
        duration: 0.3,
        stagger: 0.03,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      });
    },
    { scope, dependencies: [openStacks, specs.length] },
  );


  if (error) {
    return (
      <div className="px-6 py-16 text-center font-body text-[13px] text-muted">
        {error}
      </div>
    );
  }

  if (!chartReady) {
    return (
      <div className="px-6 py-16 text-center font-body text-[13px] text-muted">
        Charting each run to the set it committed…
      </div>
    );
  }

  // On a phone the detail opens as a full-screen sheet, so widening the
  // column behind it changes nothing the reader can see — it only shows on the
  // way out, as the chart snaps back to its own shape the moment the sheet
  // closes. The columns stay put there.
  const gridCols = gridColsFor(isPhone ? null : open);

  /**
   * A run we know of but haven't executed yet. Same shape and height as the real
   * row, so the list neither reflows nor shifts when the run lands — only the
   * detail line changes.
   */
  const renderPendingRun = (spec: RunSpec) => (
    <div
      key={spec.id}
      data-flow-row
      data-row-id={spec.id}
      className="relative"
    >
      <span
        aria-hidden
        className="absolute left-[-16px] top-[29px] hidden h-px w-4 bg-loss/40 lg:block"
      />
      <div
        className="chart-row grid min-w-0 items-start gap-x-0 sm:gap-x-3 lg:gap-x-4"
        style={{ "--chart-cols": gridCols } as React.CSSProperties}
      >
        <div className="min-w-0">
          <div className="rounded-lg border border-loss/35 bg-loss/[0.025]">
            <div
              className={`flex w-full flex-col items-start justify-center gap-0.5 px-2.5 pr-8 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 sm:py-3`}
            >
              <span className="whitespace-nowrap font-display text-[12px] font-semibold text-loss/80 sm:text-[14px] lg:text-[15px]">
                <span className="sm:hidden">Task #{spec.id}</span>
                <span className="hidden sm:inline">Packing task #{spec.id}</span>
              </span>
              <span className="whitespace-nowrap font-mono-num text-[10px] text-loss/50 sm:text-[11px]">
                replaying…
              </span>
            </div>
          </div>
        </div>
        <Connector
          tone="loss"
          label={STATUS_LABEL.failed}
          hasSet={false}
          flowing={false}
        />
        <div />
      </div>
    </div>
  );

  /** One run as a flow row: task → status → the set it committed (if any). */
  const renderRun = (t: SetTask, flowing: boolean, index: number) => {
    const success = t.status === "success";
    const set = success ? setById.get(t.setId) : undefined;
    const taskOpen = open?.side === "task" && open.id === t.id;
    const setOpenHere =
      !!set && open?.side === "set" && open.id === set.setId;
    return (
      <div key={t.id} data-flow-row data-row-id={t.id} className="relative">
        {/* elbow: the task hangs off the inventory's rail */}
        <span
          aria-hidden
          className={`absolute left-[-16px] top-[29px] hidden h-px w-4 lg:block ${
            flowing ? "chart-line-x text-white/20" : "bg-white/15"
          }`}
        />
        <div
          // No transition on grid-template-columns: once the tracks mix fixed
          // and minmax() the browser stops interpolating and the used value
          // freezes at the old template, so the columns never follow the open
          // state. Snapping is reliable.
          className={`chart-row grid min-w-0 items-start gap-x-0 sm:gap-x-3 lg:gap-x-4 ${
            isPhone
              ? ""
              : taskOpen
                ? "chart-row--open-task"
                : setOpenHere
                  ? "chart-row--open-set"
                  : ""
          }`}
          style={{ "--chart-cols": gridCols } as React.CSSProperties}
        >
          {/* Below the desktop layout the opposite side steps aside while a
              node is expanded, so the detail panel gets the full width. Not on
              a phone: there the detail is a sheet over the top, so dropping a
              column buys no room and only shows as the row reshuffling — the
              survivors slide left under the sheet, then snap back on close. */}
          <div
            className={`min-w-0 ${!isPhone && setOpenHere ? "hidden lg:block" : ""}`}
          >
            <TaskNode
              task={t}
              isOpen={taskOpen}
              onPhone={isPhone}
              onToggle={() => {
                // API mode serves run records without their candidate pool or
                // lineup; pull that the moment the reader opens the node.
                if (!taskOpen) requestDetail(index);
                setOpen(taskOpen ? null : { side: "task", id: t.id });
              }}
            />
          </div>

          <Connector
            tone={STATUS_TONE[t.status]}
            label={STATUS_LABEL[t.status]}
            hasSet={success}
            flowing={flowing}
          />

          <div
            className={`min-w-0 ${!isPhone && taskOpen ? "hidden lg:block" : ""}`}
          >
            {success ? (
              set ? (
                <SetNode
                  set={set}
                  isOpen={setOpenHere}
                  onToggle={() =>
                    setOpen(
                      setOpenHere ? null : { side: "set", id: set.setId },
                    )
                  }
                  vrfPublicKeyHex={vrfKey?.publicKeyHex}
                  onPhone={isPhone}
                  packId={packId}
                  onChainPackId={onChainPackId}
                />
              ) : (
                <PendingNode id={t.setId} />
              )
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={scope}
      className="mx-auto w-full max-w-[1600px] px-4 pb-32 sm:px-6 lg:px-10"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-3">
        {/* The inventory — source of every run. It heads the column on small
            screens; from lg it sits to the left and sticks while you scroll. */}
        <div className="flex shrink-0 items-start">
          <div data-inventory className="relative lg:sticky lg:top-24">
            <span
              aria-hidden
              className="absolute left-full top-1/2 hidden h-px w-6 -translate-y-1/2 bg-white/25 lg:block"
            />
            <span className="inventory-pill inline-flex items-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5">
              <Image
                src={logoFull}
                alt="Renaiss"
                width={118}
                height={28}
                style={{ height: 26, width: "auto" }}
              />
              <span className="font-display text-[12px] font-semibold text-white/85 sm:text-[13px]">
                Inventory
              </span>
            </span>
          </div>
        </div>

        {/* The rail every task hangs off (lg only), then one flow row per run. */}
        <div className="relative min-w-0 flex-1 lg:pl-6">
          <span
            aria-hidden
            className="absolute bottom-7 left-2 top-3 hidden w-px bg-white/15 lg:block"
          />
          <div className="flex flex-col gap-2 lg:gap-3">
            {/* The machine's live formation first: the accepted run flowing to
                the set it committed, which is still selling. Rides outside the
                history's pagination, and both nodes are names-only — the run's
                detail and the set's lineup stay sealed until sellout. The two
                lists land independently, so the row can briefly be just the
                set while the packing page is still in flight. */}
            {(() => {
              const activeSetId = activeTask?.setId ?? activeSet?.setId;
              if (activeSetId === undefined) return null;
              const setOpenHere = open?.side === "set" && open.id === activeSetId;
              // Finished runs number from 1 (total - offset - i bottoms out at
              // 1), so 0 is free to name the active run in the one-open-node
              // state — which also keeps the task and set from opening on top
              // of each other, same as everywhere else in the chart.
              const taskOpenHere =
                open?.side === "task" && open.id === ACTIVE_TASK_ID;
              return (
                <ActiveFormationRow
                  task={activeTask}
                  set={activeSet}
                  setId={activeSetId}
                  isPhone={isPhone}
                  gridCols={gridCols}
                  isOpen={setOpenHere}
                  onToggle={() =>
                    setOpen(
                      setOpenHere ? null : { side: "set", id: activeSetId },
                    )
                  }
                  taskOpen={taskOpenHere}
                  onToggleTask={() =>
                    setOpen(
                      taskOpenHere ? null : { side: "task", id: ACTIVE_TASK_ID },
                    )
                  }
                />
              );
            })()}
            {shownRows.map((row, rowIdx) => {
              if (row.kind === "run") {
                const task = taskAt(row.index);
                // Not executed yet — it lands a tick later and slots in here.
                return task ? renderRun(task, rowIdx < 2, row.index) : null;
              }
              const isOpen = openStacks.has(row.key);
              return (
                <div key={row.key} className="flex flex-col gap-2 lg:gap-3">
                  <div data-flow-row className="relative">
                    <span
                      aria-hidden
                      className="absolute left-[-16px] top-[29px] hidden h-px w-4 bg-loss/40 lg:block"
                    />
                    <div
                      className="chart-row grid min-w-0 items-start gap-x-0 sm:gap-x-3 lg:gap-x-4"
                      style={{ "--chart-cols": gridCols } as React.CSSProperties}
                    >
                      <div className="min-w-0">
                        <StackNode
                          count={row.specs.length}
                          setId={row.specs[0]!.setId}
                          timedOut={row.specs.filter((s) => s.timedOut).length}
                          isOpen={isOpen}
                          onToggle={() => toggleStack(row.key)}
                        />
                      </div>
                      <Connector
                        tone="loss"
                        label={STATUS_LABEL.failed}
                        hasSet={false}
                        flowing={false}
                      />
                      <div />
                    </div>
                  </div>
                  {/* Unstacked: every run appears at once, identified from the
                      plan, and firms up as it is executed. Waiting for each to
                      build before showing it would dribble thirty rows in over
                      several seconds and reflow the page on every arrival. */}
                  {isOpen && (
                    <div
                      data-stack-body={row.key}
                      className="flex flex-col gap-2 lg:gap-3"
                    >
                      {row.indices.map((i) => {
                        const task = taskAt(i);
                        return task
                          ? renderRun(task, false, i)
                          : renderPendingRun(specs[i]!);
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Counts are rows, not runs — a collapsed streak is one row, so the
              next click brings the next real step rather than more rejections
              vanishing into the stack. */}
          {(visibleRows < allRows.length || hasMoreRuns) && (
            <div className="pt-6">
              <button
                onClick={() =>
                  setVisibleRows((v) => Math.min(v + LOAD_MORE, allRows.length))
                }
                disabled={visibleRows >= allRows.length}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hairline py-3 font-display text-[13px] font-semibold text-muted transition-colors hover:border-white/25 hover:bg-white/[0.03] hover:text-white disabled:cursor-default disabled:opacity-60 disabled:hover:border-hairline disabled:hover:bg-transparent disabled:hover:text-muted"
              >
                {visibleRows >= allRows.length ? (
                  "Loading more runs…"
                ) : (
                  <>
                    Load {Math.min(LOAD_MORE, allRows.length - visibleRows)} more
                    <span className="font-mono-num text-[12px] font-normal text-white/40">
                      {/* Only what's in hand — the rest of the history is still
                          being paged in, so a total here would be a guess. */}
                      {allRows.length - visibleRows} left
                      {hasMoreRuns ? "+" : ""}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A big, obvious expand affordance — a rounded chevron that lights up on hover
 *  (the whole header is the click target). */
function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-200 group-hover/node:border-white/25 group-hover/node:bg-white/10 group-hover/node:text-white sm:h-7 sm:w-7 ${
        isOpen
          ? "rotate-180 border-white/25 bg-white/10 text-white"
          : "border-transparent text-muted"
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

/** The height a node opens to while its detail is still being built. */
const DETAIL_PENDING_H = 74;

/**
 * A node's inline detail, opening and closing on a driven height.
 *
 * The detail's first render is expensive — a Merkle recompute plus a full
 * selection replay, measured at ~0.5s of blocked main thread. Mounting it in
 * the same frame the tween starts freezes that tween mid-flight, and GSAP,
 * being time-based, then jumps straight to the end: the open reads as a snap
 * no easing can fix. So this opens in two beats — the box expands on a cheap
 * placeholder, and the detail lands once the motion is done and grows the box
 * the rest of the way.
 *
 * The body also stays mounted through the closing tween. Unmounting on the
 * click is what makes a collapse snap shut, and it is the half that usually
 * gets forgotten. overflow is clipped only while a height is moving: left on,
 * it would cut the detail's hover cards off at the node's edge.
 *
 * A backgrounded tab suspends requestAnimationFrame, which would freeze a tween
 * mid-flight and leave the body stuck at height 0 — so there both directions
 * resolve instantly instead.
 */
function Collapse({
  open,
  light = false,
  children,
}: {
  open: boolean;
  /** Cheap content: mount it immediately and open in ONE tween straight to
   *  its natural height. The two-beat dance exists for details that block
   *  the main thread on first render — for a handful of chips it only adds
   *  an overshoot-and-shrink stutter (the box opens to the placeholder
   *  height, then snaps to a smaller auto). */
  light?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [detail, setDetail] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Beat one: open the box on the placeholder, or close it and unmount.
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (typeof document !== "undefined" && document.hidden) {
        if (open) setDetail(true);
        else {
          setMounted(false);
          setDetail(false);
        }
        return;
      }
      if (open) {
        if (light) {
          // The children are already in the DOM (mounted gates them, not
          // detail), so "auto" measures the real height and the open is one
          // smooth motion.
          setDetail(true);
          gsap.fromTo(
            el,
            { height: 0, autoAlpha: 0, overflow: "hidden" },
            {
              height: "auto",
              autoAlpha: 1,
              duration: 0.34,
              ease: "power2.out",
              clearProps: "height,overflow",
            },
          );
          return;
        }
        gsap.fromTo(
          el,
          { height: 0, autoAlpha: 0, overflow: "hidden" },
          {
            height: DETAIL_PENDING_H,
            autoAlpha: 1,
            duration: 0.28,
            ease: "power2.out",
            onComplete: () => setDetail(true),
          },
        );
      } else {
        gsap.to(el, {
          height: 0,
          autoAlpha: 0,
          overflow: "hidden",
          duration: 0.3,
          ease: "power2.inOut",
          // The detail is kept until the box is shut — dropping it first would
          // collapse the height out from under the tween.
          onComplete: () => {
            setMounted(false);
            setDetail(false);
          },
        });
      }
    },
    { dependencies: [open, mounted] },
  );

  // Beat two: the detail has rendered (and blocked); grow to fit it. This runs
  // in a layout effect, so the box never paints at full height first.
  useGSAP(
    () => {
      const el = ref.current;
      // Light mode opened straight to auto — there is no second beat.
      if (!el || !detail || !open || light) return;
      const settle = { clearProps: "height,overflow" };
      if (typeof document !== "undefined" && document.hidden) {
        gsap.set(el, { height: "auto", ...settle });
        return;
      }
      gsap.fromTo(
        el,
        { height: DETAIL_PENDING_H, overflow: "hidden" },
        {
          height: "auto",
          // This beat can cover a couple of thousand pixels, where an ease-out
          // spends most of that distance in the first few frames and reads as
          // a lurch; easing in and out keeps the growth even.
          duration: 0.42,
          ease: "power2.inOut",
          // The detail keeps fetching and verifying as it goes, so it can grow
          // after landing — a fixed height would clip whatever arrives late.
          ...settle,
        },
      );
    },
    { dependencies: [detail] },
  );

  // Children are only described while shut — nothing below this renders, so the
  // detail's proof work never runs for a closed node. Light content mounts
  // with the box so the open tween can measure its real height.
  if (!mounted) return null;
  return (
    <div ref={ref}>
      {light || detail ? (
        children
      ) : (
        <div className="px-4 py-6 text-center font-body text-[12px] text-muted">
          Verifying…
        </div>
      )}
    </div>
  );
}

/** Left node: a packing run. Collapsed = id + chevron; expands to the full run
 *  detail (attempts, randomness, recomputed root). */
function TaskNode({
  task: t,
  isOpen,
  onToggle,
  onPhone,
}: {
  task: SetTask;
  isOpen: boolean;
  onToggle: () => void;
  /** Phones open the detail as a full-screen sheet instead of inline. */
  onPhone: boolean;
}) {
  return (
    <div
      data-node={`task-${t.id}`}
      className={`group/node scroll-mt-24 rounded-lg border transition-colors ${
        t.status === "failed"
          ? "border-loss/35 bg-loss/[0.025]"
          : `bg-surface ${isOpen ? "border-white/30" : "border-hairline hover:border-white/25"}`
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`relative flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 pr-8 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 text-left transition-colors sm:py-3 ${
          t.status === "failed" ? "hover:bg-loss/[0.045]" : "hover:bg-white/[0.03]"
        } ${
          // Expanded: pin the run's number below the site header so it stays in
          // view while the detail scrolls past.
          isOpen
            ? "sticky top-[70px] z-20 rounded-b-none bg-surface"
            : ""
        }`}
      >
        <span
          title={t.taskId}
          className={`whitespace-nowrap font-display text-[12px] font-semibold sm:text-[14px] lg:text-[15px] ${
            t.status === "failed" ? "text-loss/80" : ""
          }`}
        >
          <span className="sm:hidden">Task #{runLabel(t)}</span>
          <span className="hidden sm:inline">Packing task #{runLabel(t)}</span>
        </span>
        <span
          className={`whitespace-nowrap font-mono-num text-[10px] sm:text-[11px] ${
            t.status === "failed" ? "text-loss/70" : "text-white/70"
          }`}
        >
          <span className="sm:hidden">{runHeadlineShort(t)}</span>
          <span className="hidden sm:inline">{runHeadline(t)}</span>
        </span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
          <Chevron isOpen={isOpen} />
        </span>
      </button>
      {onPhone ? (
        isOpen && (
          <DetailSheet
            title={`Packing task #${runLabel(t)}`}
            subtitle={runHeadline(t)}
            onClose={onToggle}
          >
            <TaskDetail task={t} />
          </DetailSheet>
        )
      ) : (
        <Collapse open={isOpen}>
          <div className="p-4">
            <TaskDetail task={t} />
          </div>
        </Collapse>
      )}
    </div>
  );
}

/** Right node: the committed set. Collapsed = id + status + chevron; expands to
 *  its genesis provenance and (once ripped out) its lineup + replay. */
function SetNode({
  set: s,
  isOpen,
  onToggle,
  vrfPublicKeyHex,
  onPhone,
  packId,
  onChainPackId,
}: {
  set: SetSummary;
  isOpen: boolean;
  onToggle: () => void;
  /** Mock mode's global demo key; undefined in API mode, where each draw
   *  carries its own. */
  vrfPublicKeyHex?: string | undefined;
  /** Phones open the detail as a full-screen sheet instead of inline. */
  onPhone: boolean;
  packId: string;
  onChainPackId: string;
}) {
  const sealed = s.status !== "completed";
  const tone =
    s.status === "completed" ? "purple" : s.status === "active" ? "gain" : "neutral";
  const label =
    s.status === "completed"
      ? "Fully Ripped"
      : s.status === "active"
        ? "Live"
        : "Upcoming";
  return (
    <div
      data-node={`set-${s.setId}`}
      className={`group/node scroll-mt-24 rounded-lg border bg-surface transition-colors ${
        isOpen ? "border-white/30" : "border-hairline hover:border-white/25"
      } ${s.status === "active" ? "live-node" : ""}`}
    >
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`relative flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 pr-8 sm:gap-1 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 text-left transition-colors hover:bg-white/[0.03] sm:py-3 ${
          // Expanded: pin the set's number below the site header so it stays in
          // view while the lineup and replay scroll past.
          isOpen
            ? "sticky top-[70px] z-20 rounded-b-none bg-surface"
            : ""
        }`}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:gap-x-2.5">
          <span className="whitespace-nowrap font-display text-[12px] font-semibold sm:text-[14px] lg:text-[15px]">
            Set #{s.setId}
          </span>
          {s.status === "active" ? (
            <span
              className="live-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[10px] font-semibold sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[12px]"
              style={{ background: "rgba(120,255,108,.16)", color: "var(--gain)" }}
            >
              {/* radar ping: an expanding ring behind a solid dot */}
              <span className="relative flex h-[6px] w-[6px] sm:h-[7px] sm:w-[7px]">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                <span className="relative inline-flex h-full w-full rounded-full bg-current" />
              </span>
              Live
            </span>
          ) : (
            <Tag tone={tone} dot compact>
              {label}
            </Tag>
          )}
        </span>
        {/* A ripped-out set is fully public, so it shows its lineup size. Live
            and upcoming sets stay sealed — never reveal the size before sellout. */}
        <span className="whitespace-nowrap font-mono-num text-[10px] text-muted sm:text-[11px]">
          {s.status === "completed" ? (
            <>
              <span className="sm:hidden">{s.cardCount} cards</span>
              <span className="hidden sm:inline">
                {s.cardCount} cards · all ripped
              </span>
            </>
          ) : (
            <>
              <span className="sm:hidden">🔒 sealed</span>
              <span className="hidden sm:inline">🔒 sealed until sold out</span>
            </>
          )}
        </span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
          <Chevron isOpen={isOpen} />
        </span>
      </button>
      {(() => {
        const detail = (
          <>
            <SetProvenance
              packId={packId}
              setId={s.setId}
              genesisOnly={sealed}
            />
            {!sealed && (
              <SetDetailBody
                packId={packId}
                onChainPackId={onChainPackId}
                setId={s.setId}
                vrfPublicKeyHex={vrfPublicKeyHex}
              />
            )}
          </>
        );
        return onPhone ? (
          isOpen && (
            <DetailSheet
              title={`Set #${s.setId}`}
              subtitle={
                s.status === "completed"
                  ? `${label} · ${s.cardCount} cards`
                  : `${label} · sealed until sold out`
              }
              onClose={onToggle}
            >
              {detail}
            </DetailSheet>
          )
        ) : (
          <Collapse open={isOpen}>
            <div className="p-4">{detail}</div>
          </Collapse>
        );
      })()}
    </div>
  );
}

/**
 * The machine's live formation as one flow row above the history: the
 * accepted creation run on the left, the set it committed — the one selling
 * right now — on the right. Names only, straight off the lists' active rows:
 * the run's config/EV/attempts and the set's lineup stay behind the reveal
 * watermark until sellout, so the task node never expands (its
 * /packings/{taskId} detail 404s on purpose) and the set node opens to just
 * its public commitment: algorithm, pack id, and merkle root.
 */
function ActiveFormationRow({
  task,
  set,
  setId,
  isPhone,
  gridCols,
  isOpen,
  onToggle,
  taskOpen,
  onToggleTask,
}: {
  /** null while the packing list's first page is still in flight — the row
   *  is then just the set with nothing flowing into it yet. */
  task: ActiveTaskSummary | null;
  set: ActiveSetSummary | null;
  setId: number;
  isPhone: boolean;
  gridCols: string;
  isOpen: boolean;
  onToggle: () => void;
  taskOpen: boolean;
  onToggleTask: () => void;
}) {
  return (
    <div data-flow-row data-row-id="active" className="relative">
      {/* elbow: the task hangs off the inventory's rail */}
      {task && (
        <span
          aria-hidden
          className="chart-line-x absolute left-[-16px] top-[29px] hidden h-px w-4 text-white/20 lg:block"
        />
      )}
      <div
        className={`chart-row grid min-w-0 items-start gap-x-0 sm:gap-x-3 lg:gap-x-4 ${
          isPhone
            ? ""
            : taskOpen
              ? "chart-row--open-task"
              : isOpen
                ? "chart-row--open-set"
                : ""
        }`}
        style={{ "--chart-cols": gridCols } as React.CSSProperties}
      >
        <div
          className={`min-w-0 ${!isPhone && isOpen ? "hidden lg:block" : ""}`}
        >
          {task && (
            <ActiveTaskNode
              task={task}
              isOpen={taskOpen}
              onToggle={onToggleTask}
            />
          )}
        </div>
        {task ? (
          <Connector
            tone={STATUS_TONE.success}
            label={STATUS_LABEL.success}
            hasSet
            flowing
          />
        ) : (
          <div />
        )}
        <div
          className={`min-w-0 ${!isPhone && taskOpen ? "hidden lg:block" : ""}`}
        >
          <ActiveSetNode
            setId={setId}
            set={set}
            isOpen={isOpen}
            onToggle={onToggle}
          />
        </div>
      </div>
    </div>
  );
}

/** Left node of the live row: the accepted run. Expands to the same
 *  "Generated set" block a finished run's detail leads with, holding just
 *  the published names — everything else is sealed until sellout, so there
 *  is nothing more to open (the run's detail endpoint 404s on purpose). */
function ActiveTaskNode({
  task,
  isOpen,
  onToggle,
}: {
  task: ActiveTaskSummary;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = task.taskId.split("-")[0];
  return (
    <div
      data-node={`task-${ACTIVE_TASK_ID}`}
      className={`group/node scroll-mt-24 rounded-lg border bg-surface transition-colors ${
        isOpen ? "border-white/30" : "border-hairline hover:border-white/25"
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`relative flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 pr-8 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 text-left transition-colors hover:bg-white/[0.03] sm:py-3`}
      >
        <span
          title={task.taskId}
          className="whitespace-nowrap font-display text-[12px] font-semibold sm:text-[14px] lg:text-[15px]"
        >
          <span className="sm:hidden">Task #{label}</span>
          <span className="hidden sm:inline">Packing task #{label}</span>
        </span>
        <span className="whitespace-nowrap font-mono-num text-[10px] text-white/70 sm:text-[11px]">
          <span className="sm:hidden">packed Set #{task.setId}</span>
          <span className="hidden sm:inline">
            packed Set #{task.setId} · {task.algorithm}
          </span>
        </span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
          <Chevron isOpen={isOpen} />
        </span>
      </button>
      <Collapse open={isOpen} light>
        <div className="p-4 pt-1">
          <div className="rounded-md border border-hairline bg-raised p-4">
            <p className="mb-2 font-display text-[13px] font-semibold">
              Generated set
            </p>
            <div className="flex flex-wrap gap-2">
              <DataChip
                label="task"
                value={label ?? task.taskId}
                full={task.taskId}
                source="api"
                detail="The creation run's id — the key its full record is served under once the set sells out."
              />
              <DataChip
                label="target set"
                value={`#${task.setId}`}
                source="api"
                detail="The set this run created — the one the machine is selling from right now."
              />
              <DataChip
                label="algorithm"
                value={task.algorithm}
                source="api"
                href="/whitepaper#fair-set-adaptive-algorithm"
                detail="The algorithm that picked the lineup, as recorded with the run."
              />
            </div>
            <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
              Config, attempts, EV, and the VRF proof unseal when the set
              sells out — the run then joins the history below in full.
            </p>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/** Right node of the live row: the selling set. Expands to its one public
 *  fact — the availability commitment (algorithm, pack id, merkle root) —
 *  which is what the shop's Fair panel deep-links here to show. */
function ActiveSetNode({
  setId,
  set,
  isOpen,
  onToggle,
}: {
  setId: number;
  /** null while the sets list's first page is still in flight. */
  set: ActiveSetSummary | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const expandable = set !== null;
  const openHere = isOpen && expandable;
  return (
    <div
      data-node={`set-${setId}`}
      className={`group/node live-node scroll-mt-24 rounded-lg border bg-surface transition-colors ${
        openHere ? "border-white/30" : "border-hairline hover:border-white/25"
      }`}
    >
      <button
        onClick={onToggle}
        disabled={!expandable}
        aria-expanded={openHere}
        className={`relative flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 pr-8 sm:gap-1 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 text-left transition-colors hover:bg-white/[0.03] sm:py-3`}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:gap-x-2.5">
          <span className="whitespace-nowrap font-display text-[12px] font-semibold sm:text-[14px] lg:text-[15px]">
            Set #{setId}
          </span>
          <span
            className="live-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[10px] font-semibold sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[12px]"
            style={{ background: "rgba(120,255,108,.16)", color: "var(--gain)" }}
          >
            {/* radar ping: an expanding ring behind a solid dot */}
            <span className="relative flex h-[6px] w-[6px] sm:h-[7px] sm:w-[7px]">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-full w-full rounded-full bg-current" />
            </span>
            Live
          </span>
        </span>
        <span className="whitespace-nowrap font-mono-num text-[10px] text-muted sm:text-[11px]">
          <span className="sm:hidden">🔒 sealed</span>
          <span className="hidden sm:inline">🔒 sealed until sold out</span>
        </span>
        {expandable && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
            <Chevron isOpen={openHere} />
          </span>
        )}
      </button>
      {/* Small enough to open inline on every viewport — no phone sheet. */}
      <Collapse open={openHere} light>
        {set && (
          <div className="p-4 pt-1">
            <ActiveSetProvenance set={set} />
          </div>
        )}
      </Collapse>
    </div>
  );
}

/**
 * The live set's provenance in the exact shape a Fully Ripped set opens to —
 * the same "Set genesis" and "Lineup commitment" blocks — holding only what
 * is public while the set sells: the algorithm and ids for genesis, and the
 * published root with no recompute (hashing the lineup back to the root
 * needs every card, and the lineup is sealed until sold out).
 */
function ActiveSetProvenance({ set }: { set: ActiveSetSummary }) {
  // The root committed on-chain — the commitment; the API-served row root is
  // display/fallback, same rule as SetProvenance.
  const [onchainRoot, setOnchainRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOnchainRoot(null);
    if (!USE_MOCK_DATA) {
      getOnChainMerkleRoot(set.packId, set.setId).then((root) => {
        if (!cancelled) setOnchainRoot(root);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [set.packId, set.setId]);

  if (onchainRoot && onchainRoot.toLowerCase() !== set.merkleRoot.toLowerCase()) {
    console.warn(
      `verify: served active-set root diverges from the on-chain commitment (pack ${set.packId}, set ${set.setId})`,
    );
  }
  const publishedRoot = onchainRoot ?? set.merkleRoot;
  const publishedSource: "onchain" | "api" = onchainRoot ? "onchain" : "api";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-hairline bg-raised p-4">
        <p className="mb-2 font-display text-[13px] font-semibold">
          Set genesis — how this lineup was built
        </p>
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="algorithm"
            value={set.algorithm}
            source="api"
            href="/whitepaper#fair-set-adaptive-algorithm"
            detail="The fair-set-adaptive algorithm that formed this lineup, as recorded with the run. Open-source, with the exact build inputs published so anyone can re-run it and reproduce this lineup."
          />
          <DataChip
            label="packId"
            href="/whitepaper#reproducibility"
            value={truncateHex(set.packId, 5)}
            full={set.packId}
            source="onchain"
            detail="The pack's 32-byte on-chain id — a seed input, so two builds anchored to the same block can never share a seed."
          />
          <DataChip
            label="set #"
            href="/whitepaper#reproducibility"
            value={`#${set.setId}`}
            source="api"
            detail="The set number being built — the final seed input, alongside the pack id and block reference."
          />
        </div>
        <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
          The remaining inputs — trigger, block, seed, attempts — unseal when
          the set sells out.
        </p>
      </div>

      <div className="rounded-md border border-hairline bg-raised p-4">
        <p className="mb-2 font-display text-[13px] font-semibold">
          Lineup commitment — hash the whole set back to its root
        </p>
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="published root"
            href="/whitepaper#pinning"
            value={truncateHex(publishedRoot, 6)}
            full={publishedRoot}
            source={publishedSource}
            detail={
              publishedSource === "onchain"
                ? "The set's availability root, read from the vending-machine contract's merkleRoots on-chain — commits every card before the first rip. Any lineup edit changes it."
                : "The set's availability root as served by the API (the on-chain read is not configured) — commits every card before the first rip. Any lineup edit changes it."
            }
          />
        </div>
        <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
          Only the published root while the set is selling — the recomputation
          hashes every card in the lineup, and the lineup stays sealed until
          sold out.
        </p>
      </div>
    </div>
  );
}

/**
 * A streak of consecutive rejections, shown as one card with the pile visible
 * behind it. Collapsed it states the streak; expanded it hands back the
 * individual runs, each still replayable on its own.
 */
function StackNode({
  count,
  setId,
  timedOut,
  isOpen,
  onToggle,
}: {
  count: number;
  setId: number;
  timedOut: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`relative ${isOpen ? "" : "mb-3.5"}`}>
      {/* The pile: each layer a little narrower and sitting a little lower, so
          its bottom corners read as cards behind the face. The peek clears the
          8px corner radius, otherwise the layers look like a doubled border
          rather than separate cards. Only while stacked. */}
      {!isOpen && (
        <>
          <span
            aria-hidden
            className="stack-layer absolute inset-x-6 top-2 -bottom-3 rounded-lg border border-loss/25"
          />
          <span
            aria-hidden
            className="stack-layer absolute inset-x-3 top-1 -bottom-1.5 rounded-lg border border-loss/30"
          />
        </>
      )}
      <div className="group/node stack-face relative rounded-lg border border-loss/40 transition-colors">
        <button
          onClick={onToggle}
          aria-expanded={isOpen}
          className={`relative flex w-full flex-col items-start justify-center gap-0.5 rounded-lg px-2.5 pr-8 sm:px-4 sm:pr-12 lg:px-5 ${NODE_H} py-2.5 text-left transition-colors hover:bg-loss/[0.05] sm:py-3`}
        >
          <span className="whitespace-nowrap font-display text-[12px] font-semibold text-loss/80 sm:text-[14px] lg:text-[15px]">
            {count} rejected runs
          </span>
          <span className="whitespace-nowrap font-mono-num text-[10px] text-loss/70 sm:text-[11px]">
            Set #{setId} unclaimed
            {timedOut > 0 ? ` · ${timedOut} timed out` : ""}
          </span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
            <Chevron isOpen={isOpen} />
          </span>
        </button>
      </div>
    </div>
  );
}

/** A set a run committed but that isn't published as a committed set yet. */
function PendingNode({ id }: { id: number }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-dashed border-hairline bg-surface/40 px-2.5 py-2.5 sm:gap-x-3 sm:px-4 sm:py-3 lg:px-5 ${NODE_H}`}
    >
      <span className="whitespace-nowrap font-display text-[12px] font-semibold text-muted sm:text-[14px] lg:text-[15px]">
        Set #{id}
      </span>
      <span className="whitespace-nowrap font-mono-num text-[10px] text-white/30 sm:text-[12px]">
        <span className="sm:hidden">pending</span>
        <span className="hidden sm:inline">pending · not yet committed</span>
      </span>
    </div>
  );
}

/** The dashed arrow between a run and its set, carrying the run's status + time.
 *  For a failed run the right half is absent — the arrow stops at the status. */
function Connector({
  tone,
  label,
  hasSet,
  flowing,
}: {
  tone: string;
  label: string;
  hasSet: boolean;
  /** Newest runs get a flowing dashed line; older ones a static solid line. */
  flowing: boolean;
}) {
  const failed = tone === "loss";
  const tint = failed ? "text-loss/50" : "text-white/20";
  const solid = failed ? "bg-loss/40" : "bg-white/15";
  const line = flowing ? `chart-line-x ${tint}` : solid;
  const lineOut = flowing ? "chart-line-x text-white/20" : "bg-white/15";
  return (
    <div className="w-full">
      {/* Small screens: the label collapses to an icon so the trio still fits on
          one line. The word stays available to screen readers. */}
      <div className={`flex ${NODE_H} items-center lg:hidden`}>
        {/* the run flows in from its task… */}
        <span className={`h-px flex-1 ${line}`} />
        <span
          role="img"
          aria-label={label}
          title={label}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{
            background: failed ? "rgba(255,50,104,.16)" : "rgba(120,255,108,.16)",
            color: failed ? "var(--loss)" : "var(--gain)",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {failed ? (
              <>
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </>
            ) : (
              <path d="M20 6 9 17l-5-5" />
            )}
          </svg>
        </span>
        {/* …and on out to the set it committed. A failed run has none, so the
            line stops at the icon. */}
        {hasSet ? (
          <span className={`h-px flex-1 ${lineOut}`} />
        ) : (
          <span className="flex-1" />
        )}
      </div>

      {/* Wide screens: the full dashed flow with the status word. */}
      <div className={`hidden ${NODE_H} items-center lg:flex`}>
        <span className={`h-px flex-1 ${line}`} />
        <div className="shrink-0 px-1.5 sm:px-2">
          <Tag tone={tone}>{label}</Tag>
        </div>
        {hasSet ? (
          <div className={`relative h-px flex-1 ${lineOut}`}>
            <span className="absolute right-[-1px] top-1/2 h-[6px] w-[6px] -translate-y-1/2 rotate-45 border-r border-t border-white/30" />
          </div>
        ) : (
          <span className="flex-1" />
        )}
      </div>
    </div>
  );
}
