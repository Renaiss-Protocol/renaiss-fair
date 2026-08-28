"use client";

import { useMemo, useRef, useState } from "react";
import { gsap, useGSAP } from "./gsap";
import type { SetSummary } from "@/lib/api/types";
import { SetProvenance } from "./set-provenance";
import { SetDetailBody } from "./set-detail";
import { pageWindow } from "./task-rows";
import { Tag } from "./tag";

export const SETS_PAGE_SIZE = 10;
const PAGE_SIZE = SETS_PAGE_SIZE;

/**
 * Server-wired pagination (API mode): the parent knows the true page count
 * from /verify/sets' `total` and fetches pages on demand — this component
 * just reports clicks and shows a loading body for pages whose rows are
 * still in flight. Omitted (mock mode) → self-contained paging.
 */
export interface SetRowsPagination {
  page: number;
  pageCount: number;
  onGoto: (page: number) => void;
  /** The current page's rows are still fetching. */
  loading?: boolean;
}

const STATUS_TONE = {
  completed: "purple",
  active: "gain",
  upcoming: "neutral",
} as const;

/** Lock badge for a set that hasn't sold out yet. Live and upcoming sets keep
 *  their lineup and draw history sealed; the row unseals (and becomes
 *  expandable) once every card is sold. Hover shows why it's locked. */
function SealedBadge() {
  return (
    <span
      title="Sealed until every card is sold — the full lineup and draw history unseal here once the set sells out."
      className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-hairline bg-raised px-3 py-1 font-body text-[12px] font-semibold text-muted"
    >
      🔒 Sealed
    </span>
  );
}

/**
 * Version B: vertical rows, set id DESC, collapsed by default, paginated.
 * Always browsable — the target props are only set once a tx lookup succeeds,
 * at which point we jump to the target's page, expand the row, and scroll to it.
 */
export function SetRows({
  sets,
  targetSetId,
  expandedId,
  onToggle,
  packId,
  onChainPackId,
  targetCheckoutId,
  vrfPublicKeyHex,
  pagination,
}: {
  /** Every set (mock mode) or just the current page's rows (API mode). */
  sets: SetSummary[];
  /** Set once a tx lookup succeeded and landed in one of these sets. */
  targetSetId?: number;
  expandedId: number | null;
  onToggle: (setId: number | null) => void;
  packId: string;
  /** bytes32 TVM pack id — part of the VRF seed preimage. */
  onChainPackId: string;
  targetCheckoutId?: number;
  /** Fallback key for draws without their own publicKeyHex (mock mode). */
  vrfPublicKeyHex?: string | undefined;
  pagination?: SetRowsPagination;
}) {
  const scope = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...sets].sort((a, b) => b.setId - a.setId),
    [sets],
  );
  // Land on the focused row's page: a found tx wins, else a deep-linked
  // expanded row (/sets?set=N), else the first page. (Self-managed mode
  // only — the API-mode parent owns the page and its own deep-linking.)
  const focusId = targetSetId ?? expandedId ?? undefined;
  const targetPage =
    focusId === undefined
      ? 0
      : Math.floor(
          sorted.findIndex((s) => s.setId === focusId) / PAGE_SIZE,
        );
  const [ownPage, setOwnPage] = useState(Math.max(0, targetPage));
  const page = pagination ? pagination.page : ownPage;
  const pageCount = pagination
    ? Math.max(1, pagination.pageCount)
    : Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Controlled mode hands over the page's rows ready-sliced.
  const rows = pagination
    ? sorted
    : sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const loading = pagination?.loading ?? false;

  // Entrance only — any scroll to the target row is user-driven.
  useGSAP(
    () => {
      gsap.fromTo(
        "[data-row]",
        { y: 18, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.4, ease: "power2.out" },
      );
    },
    { scope, dependencies: [page] },
  );

  // Expand/collapse: grow the newly expanded row's body from 0 height.
  useGSAP(
    () => {
      if (expandedId === null) return;
      const body = scope.current?.querySelector(`[data-row-body="${expandedId}"]`);
      if (body) {
        // Clip only while the height animates — a persistent overflow-hidden
        // would clip hover tooltips (DataChip cards) at the row's top edge.
        gsap.fromTo(
          body,
          { height: 0, autoAlpha: 0, overflow: "hidden" },
          {
            height: "auto",
            autoAlpha: 1,
            duration: 0.45,
            ease: "power2.inOut",
            clearProps: "height,overflow", // async content (lineup fetch) can grow it after
          },
        );
      }
    },
    { scope, dependencies: [expandedId] },
  );

  const goto = (p: number) => {
    if (pagination) pagination.onGoto(p);
    else setOwnPage(p);
    onToggle(null); // rows are collapsed by default on a fresh page
  };

  return (
    <section ref={scope} className="mx-auto mt-8 max-w-5xl px-6 pb-20">
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="animate-pulse rounded-lg border border-hairline bg-surface p-10 text-center font-body text-[13px] text-muted">
            Loading sets…
          </div>
        )}
        {!loading &&
        rows.map((s) => {
          const isTarget = s.setId === targetSetId;
          // Live and upcoming sets are still sealed: they expand to the build
          // genesis (how the lineup was made) but never reveal the lineup or its
          // size. A fully-ripped set additionally opens its lineup and replay.
          const sealed = s.status !== "completed";
          const isOpen = s.setId === expandedId;
          const headerContent = (
            <>
              <span className="font-display text-base font-semibold">
                Set #{s.setId}
              </span>
              <Tag tone={STATUS_TONE[s.status]} dot>
                {s.status === "completed"
                  ? "Ripped Out"
                  : s.status === "active"
                    ? "Live"
                    : "Upcoming"}
              </Tag>
              {isTarget && (
                <span className="font-display text-[13px] font-bold text-white">
                  Your rip landed here
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                {/* A completed set is fully ripped, so we show just the total
                    card count; live/upcoming sets show a state badge instead. */}
                {s.status === "completed" ? (
                  <span className="font-mono-num text-[13px] text-muted">
                    {s.cardCount} ripped
                  </span>
                ) : s.status === "active" ? (
                  <>
                    {/* "Ripping now" is hidden on mobile, where the narrow row
                        can't fit two pills; the Sealed badge stays on both. */}
                    <span
                      className="hidden items-center gap-1.5 rounded-full px-3 py-1 font-body text-[12px] font-semibold sm:inline-flex"
                      style={{ background: "rgba(120,255,108,.16)", color: "var(--gain)" }}
                    >
                      <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-current" />
                      Ripping now
                    </span>
                    <SealedBadge />
                  </>
                ) : (
                  <SealedBadge />
                )}
                <span
                  className={`font-body text-xs text-muted transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                >
                  ▼
                </span>
              </span>
            </>
          );
          return (
            <div
              key={s.setId}
              data-row={s.setId}
              className={`rounded-lg border ${
                isTarget ? "border-white/40" : "border-hairline"
              } bg-surface`}
            >
              <button
                onClick={() => onToggle(isOpen ? null : s.setId)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 p-4 text-left"
              >
                {headerContent}
              </button>

              {isOpen && (
                <div data-row-body={s.setId}>
                  <div className="border-t border-hairline p-4">
                    {isTarget && (
                      <div className="mb-3">
                        <Tag tone="solid">Your Rip</Tag>
                      </div>
                    )}
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
                        targetCheckoutId={isTarget ? targetCheckoutId : undefined}
                        vrfPublicKeyHex={vrfPublicKeyHex}
                      />
                    )}
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
              className={`h-8 w-8 rounded-full border font-mono-num text-[13px] ${
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
