"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { concat, keccak256, type Hex } from "viem";
import { gsap, useGSAP } from "./gsap";
import {
  runSelectionLoop,
  type RngDraw,
  type SelectFn,
  type SelectionAttempt,
  type SelectionRun,
} from "@renaiss/replay-fair-set";
import { nftExplorerUrl } from "@/lib/config";
import { replayAlgoFor } from "@/lib/replay-algos";
import { formatUsd, TIER_COLORS, truncateHex } from "@/lib/format";
import { recomputeRoot } from "@/lib/merkle";
import { ecvrfVerifyHex } from "@/lib/verify";
import { DataChip } from "./provenance";
import { Tag } from "./tag";
import { TokenHoverCard } from "./token-card";
import { useIsTouch } from "@/lib/use-touch";
import { useDotScrub } from "@/lib/use-dot-scrub";

/**
 * One card as it flows through a set-creation run: identity + valuation.
 * `valueInUsd` is the card's integer value in USD, as published at
 * construction time; the algorithm treats value as an integer and EV as
 * integer division.
 */
export interface TaskToken {
  tokenId: string;
  valueInUsd: number;
  /** Display tier letter by floor rank (s = highest). Packs can carry more
   * than four tiers, so this is an open string, not a fixed union. */
  tier: string;
  /** The pack's name for the tier (e.g. "legendary") — served by the API. */
  tierName?: string;
  name?: string;
  status?: string;
  /** The set-tab leaf salt — present when the token is a real set card. */
  merkleSalt?: string;
  /** Collectible identity (real set cards only; synthetic pools omit it). */
  setName?: string;
  gradingCompany?: string;
  grade?: string;
  year?: number;
  frontImageUrl?: string;
}

/**
 * One set-creation task record — the audit trail of a set-creation run.
 * The operator's task-list API is expected to return exactly this record
 * (the service that writes it runs operator-side; this page never ships that
 * code). Every field is persisted with the run, so the whole run replays
 * from the record alone:
 *
 *   - status / trigger / timing / error fields → stored with the task
 *   - config + inputTokens                     → the run's recorded inputs
 *   - output + attempts                        → the run's recorded outputs
 *   - vrf (blockHash, blockNumber, proof) + seed → stored / derived
 *
 * With the config, the input pool, and the VRF proof all in the record, this
 * page re-runs the same open-source algorithm (@renaiss/algorithms)
 * and reproduces the recorded attempts and lineup. Until that API is public,
 * the rows shown are demo records generated in the browser.
 */
export interface SetTask {
  id: number;
  /** Opaque wire id — the /verify/packing/run detail key (API mode only). */
  taskId?: string;
  /**
   * API mode: whether the heavy detail (candidate pool + lineup) has arrived.
   * The list endpoint serves run records only; absent means the task carries
   * everything inline (mock mode).
   */
  detailState?: "pending" | "loaded" | "error";
  /** The pack this run built a set for — set numbers are per-pack. */
  packId?: string;
  /** The set number this run tried to generate. */
  setId: number;
  triggerSource: "checkout" | "cron" | "manual";
  status: "running" | "success" | "failed";
  algoUsed: string | null;
  errorCode?: string;
  errorDetail?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  /** Pool sizing recorded with the run (persisted for failed runs too). */
  input?: {
    algoInputTokenCount: number;
  };
  /** The eligible pool the algorithm ran on, recorded with the run. */
  inputTokens?: TaskToken[];
  /**
   * The per-pack selection config the run was constrained by. Stored with
   * the task so a re-run uses the exact same bounds the original run did.
   */
  config?: {
    targetExpectedValueInUsd: number;
    lowerExpectedValueInUsd: number;
    upperExpectedValueInUsd: number;
    maxTokensInSet: number;
    lowerNumberOfTokensInNewSet: number;
    upperNumberOfTokensInNewSet: number;
    timeoutSeconds: number;
    tiers: {
      tier: string;
      /** The pack's display name for the tier — API mode only. */
      name?: string;
      floorValueInUsd: number;
      minNumberOfTokens: number;
      maxNumberOfTokens: number;
      targetNumberOfTokensPercentage: number;
    }[];
  };
  /** What the successful selection produced. */
  output?: {
    /** Integer mean value of the accepted lineup. */
    expectedValueInUsd: number;
    /** The accepted lineup, reconstructible from β in the verify panel.
     * Absent until the run detail arrives (API mode). */
    tokens?: TaskToken[];
    /** The operator's served root — cross-checked against the in-browser
     * recomputation (console-only), never rendered as truth. */
    publishedMerkleRoot?: string;
  };
  /**
   * Every algorithm attempt, in order, retrying until one validates. The
   * retry loop consumes one rng stream from β, so attempt k is fixed by the
   * k−1 attempts before it: any attempt replays from public data alone.
   */
  attempts: {
    algorithm: string;
    durationMs: number;
    outcome: "success" | "error" | "invalid";
    detail?: string;
    /** Metrics the operator recorded for this attempt. Verification-only:
     * compared against the browser replay (console.warn on mismatch) and
     * never rendered — the page only displays what it recomputes itself. */
    recorded?: { ev: number | null; drawStart: number; drawsUsed: number };
  }[];
  /** VRF evaluation captured at selection time — verifiable below. */
  vrf?: {
    blockNumber: number;
    blockHash: string;
    /** The pack's 32-byte on-chain id — an α input. */
    onChainPackId: string;
    /** α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂) —
     * the operator's seed derivation, recomputable from public data. */
    seed: string;
    /** Operator's ECVRF public key (a fixed demo key on this page). */
    publicKeyHex: string;
    /** π — the ECVRF proof over α. */
    proof: string;
    /** β — the VRF output the selection rng consumed. */
    randomness: string;
  };
}

/**
 * Replay a whole selection run from β: the same retry loop the operator ran —
 * attempts of the algorithm the record names (`algo_used`, resolved by
 * replayAlgoFor) over ONE rng stream, each judged by the acceptance check,
 * until a lineup validates. Deterministic, so every recorded attempt (and the
 * final lineup) reproduces from public data alone.
 */
const replayRun = (
  beta: string,
  pool: TaskToken[],
  config: NonNullable<SetTask["config"]>,
  selectFn: SelectFn,
): SelectionRun<TaskToken> => runSelectionLoop(beta, pool, config, selectFn);

/** Fallback per-token salt when the token isn't a real set card. */
const leafSalt = (seed: string, tokenId: string): Hex =>
  keccak256(
    concat([
      seed as Hex,
      `0x${BigInt(tokenId).toString(16).padStart(64, "0")}` as Hex,
    ]),
  );

/** Smooth-scroll a task's expanded detail to its Config & input section. */
const scrollToConfig = (taskId: number) => {
  document
    .getElementById(`cfg-${taskId}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export const STATUS_TONE = { success: "gain", failed: "loss", running: "message" } as const;
export const STATUS_LABEL = { success: "Success", failed: "Failed", running: "Running" } as const;

const fmtTime = (iso: string) => iso.replace("T", " ").slice(0, 19) + "Z";
// Money is an integer with 2 implied decimals everywhere — ÷100 at display.
const fmtUsd = formatUsd;

/**
 * A plain-language account of why a failed run committed no set — shown instead
 * of the raw error code (e.g. NO_SOLUTION / TIMEOUT), which reads as jargon. A
 * run fails one of two ways: every attempt is rejected by the acceptance check,
 * or the loop runs out of time before one validates.
 */
const failExplanation = (task: SetTask): string => {
  const n = task.attempts.length;
  switch (task.errorCode) {
    case "TIMEOUT": {
      const secs =
        task.config?.timeoutSeconds ??
        (task.durationMs ? Math.round(task.durationMs / 1000) : undefined);
      return `The run reached its ${
        secs ? `${secs}-second ` : ""
      }time limit before any lineup satisfied the EV band and every tier quota, so no set was committed.`;
    }
    // Pre-run failures: the run stopped before the selection loop started —
    // no proof, no attempts, nothing to verify (doc §4.4).
    case "CONFIG_INVALID":
      return "The run's selection config failed validation, so the selection loop never started and no set was committed.";
    case "BLOCKED":
      return "Set creation was blocked by the operator, so the selection loop never started and no set was committed.";
    case "CONCURRENCY_CONFLICT":
      return "Another run was already creating this pack's next set, so this run stopped before the selection loop started.";
    case "TOKEN_DISCOVERY_FAILED":
      return "The run could not assemble the eligible token pool, so the selection loop never started and no set was committed.";
  }
  if (n === 0)
    return "The run failed before the selection loop produced any attempt, so no set was committed.";
  return `All ${n} attempt${
    n === 1 ? "" : "s"
  } were rejected for landing outside the EV band or missing a tier quota, so no set could be committed.`;
};

export const TASKS_PAGE_SIZE = 10;
const PAGE_SIZE = TASKS_PAGE_SIZE;

/**
 * Page numbers with ellipsis gaps: first, last, and current ± 1 — the pager
 * must survive a 300+-page run history without rendering 300 buttons.
 * Shared with the Sets tab's rows (set-rows).
 */
export const pageWindow = (page: number, pageCount: number): (number | "gap")[] => {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, p) => p);
  const shown = [...new Set([0, page - 1, page, page + 1, pageCount - 1])]
    .filter((p) => p >= 0 && p < pageCount)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (const [i, p] of shown.entries()) {
    if (i > 0 && p - shown[i - 1]! > 1) out.push("gap");
    out.push(p);
  }
  return out;
};

/**
 * Server-wired pagination (API mode): the parent knows the true page count
 * from the list endpoint's `total` and fetches pages on demand — this
 * component just reports clicks and shows a loading body for pages whose
 * rows are still in flight. Omitted (mock mode) → self-contained paging.
 */
export interface TaskRowsPagination {
  page: number;
  pageCount: number;
  onGoto: (page: number) => void;
  /** The current page's rows are still fetching. */
  loading?: boolean;
}

/** Vertical task rows, newest first, collapsed by default, paginated. */
export function TaskRows({
  tasks,
  pagination,
  onExpandTask,
}: {
  tasks: SetTask[];
  pagination?: TaskRowsPagination;
  /** A row was expanded — API mode uses it to prioritize the detail fetch. */
  onExpandTask?: (task: SetTask) => void;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [ownPage, setOwnPage] = useState(0);

  const sorted = [...tasks].sort((a, b) => b.id - a.id);
  const page = pagination ? pagination.page : ownPage;
  const pageCount = pagination
    ? Math.max(1, pagination.pageCount)
    : Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Controlled mode hands over the page's rows ready-sliced.
  const rows = pagination
    ? sorted
    : sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const loading = pagination?.loading ?? false;

  useGSAP(
    () => {
      gsap.fromTo(
        "[data-task-row]",
        { y: 18, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: 0.06, duration: 0.4, ease: "power2.out" },
      );
    },
    { scope, dependencies: [page] },
  );

  // Expand/collapse: grow the newly expanded row's body from 0 height — the
  // same treatment the Sets tab uses (see set-rows). Collapse is instant
  // (the body unmounts); only the reveal animates.
  useGSAP(
    () => {
      if (expandedId === null) return;
      const body = scope.current?.querySelector(
        `[data-task-row-body="${expandedId}"]`,
      );
      if (body) {
        // Clip only while the height animates — a persistent overflow-hidden
        // would clip the DataChip hover tooltips at the row's top edge.
        gsap.fromTo(
          body,
          { height: 0, autoAlpha: 0, overflow: "hidden" },
          {
            height: "auto",
            autoAlpha: 1,
            duration: 0.45,
            ease: "power2.inOut",
            clearProps: "height,overflow", // async content can grow it after
          },
        );
      }
    },
    { scope, dependencies: [expandedId] },
  );

  const goto = (p: number) => {
    if (pagination) pagination.onGoto(p);
    else setOwnPage(p);
    setExpandedId(null); // rows are collapsed by default on a fresh page
  };

  return (
    <section ref={scope} className="mx-auto mt-8 max-w-5xl px-6 pb-20">
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="animate-pulse rounded-lg border border-hairline bg-surface p-10 text-center font-body text-[13px] text-muted">
            Loading runs…
          </div>
        )}
        {!loading &&
        rows.map((t) => {
          const isOpen = t.id === expandedId;
          return (
            <div
              key={t.id}
              data-task-row={t.id}
              className={`rounded-lg border bg-surface ${
                t.status === "failed" ? "border-loss/40" : "border-hairline"
              }`}
            >
              <button
                onClick={() => {
                  setExpandedId(isOpen ? null : t.id);
                  if (!isOpen) onExpandTask?.(t);
                }}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left"
              >
                {/* Prefer the server's run id (uuid, first segment) — the
                    numeric id is a client-side ordinal, kept for sort/expand
                    and as the fixture-mode fallback. */}
                <span
                  className="font-display text-base font-semibold"
                  title={t.taskId}
                >
                  Task #{t.taskId?.split("-")[0] ?? t.id}
                </span>
                <span className="font-body text-[13px] text-muted">
                  → Set #{t.setId}
                </span>
                <Tag tone={STATUS_TONE[t.status]} dot>
                  {STATUS_LABEL[t.status]}
                </Tag>
                <span className="ml-auto flex items-center gap-3">
                  <span className="font-mono-num text-[12px] text-muted">
                    {fmtTime(t.startedAt)}
                  </span>
                  <span className="font-mono-num text-[12px] text-muted">
                    {t.durationMs !== undefined
                      ? `${(t.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </span>
                  <span
                    className={`font-body text-xs text-muted transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    ▼
                  </span>
                </span>
              </button>

              {isOpen && (
                <div data-task-row-body={t.id}>
                  <div className="border-t border-hairline p-4">
                    <TaskDetail task={t} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* pagination */}
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          onClick={() => goto(page - 1)}
          disabled={page === 0}
          className="btn-ghost h-8 px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-35"
        >
          ← Prev
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span
              key={`gap-${i}`}
              className="px-1 font-mono-num text-[13px] text-muted"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => goto(p)}
              aria-current={p === page ? "page" : undefined}
              className={`h-8 min-w-8 rounded-full border px-1.5 font-mono-num text-[13px] ${
                p === page
                  ? "border-white/60 bg-raised font-bold text-white"
                  : "border-hairline text-muted hover:text-white"
              }`}
            >
              {p + 1}
            </button>
          ),
        )}
        <button
          onClick={() => goto(page + 1)}
          disabled={page === pageCount - 1}
          className="btn-ghost h-8 px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Next →
        </button>
      </div>
    </section>
  );
}

/** One detail section, always shown. */
function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="scroll-mt-4 rounded-md border border-hairline bg-raised">
      <div className="p-4">
        <span className="font-display text-[13px] font-semibold">{title}</span>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

/**
 * Chips-based detail, all sections shown:
 * Generated set → Algo config → Input → Attempts → Output (incl. published
 * values) → Re-run → Verify.
 */
export function TaskDetail({ task }: { task: SetTask }) {
  return (
    <div className="flex flex-col gap-3">
      {task.status === "failed" && (
        <div className="rounded-md border border-loss/60 bg-loss/10 p-4">
          <p className="font-display text-[13px] font-semibold text-loss">
            ✗ No pack was formed
          </p>
          <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
            {failExplanation(task)}
          </p>
        </div>
      )}

      <Section title="Generated set">
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="target set"
            value={`#${task.setId}`}
            source="api"
            detail="The set number this run created. Always one past the active set."
          />
          {task.algoUsed && (
            <DataChip
              label="algorithm"
              value={task.algoUsed}
              source="api"
              href="/whitepaper#fair-set-adaptive-algorithm"
              detail="The algorithm that picked the lineup."
            />
          )}
          {task.output?.tokens && (
            <DataChip
              label="selected"
              value={`${task.output.tokens.length} cards`}
              source="api"
              detail="How many cards went into the new set."
            />
          )}
          {task.output && (
            <DataChip
              label="EV"
              value={fmtUsd(task.output.expectedValueInUsd)}
              source="api"
              detail="Expected value of the lineup. It has to sit inside the EV band."
            />
          )}
        </div>
      </Section>

      {/* API mode: the pool + lineup live on the detail endpoint — until that
          lands (or fails) the sections below have nothing to render. */}
      {task.detailState === "pending" && (
        <div className="animate-pulse rounded-md border border-hairline bg-raised p-4 text-center font-body text-[12px] text-muted">
          Loading the run detail (candidate pool &amp; lineup)…
        </div>
      )}
      {task.detailState === "error" && (
        <div className="rounded-md border border-loss/60 bg-loss/10 p-4">
          <p className="font-display text-[13px] font-semibold text-loss">
            ✗ Could not load the run detail
          </p>
          <p className="mt-1 font-body text-[12px] text-muted">
            Collapse and expand the run to retry.
          </p>
        </div>
      )}

      {task.detailState !== "pending" && (task.config || task.inputTokens) && (
        <Section title="Config & input" id={`cfg-${task.id}`}>
          {task.config && (
            <div className="flex flex-wrap gap-2">
              <DataChip
                label="target EV"
                value={fmtUsd(task.config.targetExpectedValueInUsd)}
                source="api"
                href="/whitepaper#config-odds"
                detail="The expected value the selection aims for."
              />
              <DataChip
                label="EV band"
                value={`${fmtUsd(task.config.lowerExpectedValueInUsd)} – ${fmtUsd(task.config.upperExpectedValueInUsd)}`}
                source="api"
                detail="Hard limits. A lineup outside this band is rejected and the algorithm retries."
              />
              <DataChip
                label="max cards"
                value={String(task.config.maxTokensInSet)}
                source="api"
                detail="Upper bound on lineup size."
              />
              <DataChip
                label="size range"
                value={`${task.config.lowerNumberOfTokensInNewSet}–${task.config.upperNumberOfTokensInNewSet} cards`}
                source="api"
                detail="Bounds on the lineup size; each attempt draws its size at random from this range."
              />
              <TierConfigChip tiers={task.config.tiers} />
            </div>
          )}
          {task.inputTokens && (
            <div className="mt-3 flex flex-wrap gap-2">
              <DataChip
                label="candidate pool"
                value={`${task.inputTokens.length} cards`}
                source="api"
                detail="The eligible token pool the algorithm ran on."
              />
            </div>
          )}
          {task.inputTokens && (
            <TokenDots className="mt-2" title="" tokens={task.inputTokens} />
          )}
        </Section>
      )}

      {task.detailState !== "pending" && task.attempts.length > 0 && (
        <Section title="Attempts">
          <AttemptLog task={task} />
        </Section>
      )}

      {task.vrf && task.inputTokens && task.config && (
        <Section title="Verify the run randomness">
          <VerifyBody
            task={task}
            vrf={task.vrf}
            pool={task.inputTokens}
            config={task.config}
          />
        </Section>
      )}
    </div>
  );
}

const CELL = 12;

/**
 * Token lineup as the Sets tab renders it: one tier-colored cell per card,
 * hover pops the same card-detail tooltip (name, tier, id, value, status)
 * built from the task's own metadata.
 */
function TokenDots({
  title,
  tokens,
  className = "",
}: {
  title: string;
  tokens: TaskToken[];
  className?: string;
}) {
  const isTouch = useIsTouch();
  // Dragging across the dots walks the card from one to the next. The tap
  // opens a card; the scrub keeps changing which card is open.
  const scrub = useDotScrub({
    enabled: isTouch,
    onPick: (key, x, y) => {
      const t = tokens.find((tk) => tk.tokenId === key);
      if (t) setHover({ t, x, y });
    },
  });
  // Cursor (viewport) coords, so the tooltip can render `fixed` outside the
  // scroll container — a big grid scrolls without clipping the tooltip.
  const [hover, setHover] = useState<{
    t: TaskToken;
    x: number;
    y: number;
  } | null>(null);

  // The card is ~450px tall with its slab render — flip below the cursor
  // whenever there isn't that much room above.
  const below = hover !== null && hover.y < 460;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  // Where the open card sits in the matrix, and how to walk off it. Stepping
  // also brings the newly ringed cell into view — the arrows are for reading
  // the grid in order, so the grid has to follow.
  const at = hover ? tokens.findIndex((t) => t.tokenId === hover.t.tokenId) : -1;
  const step = (by: number) => {
    const next = tokens[at + by];
    if (at < 0 || !next) return null;
    return () => {
      setHover((h) => (h ? { ...h, t: next } : h));
      document
        .querySelector(`[data-dot="${CSS.escape(next.tokenId)}"]`)
        ?.scrollIntoView({ block: "end" });
    };
  };

  return (
    <div className={className}>
      {title && (
        <p className="mb-1.5 font-body text-[11.5px] text-muted">{title}</p>
      )}
      {/* Scrolls once the grid gets tall (e.g. 1,000+ cards) — matches the
          Sets-tab arena's capped-height token matrix. */}
      <div
        ref={scrub.ref}
        className="scroll-thin flex max-h-[220px] flex-wrap gap-[3px] overflow-y-auto"
        onMouseLeave={() => {
          if (!isTouch) setHover(null);
        }}
      >
        {tokens.map((t) => {
          // A tapped cell stays ringed while its card is open, so the reader
          // can see which square the card belongs to.
          const picked = isTouch && hover?.t.tokenId === t.tokenId;
          return (
          <a
            key={t.tokenId}
            href={nftExplorerUrl(t.tokenId)}
            target="_blank"
            rel="noreferrer"
            data-dot={t.tokenId}
            aria-label={
              isTouch
                ? `Token ID ${t.tokenId} — show card`
                : `Token ID ${t.tokenId} on BscScan`
            }
            onTouchEnd={(e) => {
              // The card opens from the touch, not from the click iOS
              // synthesizes after it: that click is swallowed whenever the tap
              // also stops a coasting scroll, which ate the first tap after
              // every scroll down to the grid. preventDefault here also stops
              // the click that would otherwise follow.
              if (!isTouch || scrub.tapGuarded()) return;
              e.preventDefault();
              const p = e.changedTouches[0];
              setHover({ t, x: p?.clientX ?? 0, y: p?.clientY ?? 0 });
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView({ block: "end" }), 0);
            }}
            onClick={(e) => {
              // The lift-off at the end of a drag synthesizes a click; it is
              // the tail of the scrub, not a new tap.
              if (scrub.tapGuarded()) {
                e.preventDefault();
                return;
              }
              // Touch has no hover, so the tap has to open the card rather
              // than leave for the explorer — the card carries that link now.
              if (!isTouch) return;
              e.preventDefault();
              setHover({ t, x: e.clientX, y: e.clientY });
              // The card pins to the top of the screen, so bring the tapped
              // square down into what is left below it — the reader keeps
              // sight of which cell the card is describing.
              // Instant, and off a plain timer rather than rAF: both smooth
              // scrolling and requestAnimationFrame are suspended in a
              // backgrounded tab, and the reader must never be left looking
              // at a card whose cell is off screen.
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView({ block: "end" }), 0);
            }}
            onMouseEnter={(e) => {
              if (!isTouch) setHover({ t, x: e.clientX, y: e.clientY });
            }}
            // relative + z so the ring sits over its neighbours rather than
            // being painted on by the cells that follow it.
            className="relative shrink-0 rounded-[3px] transition-shadow hover:z-10 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.92)]"
            style={{
              width: CELL,
              height: CELL,
              backgroundColor: `${TIER_COLORS[t.tier]}59`,
              // Leaves the cell clear of the bottom edge (and the floating
              // whitepaper button) when it is scrolled into view.
              scrollMarginBottom: 96,
              // Inline rather than a class: the hover ring is a Tailwind
              // utility, but its non-hover twin was never generated, so the
              // selected ring silently did nothing.
              ...(picked
                ? { boxShadow: "0 0 0 2px rgba(255,255,255,0.92)", zIndex: 10 }
                : {}),
            }}
          />
          );
        })}
      </div>

      {hover &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className={`fixed z-[120] ${isTouch ? "" : "pointer-events-none"}`}
              style={
                isTouch
                  ? // No cursor to sit beside, and the card is most of a phone
                    // screen, so it takes the top and the matrix keeps the rest.
                    // Nothing is laid over the grid to dismiss it — a backdrop
                    // would swallow the taps and drags meant for the dots, and
                    // the card closes from its own button.
                    {
                      left: "50%",
                      transform: "translateX(-50%)",
                      top: 8,
                    }
                  : {
                      // Centered on the cursor, clamped to the viewport (392px
                      // card); narrower than the card, pin to the left edge.
                      left: Math.min(
                        Math.max(hover.x - 196, 6),
                        Math.max(6, vw - 398),
                      ),
                      top: below ? hover.y + 16 : hover.y - 12,
                      transform: below ? undefined : "translateY(-100%)",
                    }
              }
            >
              <TokenHoverCard
                token={hover.t}
                href={isTouch ? nftExplorerUrl(hover.t.tokenId) : undefined}
                onClose={isTouch ? () => setHover(null) : undefined}
                {...(isTouch
                  ? {
                      onPrev: step(-1),
                      onNext: step(1),
                      place: { index: at + 1, total: tokens.length },
                    }
                  : {})}
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/** Per-tier config as a chip that reveals the full table on hover. The table
 * lists each tier's floor value, minimum count, and target share (the config
 * fields floorValueInUsd / minNumberOfTokens /
 * targetNumberOfTokensPercentage); see whitepaper §5.1. */
function TierConfigChip({
  tiers,
}: {
  tiers: NonNullable<SetTask["config"]>["tiers"];
}) {
  const sorted = [...tiers].sort((a, b) => b.floorValueInUsd - a.floorValueInUsd);
  // API-served packs carry a display name per tier; the demo fixtures don't.
  const hasNames = sorted.some((t) => t.name);
  return (
    <span className="group relative inline-flex cursor-help items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5">
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: "#FFC800" }}
      />
      <span className="font-body text-[11px] text-muted">tiers</span>
      <span className="font-mono-num text-[12px]">
        {sorted.map((t) => t.tier.toUpperCase()).join(" · ")}
      </span>

      {/* hover card — the full per-tier table */}
      <span
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden max-w-[calc(100vw-2rem)] w-max rounded-md border border-hairline p-3 opacity-0 shadow-card transition-all duration-150 group-hover:block group-hover:opacity-100 group-hover:delay-150"
        style={{ background: "#1C1C20" }}
        role="tooltip"
      >
        <table className="border-collapse text-[12px] text-white">
          <thead>
            <tr>
              {[
                "tier",
                ...(hasNames ? ["name"] : []),
                "min value",
                "min tokens",
                "target %",
              ].map((h) => (
                <th
                  key={h}
                  className="border border-white/15 px-2.5 py-1 text-left font-body font-semibold text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.tier}>
                <td
                  className="border border-white/15 px-2.5 py-1 font-mono-num font-bold"
                  style={{ color: TIER_COLORS[t.tier] }}
                >
                  {t.tier.toUpperCase()}
                </td>
                {hasNames && (
                  <td className="border border-white/15 px-2.5 py-1 font-body">
                    {t.name ?? "—"}
                  </td>
                )}
                <td className="border border-white/15 px-2.5 py-1 font-mono-num">
                  {fmtUsd(t.floorValueInUsd)}
                </td>
                <td className="border border-white/15 px-2.5 py-1 font-mono-num">
                  {t.minNumberOfTokens}
                </td>
                <td className="border border-white/15 px-2.5 py-1 font-mono-num">
                  {t.targetNumberOfTokensPercentage}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <span className="mt-2 block font-body text-[10.5px] leading-snug text-muted">
          Config fields floorValueInUsd · minNumberOfTokens ·
          targetNumberOfTokensPercentage. See whitepaper §5.1 · published
          construction constraints.
        </span>
      </span>
    </span>
  );
}

/**
 * Attempts — one expandable row per attempt (no Re-run button). Each row shows
 * where it started in the rng stream, the exact draws it consumed, the token
 * ids it selected (for failed attempts too), and its result. All of it is
 * recomputed by replaying the one β-seeded stream, so offsets accumulate:
 * attempt k starts after every draw its predecessors used, never back at 0.
 * The winning attempt shows the full accepted set + its Merkle root.
 */
function AttemptLog({ task }: { task: SetTask }) {
  const scope = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  // The attempt just expanded — drives the same height-grow reveal the Sets and
  // task rows use. Reset to null on collapse so reopening the same row re-fires.
  const [lastOpened, setLastOpened] = useState<number | null>(null);

  const { vrf, inputTokens: pool, config } = task;

  // Replay the whole run to recover each attempt's picks, rng offset, and the
  // draws it consumed. Possible whenever the proof + pool + config are present
  // AND this build carries the algorithm the record was formed with.
  const selectFn = replayAlgoFor(task.algoUsed);
  const run = useMemo(
    () =>
      vrf && pool && config && selectFn
        ? replayRun(vrf.randomness, pool, config, selectFn)
        : null,
    [vrf, pool, config, selectFn],
  );

  // Silent cross-check (doc §6.5): the replay must reproduce the recorded
  // attempt count, outcomes, and per-attempt EV / draw usage. A mismatch
  // means the record or the replay stack diverged — a serious pipeline
  // issue, logged for investigation. Never rendered: the page only displays
  // what it recomputes itself.
  useEffect(() => {
    if (!run) return;
    const issues: string[] = [];
    if (run.attempts.length !== task.attempts.length)
      issues.push(
        `attempt count: replayed ${run.attempts.length}, recorded ${task.attempts.length}`,
      );
    run.attempts.forEach((a, i) => {
      const rec = task.attempts[i];
      if (!rec) return;
      if (rec.outcome !== a.outcome)
        issues.push(
          `attempt ${i + 1} outcome: replayed ${a.outcome}, recorded ${rec.outcome}`,
        );
      const m = rec.recorded;
      if (!m) return;
      if (m.ev !== null && m.ev !== a.ev)
        issues.push(`attempt ${i + 1} EV: replayed ${a.ev}, recorded ${m.ev}`);
      if (m.drawStart !== a.drawStart)
        issues.push(
          `attempt ${i + 1} drawStart: replayed ${a.drawStart}, recorded ${m.drawStart}`,
        );
      if (m.drawsUsed !== a.drawsUsed)
        issues.push(
          `attempt ${i + 1} drawsUsed: replayed ${a.drawsUsed}, recorded ${m.drawsUsed}`,
        );
    });
    if (issues.length > 0)
      console.warn(
        `[verify] replay/record mismatch — pack ${task.packId ?? "?"}, task ${
          task.taskId ?? task.id
        }:\n  ${issues.join("\n  ")}`,
      );
  }, [run, task]);

  useGSAP(
    () => {
      gsap.fromTo(
        "[data-attempt-row]",
        { autoAlpha: 0, x: -14 },
        { autoAlpha: 1, x: 0, stagger: 0.08, duration: 0.22, ease: "power2.out" },
      );
    },
    { scope },
  );

  // Expand reveal — grow the newly opened attempt's body from 0 height, matching
  // the Sets and task rows. Collapse is instant (the body unmounts).
  useGSAP(
    () => {
      if (lastOpened === null) return;
      const body = scope.current?.querySelector(
        `[data-attempt-body="${lastOpened}"]`,
      );
      if (body) {
        gsap.fromTo(
          body,
          { height: 0, autoAlpha: 0, overflow: "hidden" },
          {
            height: "auto",
            autoAlpha: 1,
            duration: 0.4,
            ease: "power2.inOut",
            clearProps: "height,overflow",
          },
        );
      }
    },
    { scope, dependencies: [lastOpened] },
  );

  const toggle = (i: number) => {
    const willOpen = !open.has(i);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    setLastOpened(willOpen ? i : null);
  };

  const rows: (SelectionAttempt<TaskToken> | SetTask["attempts"][number])[] =
    run ? run.attempts : task.attempts;
  const poolCount = pool?.length ?? 0;

  return (
    <div ref={scope}>
      <div className="mb-2 flex items-center justify-between gap-3 font-mono-num text-[11px] text-muted">
        <span>
          {rows.length} attempt{rows.length === 1 ? "" : "s"} · first → last
        </span>
        <span className="flex items-center gap-3">
          {run === null && (
            <span className="text-loss/80">
              {selectFn === null
                ? `this build cannot replay “${task.algoUsed}” — update the verifier`
                : "no proof persisted — details unavailable"}
            </span>
          )}
          <button
            onClick={() => {
              setOpen(new Set());
              setLastOpened(null);
            }}
            disabled={open.size === 0}
            className="btn-ghost h-7 px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Collapse All
          </button>
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((a, i) => {
          const ok = a.outcome === "success";
          const rep = run ? (a as SelectionAttempt<TaskToken>) : null;
          const isOpen = open.has(i);
          const isWinner = run !== null && i === run.winnerIndex;
          return (
            <li
              key={i}
              data-attempt-row
              className={`rounded-md border ${
                ok ? "border-gain/40 bg-surface" : "border-hairline bg-surface/80"
              }`}
            >
              <button
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-left"
              >
                <span className="font-display text-[12px] font-semibold">
                  Attempt {i + 1}
                </span>
                <span className={`text-[11px] ${ok ? "text-gain" : "text-loss"}`}>
                  {ok ? "accepted ✓" : `${a.outcome} ✗`}
                </span>
                {rep && (
                  <span className="font-mono-num text-[10.5px] text-muted">
                    starts at draw #{rep.drawStart} · {rep.picks.length} cards · EV {fmtUsd(rep.ev)}
                  </span>
                )}
                <span
                  className={`ml-auto font-body text-[11px] text-muted transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                >
                  ▼
                </span>
              </button>

              {isOpen && (
                <div data-attempt-body={i}>
                <div className="flex flex-col gap-2.5 border-t border-hairline p-2.5">
                  {rep && (
                    <>
                      {/* INPUT — a labeled, clickable pointer to the shared
                          Config & input section (same pool for every attempt) */}
                      <div>
                        <p className="mb-1 font-display text-[11px] font-semibold text-muted">
                          Input{" "}
                          <span className="font-body font-normal">
                            (the candidate pool + config it ran on)
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => scrollToConfig(task.id)}
                            title="Jump to the Config & input section"
                            className="group inline-flex items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5 transition-colors hover:border-white/40"
                          >
                            <span
                              className="h-[7px] w-[7px] shrink-0 rounded-full"
                              style={{ background: "#FFC800" }}
                            />
                            <span className="font-body text-[11px] text-muted">
                              input
                            </span>
                            <span className="font-mono-num text-[12px] underline decoration-dotted decoration-1 underline-offset-[3px] group-hover:decoration-2">
                              Config &amp; input ({poolCount}) ↑
                            </span>
                          </button>
                          <span className="inline-flex items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5">
                            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-white" />
                            <span className="font-body text-[11px] text-muted">
                              rng offset
                            </span>
                            <span className="font-mono-num text-[12px]">
                              draw #{rep.drawStart}
                            </span>
                          </span>
                        </div>
                      </div>

                      {/* DRAWS — the random numbers this attempt consumed */}
                      {run && rep.drawsUsed > 0 && (
                        <div>
                          <p className="mb-1 font-display text-[11px] font-semibold text-muted">
                            Draws{" "}
                            <span className="font-body font-normal">
                              (the random numbers this attempt used)
                            </span>
                          </p>
                          <DrawTable
                            draws={run.draws.slice(
                              rep.drawStart,
                              rep.drawStart + rep.drawsUsed,
                            )}
                            startIndex={rep.drawStart}
                          />
                        </div>
                      )}

                      {/* OUTPUT — the winner shows the full accepted set + root */}
                      <div>
                        <p className="mb-1 font-display text-[11px] font-semibold text-muted">
                          Output{" "}
                          <span className="font-body font-normal">
                            (the token ids it selected{ok ? "" : ", though it was rejected"})
                          </span>
                        </p>
                        {isWinner && task.output?.tokens && vrf ? (
                          <OutputDetail
                            task={task}
                            output={{ ...task.output, tokens: task.output.tokens }}
                            vrf={vrf}
                          />
                        ) : (
                          <TokenDots
                            title={`${rep.picks.length} tokens · EV ${fmtUsd(rep.ev)}. Hover any cell for the token id + value.`}
                            tokens={rep.picks}
                          />
                        )}
                      </div>
                    </>
                  )}

                  {/* RESULT */}
                  <div
                    className={`rounded-md border p-2.5 ${
                      ok ? "border-gain/50 bg-surface" : "border-loss/60 bg-loss/10"
                    }`}
                  >
                    <p
                      className={`font-display text-[12px] font-semibold ${
                        ok ? "text-gain" : "text-loss"
                      }`}
                    >
                      {ok
                        ? `✓ EV ${fmtUsd(rep?.ev ?? task.output?.expectedValueInUsd ?? 0)} in band, every tier quota met — accepted`
                        : `✗ ${a.detail ?? "rejected"}`}
                    </p>
                  </div>
                </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Draw-log rows — the rng draws an attempt consumed, at their stream indices. */
function DrawTable({
  draws,
  startIndex,
}: {
  draws: RngDraw[];
  startIndex: number;
}) {
  return (
    <div className="scroll-thin max-h-[220px] overflow-y-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {["rng #", "SHA-512(β ‖ i)", "value = low53 ÷ 2⁵³"].map((h) => (
              <th
                key={h}
                className="sticky top-0 z-10 border border-hairline bg-surface px-2.5 py-1.5 text-left font-body font-semibold text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draws.map((d, k) => (
            <tr key={k}>
              <td className="border border-hairline px-2.5 py-1.5 font-mono-num text-muted">
                {startIndex + k}
              </td>
              <td
                className="border border-hairline px-2.5 py-1.5 font-mono-num"
                title={d.word}
              >
                {truncateHex(d.word, 8)}
              </td>
              <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                {d.value.toFixed(12)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The accepted set — tier distribution, lineup dots, and the Merkle root.
 * Rendered inside the winning attempt. Published verifier values live in the
 * Verify section, not here. */
function OutputDetail({
  task,
  output,
  vrf,
}: {
  task: SetTask;
  output: NonNullable<SetTask["output"]> & { tokens: TaskToken[] };
  vrf: NonNullable<SetTask["vrf"]>;
}) {
  // Availability root over the accepted lineup — recomputed in-browser from
  // the same (tokenId, salt) leaves the Sets tab publishes, so it matches
  // that set's published root exactly.
  const merkleRoot = useMemo(
    () =>
      recomputeRoot(
        output.tokens.map((t) => ({
          tokenId: t.tokenId,
          salt: t.merkleSalt ?? leafSalt(vrf.seed, t.tokenId),
          valueInUsd: t.valueInUsd,
        })),
      ).root,
    [output.tokens, vrf.seed],
  );

  // Silent cross-check: the operator's served root must equal the in-browser
  // recomputation. Logged for investigation, never rendered as truth.
  useEffect(() => {
    const served = output.publishedMerkleRoot;
    if (served && served.toLowerCase() !== merkleRoot.toLowerCase())
      console.warn(
        `[verify] merkle root mismatch — pack ${task.packId ?? "?"}, task ${
          task.taskId ?? task.id
        }: recomputed ${merkleRoot}, served ${served}`,
      );
  }, [output.publishedMerkleRoot, merkleRoot, task]);

  const tierRows = (task.config?.tiers ?? []).map((t, i, all) => {
    const higher = all[i - 1]; // tiers sorted highest floor first
    const picked = output.tokens.filter((x) => x.tier === t.tier);
    const avg =
      picked.length === 0
        ? 0
        : Math.round(picked.reduce((s, x) => s + x.valueInUsd, 0) / picked.length);
    return {
      tier: t.tier,
      range: higher
        ? `${fmtUsd(t.floorValueInUsd)}–${fmtUsd(higher.floorValueInUsd - 1)}`
        : `${fmtUsd(t.floorValueInUsd)}+`,
      targetPct: t.targetNumberOfTokensPercentage,
      min: t.minNumberOfTokens,
      picked: picked.length,
      poolPct:
        output.tokens.length === 0
          ? 0
          : Math.round((picked.length / output.tokens.length) * 100),
      avgEv: avg,
    };
  });

  return (
    <div className="flex flex-col gap-3">
      {/* tier distribution */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {["tier", "range", "tgt %", "min", "picked", "pool %", "avg EV"].map(
                (h) => (
                  <th
                    key={h}
                    className="border border-hairline bg-surface px-2.5 py-1.5 text-left font-body font-semibold text-muted"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {tierRows.map((r) => (
              <tr key={r.tier}>
                <td
                  className="border border-hairline px-2.5 py-1.5 font-mono-num font-bold"
                  style={{ color: TIER_COLORS[r.tier] }}
                >
                  {r.tier.toUpperCase()}
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {r.range}
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {r.targetPct}%
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {r.min}
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {r.picked}
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {r.poolPct}%
                </td>
                <td className="border border-hairline px-2.5 py-1.5 font-mono-num">
                  {fmtUsd(r.avgEv)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TokenDots
        title={`selected tokens (${output.tokens.length}) · EV ${fmtUsd(output.expectedValueInUsd)}. Hover for detail.`}
        tokens={output.tokens}
      />

      {/* availability root → jumps to this set on the Sets tab */}
      <Link
        href={
          task.packId
            ? `/sets?pack=${task.packId}&set=${task.setId}`
            : `/sets?set=${task.setId}`
        }
        className="inline-block self-start font-mono-num text-[12.5px] text-white underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:decoration-2"
        title={merkleRoot}
      >
        Set #{task.setId} Merkle Root {truncateHex(merkleRoot, 6)}
      </Link>
    </div>
  );
}

/** pk / α / π / β — exactly what a verifier gets; no secret key. */
function PublishedRows({ vrf }: { vrf: NonNullable<SetTask["vrf"]> }) {
  const rows: [string, string, string][] = [
    [
      "public key",
      vrf.publicKeyHex,
      "Operator's published ECVRF verification key.",
    ],
    [
      "seed α",
      vrf.seed,
      "The VRF input the proof was issued over — keccak256(tag ‖ blockHash ‖ blockNumber ‖ packId ‖ setId), recomputable from public data.",
    ],
    ["proof π", vrf.proof, "The ECVRF proof (80 bytes) over α."],
  ];
  return (
    <div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([k, v, hint]) => (
          <div key={k} className="grid grid-cols-[92px_1fr] items-center gap-3">
            <span className="font-body text-[12px] text-muted">{k}</span>
            <span
              title={hint}
              className="break-all rounded-md border border-hairline bg-surface px-2.5 py-1.5 font-mono-num text-[11px]"
            >
              {v}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 font-body text-[11px] text-muted">
        The secret key stays with the operator. These values are enough to
        check the run. β itself is never served; the verify step recomputes
        it from π.
      </p>
    </div>
  );
}

interface VerifyResult {
  beta: Hex | null;
  betaMatches: boolean;
  /** Attempts the replayed retry loop ran. */
  attemptsReplayed: number;
  drawCount: number;
  packMatch: boolean;
}

/**
 * Verify — the proof check for the whole run: ECVRF_verify(PK, α, π) recomputes
 * β from the published proof, and (for a successful run) the set is rebuilt from
 * that β and compared card for card. This is one check per task; the individual
 * random draws each attempt used are shown per attempt above.
 */
function VerifyBody({
  task,
  vrf,
  pool,
  config,
}: {
  task: SetTask;
  vrf: NonNullable<SetTask["vrf"]>;
  pool: TaskToken[];
  config: NonNullable<SetTask["config"]>;
}) {
  const selectFn = replayAlgoFor(task.algoUsed);
  const result = useMemo<VerifyResult>(() => {
    // β = ECVRF_verify(PK, α, π) — RFC 9381 §5.3, the production check.
    const beta = ecvrfVerifyHex(vrf.publicKeyHex, vrf.seed, vrf.proof);
    const betaMatches =
      beta !== null && beta.toLowerCase() === vrf.randomness.toLowerCase();
    // Only replay with the algorithm the record names — running a different
    // one would "verify" against the wrong math and report a false mismatch.
    const replay =
      beta && selectFn ? replayRun(beta, pool, config, selectFn) : null;
    const winner =
      replay && replay.winnerIndex >= 0
        ? replay.attempts[replay.winnerIndex]!
        : null;
    const picks = winner?.picks ?? [];
    const recordedTokens = task.output?.tokens;
    const packMatch =
      recordedTokens !== undefined &&
      winner !== null &&
      picks.length === recordedTokens.length &&
      picks.every((p, i) => p.tokenId === recordedTokens[i]!.tokenId);
    return {
      beta,
      betaMatches,
      attemptsReplayed: replay?.attempts.length ?? 0,
      drawCount: replay?.draws.length ?? 0,
      packMatch,
    };
  }, [vrf, pool, config, task.output, selectFn]);

  return (
    <div className="flex flex-col gap-3">
      {result.beta === null ? (
        <div className="rounded-md border border-loss/60 bg-loss/10 p-3">
          <p className="font-display text-[12px] font-semibold text-loss">
            ✗ Proof invalid: π does not verify against the public key
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="ECVRF"
            value="verify(pk, α, π) ✓"
            source="local"
            detail="The proof π checks out against the operator's public key (RFC 9381), run in your browser."
          />
          <DataChip
            label="β derived"
            value={truncateHex(result.beta, 5)}
            full={result.beta}
            source="local"
            detail={`Recomputed from π in your browser. ${result.betaMatches ? "It matches the value the run recorded." : "It DOES NOT match the recorded value."}`}
          />
          {selectFn !== null && (
            <DataChip
              label="attempts replayed"
              value={String(result.attemptsReplayed)}
              source="local"
              detail="How many algorithm attempts the replayed loop ran — must equal the recorded attempt count."
            />
          )}
          {selectFn !== null && (
            <DataChip
              label="rng() calls"
              value={String(result.drawCount)}
              source="local"
              detail="Total random numbers the whole run consumed across all attempts."
            />
          )}
          {selectFn !== null && task.output?.tokens && (
            <DataChip
              label="reconstructed set"
              value={
                result.packMatch
                  ? `identical ✓ (${task.output.tokens.length} cards)`
                  : "differs ✗"
              }
              source="local"
              detail="The lineup rebuilt from β alone, compared card by card with the recorded set."
            />
          )}
        </div>
      )}

      {selectFn === null && (
        <div className="rounded-md border border-message/60 bg-message/10 p-3">
          <p className="font-display text-[12px] font-semibold text-message">
            This build cannot replay “{task.algoUsed}” — the ECVRF proof still
            verifies above, but the lineup was not reconstructed. Update the
            verifier to a build that carries this algorithm.
          </p>
        </div>
      )}

      {result.beta !== null &&
        selectFn !== null &&
        (!result.betaMatches || (task.output?.tokens && !result.packMatch)) && (
          <div className="rounded-md border border-loss/60 bg-loss/10 p-3">
            <p className="font-display text-[12px] font-semibold text-loss">
              ✗ Verification mismatch: the recorded run diverges from the proof
            </p>
          </div>
        )}

      <div className="border-t border-hairline pt-3">
        <p className="mb-2 font-display text-[12px] font-semibold text-muted">
          Published values{" "}
          <span className="font-body text-[11px] font-normal">
            (everything a verifier needs)
          </span>
        </p>
        <PublishedRows vrf={vrf} />
      </div>
    </div>
  );
}
