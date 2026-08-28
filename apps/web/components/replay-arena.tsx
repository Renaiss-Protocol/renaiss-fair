"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap, useGSAP } from "./gsap";
import type { DrawWitness, LineupCard } from "@/lib/api/types";
import { useReplay } from "@/lib/use-replay";
import { nftExplorerUrl } from "@/lib/config";
import { TIER_COLORS, truncateHex } from "@/lib/format";
import { CardFace } from "./card-face";
import { Tag } from "./tag";
import { TokenHoverCard } from "./token-card";
import { useIsTouch } from "@/lib/use-touch";
import { useDotScrub } from "@/lib/use-dot-scrub";

const CELL = 12;
const CGAP = 3;
/** Overlay card size for the finale. */
const OW = 132;
const OH = 178;
/** Seconds between draw beats at 1× — every draw plays, no fast-forward. */
const STEP_SPACING = 0.24;
/** Extra time the target draw's zoom finale takes over a normal beat. */
const FINALE_EXTRA = 2.4;
/** Speed cycle — 5× default so a full set replays in ~20s. */
const SPEEDS = [5, 10, 1] as const;

const cellColor = (tier: string): string => `${TIER_COLORS[tier]}59`;

/**
 * Arena mode — replay UI for large sets (hundreds–1k cards).
 *
 * A full card grid can't scale, so the lineup renders as a tier-colored dot
 * matrix (one cell per card, eligible order) spanning the full panel width.
 * Every draw plays in sequence — first to last, no fast-forward — each one
 * dimming its cell and appending to the log. The log itself is a single
 * live ticker line under the stage; hovering it (or tapping on touch)
 * expands the full scrollable draw log. The user's card, when present,
 * zooms out of the matrix onto center stage.
 */
export function ReplayArena({
  lineup,
  draws,
  targetCheckoutId,
  vrfPublicKeyHex,
  onChainPackId,
}: {
  lineup: LineupCard[];
  draws: DrawWitness[];
  targetCheckoutId?: number | undefined;
  /** Fallback key for draws without their own publicKeyHex (mock mode). */
  vrfPublicKeyHex?: string | undefined;
  /** bytes32 TVM pack id — part of the VRF seed preimage. */
  onChainPackId: string;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const logListRef = useRef<HTMLOListElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const lastRevealedRef = useRef<number | null>(null);

  const [width, setWidth] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const isTouch = useIsTouch();
  // Dragging across the matrix walks the card from one token to the next.
  const scrub = useDotScrub({
    enabled: isTouch,
    onPick: (key, x, y) => {
      setHovered(key);
      setHoverXY({ x, y });
    },
  });
  const [hovered, setHovered] = useState<string | null>(null);
  // Cursor position (viewport coords) — the hover card renders in a fixed
  // portal anchored to it, exactly like the Packing tab's token grids.
  const [hoverXY, setHoverXY] = useState<{ x: number; y: number } | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const replay = useReplay(
    vrfPublicKeyHex,
    onChainPackId,
    lineup,
    draws,
    targetCheckoutId,
  );
  const cardByToken = useMemo(
    () => new Map(lineup.map((c) => [c.tokenId, c])),
    [lineup],
  );

  const steps = replay?.steps ?? [];
  const initialOrder = replay?.initialOrder ?? [];
  const targetStep = steps.find((s) => s.isTarget);
  const targetCard = targetStep
    ? cardByToken.get(targetStep.pickedTokenId)
    : undefined;

  useEffect(() => {
    if (replay) setWidth(stageRef.current?.clientWidth ?? 0);
  }, [replay]);

  const FINALE_H = steps.length === 0 ? 0 : targetStep ? OH + 40 : 64;
  const cols = width > 0 ? Math.max(10, Math.floor((width + CGAP) / (CELL + CGAP))) : 1;
  const rows = Math.ceil(initialOrder.length / cols);
  const stageH = FINALE_H + rows * (CELL + CGAP) + 16;
  const slot = (i: number) => ({
    x: (i % cols) * (CELL + CGAP),
    y: FINALE_H + Math.floor(i / cols) * (CELL + CGAP),
  });
  const indexByToken = useMemo(() => {
    const m = new Map<string, number>();
    initialOrder.forEach((tok, i) => m.set(tok, i));
    return m;
  }, [initialOrder]);

  /** Keep the newest revealed row at the bottom of the log viewport. */
  const followLog = (checkoutId: number) => {
    lastRevealedRef.current = checkoutId;
    const list = logListRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-log-row="${checkoutId}"]`);
    if (row)
      list.scrollTop = Math.max(0, row.offsetTop + row.offsetHeight - list.clientHeight);
  };

  useEffect(() => {
    if (logOpen && lastRevealedRef.current !== null)
      followLog(lastRevealedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logOpen]);

  // Entrance + initial hidden states only. The replay timeline itself is
  // built lazily on the first Play click (buildTimeline below): a timeline
  // assembled inside this effect could be reverted/never ticked between
  // renders, which left "Replay All Draws" doing nothing on live sets.
  useGSAP(
    () => {
      if (!replay || width === 0 || !stageRef.current) return;
      tlRef.current = null; // stale timeline targets the pre-resize layout

      gsap.fromTo(
        "[data-cell]",
        { autoAlpha: 0, scale: 0.4 },
        {
          autoAlpha: 1,
          scale: 1,
          duration: 0.3,
          ease: "power2.out",
          stagger: { each: 0.0012, grid: [rows, cols], from: "start" },
        },
      );

      if (steps.length === 0) return;
      gsap.set("[data-log], [data-verdict], [data-overlay-card]", {
        autoAlpha: 0,
      });
      gsap.set("[data-log-row]", { autoAlpha: 0, x: -14 });
    },
    { scope, dependencies: [replay, width], revertOnUpdate: true },
  );

  const { contextSafe } = useGSAP({ scope });

  const buildTimeline = contextSafe(() => {
    const cellEl = (tokenId: string) =>
      stageRef.current!.querySelector<HTMLElement>(`[data-cell="${tokenId}"]`)!;
    const ticker = scope.current?.querySelector<HTMLElement>("[data-ticker]");
    const total = steps.length;

    const tl = gsap.timeline({
      paused: true,
      defaults: { ease: "power2.out" },
      onComplete: () => setDone(true),
    });

    // reset everything the replay touches, then float the ticker in
    tl.set("[data-log-row]", { autoAlpha: 0, x: -14 });
    tl.set("[data-verdict], [data-overlay-card]", { autoAlpha: 0 });
    // Reset cells to their tier color explicitly — clearProps would wipe the
    // React-inlined backgroundColor and leave the matrix transparent.
    tl.set("[data-cell]", {
      autoAlpha: 1,
      scale: 1,
      zIndex: "auto",
      backgroundColor: (_i: number, el: EventTarget) => {
        const tok = (el as HTMLElement).dataset["cell"]!;
        const card = cardByToken.get(tok);
        return card ? cellColor(card.tier) : "rgba(255,255,255,.3)";
      },
    });
    tl.to("[data-log]", { autoAlpha: 1, y: 0, duration: 0.3 });

    const consumed = new Set<string>();
    let at = 0.35;

    steps.forEach((step) => {
      const picked = cellEl(step.pickedTokenId);
      const card = cardByToken.get(step.pickedTokenId);
      const origin = card ? cellColor(card.tier) : "rgba(255,255,255,.3)";
      const ok = step.proofValid && step.betaMatches && step.matchesRecord;

      tl.to(
        `[data-log-row="${step.checkoutId}"]`,
        { autoAlpha: 1, x: 0, duration: 0.2 },
        at,
      );
      tl.call(
        () => {
          if (ticker)
            ticker.textContent = `Draw ${step.ordinal}/${total} · ${
              card?.name ?? step.pickedTokenId
            } · ${ok ? "π✓ β✓ ≡✓" : "VERIFY FAILED"}`;
          followLog(step.checkoutId);
        },
        undefined,
        at,
      );

      if (step.isTarget) {
        // the moment: scan ripple, the pick lights up, becomes a card,
        // and takes center stage
        const remaining = initialOrder.filter(
          (tok) => !consumed.has(tok) && tok !== step.pickedTokenId,
        );
        tl.to(
          remaining.map(cellEl),
          {
            keyframes: [
              { scale: 1.45, duration: 0.06 },
              { scale: 1, duration: 0.09 },
            ],
            stagger: { amount: 0.55, from: "random" },
          },
          at,
        );
        tl.set(picked, { zIndex: 10 }, at + 0.6);
        tl.to(
          picked,
          { scale: 2.4, backgroundColor: "#ffffff", duration: 0.22 },
          at + 0.6,
        );
        const i = indexByToken.get(step.pickedTokenId)!;
        const { x: cx, y: cy } = slot(i);
        tl.set(
          "[data-overlay-card]",
          {
            x: cx + CELL / 2 - OW / 2,
            y: cy + CELL / 2 - OH / 2,
            scale: 0.12,
            zIndex: 30,
          },
          at + 0.9,
        );
        tl.to("[data-overlay-card]", { autoAlpha: 1, duration: 0.15 }, at + 0.9);
        tl.to(picked, { autoAlpha: 0, duration: 0.15 }, at + 0.9);
        tl.to(
          "[data-overlay-card]",
          {
            x: (width - OW) / 2,
            y: (FINALE_H - OH) / 2,
            scale: 1,
            duration: 0.85,
            ease: "power3.inOut",
          },
          at + 1.05,
        );
        tl.to(remaining.map(cellEl), { autoAlpha: 0.3, duration: 0.45 }, at + 1.05);
        tl.to("[data-verdict]", { autoAlpha: 1, y: 0, duration: 0.4 }, at + 1.7);
        consumed.add(step.pickedTokenId);
        at += STEP_SPACING + FINALE_EXTRA;
      } else {
        tl.to(
          picked,
          {
            keyframes: [
              { scale: 1.9, backgroundColor: "#ffffff", duration: 0.09 },
              {
                scale: 0.65,
                autoAlpha: 0.16,
                backgroundColor: origin,
                duration: 0.16,
              },
            ],
          },
          at,
        );
        consumed.add(step.pickedTokenId);
        at += STEP_SPACING;
      }
    });

    if (!targetStep) {
      tl.to("[data-verdict]", { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.2);
    }

    return tl;
  });

  const play = contextSafe(() => {
    if (!tlRef.current) tlRef.current = buildTimeline() ?? null;
    const tl = tlRef.current;
    if (!tl) return;
    setPlaying(true);
    setDone(false);
    tl.timeScale(SPEEDS[speedIdx]!);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      tl.progress(1, false);
    } else {
      tl.restart();
    }
  });
  // suppressEvents=false so the ticker/log callbacks catch up to the end
  const skip = contextSafe(() => tlRef.current?.progress(1, false));
  const cycleSpeed = contextSafe(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      tlRef.current?.timeScale(SPEEDS[next]!);
      return next;
    });
  });

  if (!replay) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-hairline bg-surface">
        <span className="font-body text-[13px] text-muted">
          Verifying {draws.length} ECVRF proofs in your browser…
        </span>
      </div>
    );
  }

  const hoveredCard = hovered ? cardByToken.get(hovered) : undefined;
  // The hover card is ~450px tall with its slab render — flip below the
  // cursor whenever there isn't that much room above (same as Packing).
  const tooltipBelow = hoverXY !== null && hoverXY.y < 460;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  // The matrix's own order is the reading order the arrows follow.
  const at = hovered ? initialOrder.indexOf(hovered) : -1;
  const step = (by: number) => {
    const next = initialOrder[at + by];
    if (at < 0 || next === undefined) return null;
    return () => {
      setHovered(next);
      document
        .querySelector(`[data-cell="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: "end" });
    };
  };

  return (
    <div ref={scope}>
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {steps.length > 0 ? (
          <>
            <button onClick={play} className="btn-secondary h-10 px-6 text-sm">
              {playing ? "Replay Draws" : targetStep ? "Replay My Rip" : "Replay All Draws"}
            </button>
            {playing && !done && (
              <button onClick={skip} className="btn-ghost h-10 px-5 text-sm">
                Skip to Result
              </button>
            )}
            <button onClick={cycleSpeed} className="btn-ghost h-10 px-4 text-sm">
              {SPEEDS[speedIdx]}× Speed
            </button>
            <span className="font-body text-[13px] text-muted">
              {steps.length} draws ·{" "}
              {replay.allValid ? (
                <span className="text-gain">
                  all {steps.length} ECVRF proofs verified in your browser
                </span>
              ) : (
                <span className="text-loss">
                  verification FAILED — replay the draws to see which steps fail
                </span>
              )}
            </span>
          </>
        ) : (
          <Tag tone="neutral">No rips yet — lineup awaiting its first draw</Tag>
        )}
      </div>

      {/* the matrix stage — full width, frameless like the Packing tab's
          token grids so both tabs wrap the same number of dots per row */}
      <div
        ref={(node) => {
          // Two owners: stageRef measures the stage, the scrub listens on it.
          stageRef.current = node;
          scrub.ref(node);
        }}
        className="relative w-full overflow-hidden"
        style={{ height: stageH }}
      >
        {steps.length > 0 && (
          <div
            data-verdict
            className="absolute left-1/2 z-40 -translate-x-1/2 translate-y-2"
            style={{ top: targetStep ? FINALE_H - 26 : 14 }}
          >
            {targetStep && targetCard ? (
              <div
                className="rounded-full border border-white/40 bg-surface px-5 py-2 text-center"
                style={{ boxShadow: "0 0 26px rgba(255,255,255,.18)" }}
              >
                <span className="font-display text-sm font-bold">
                  Verified — {targetCard.name} is provably yours
                </span>
              </div>
            ) : (
              <div className="rounded-full border border-hairline bg-raised px-5 py-2">
                <span className="font-body text-[13px] text-muted">
                  Replay complete — every draw matches the record
                </span>
              </div>
            )}
          </div>
        )}
        {targetCard && (
          <div
            data-overlay-card
            className="absolute left-0 top-0 opacity-0"
            style={{ width: OW, height: OH }}
          >
            <CardFace card={targetCard} />
          </div>
        )}
        {width > 0 &&
          initialOrder.map((tokenId, i) => {
            const card = cardByToken.get(tokenId)!;
            const { x, y } = slot(i);
            return (
              <a
                key={tokenId}
                data-cell={tokenId}
                data-dot={tokenId}
                href={nftExplorerUrl(tokenId)}
                target="_blank"
                rel="noreferrer"
                aria-label={
                  isTouch
                    ? `Token ID ${tokenId} — show card`
                    : `Token ID ${tokenId} on BscScan`
                }
                onTouchEnd={(e) => {
                  // Straight off the touch: the click iOS synthesizes after a
                  // tap is swallowed when that tap also stops a coasting
                  // scroll, which ate the first tap every time.
                  if (!isTouch || scrub.tapGuarded()) return;
                  e.preventDefault();
                  const p = e.changedTouches[0];
                  setHovered(tokenId);
                  setHoverXY({ x: p?.clientX ?? 0, y: p?.clientY ?? 0 });
                  const el = e.currentTarget;
                  setTimeout(() => el.scrollIntoView({ block: "end" }), 0);
                }}
                onClick={(e) => {
                  // Touch has no hover, so the tap has to open the card rather
                  // than leave for the explorer — the card carries that link.
                  if (!isTouch) return;
                  // A drag's lift-off synthesizes a click; that is the tail of
                  // the scrub, not a new tap.
                  if (scrub.tapGuarded()) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  setHovered(tokenId);
                  setHoverXY({ x: e.clientX, y: e.clientY });
                  // The card pins to the top; bring the tapped square down
                  // into the strip left below it.
                  // Instant, and off a plain timer rather than rAF: both smooth
                  // scrolling and requestAnimationFrame are suspended in a
                  // backgrounded tab, and the reader must never be left looking
                  // at a card whose cell is off screen.
                  const el = e.currentTarget;
                  setTimeout(() => el.scrollIntoView({ block: "end" }), 0);
                }}
                onMouseEnter={(e) => {
                  if (isTouch) return;
                  setHovered(tokenId);
                  setHoverXY({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => {
                  if (isTouch) return;
                  setHovered((h) => (h === tokenId ? null : h));
                }}
                // The ring is a box-shadow on purpose: GSAP drives these
                // cells' scale, backgroundColor and opacity during the replay,
                // and a CSS transition on any of those would re-interpolate
                // every frame it writes. box-shadow is untouched by the tween,
                // so the two never meet.
                className="absolute rounded-[3px] opacity-0 transition-shadow hover:z-10 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.92)]"
                style={{
                  left: x,
                  top: y,
                  width: CELL,
                  height: CELL,
                  backgroundColor: cellColor(card.tier),
                  // Leaves the cell clear of the bottom edge (and the floating
                  // whitepaper button) when it is scrolled into view.
                  scrollMarginBottom: 96,
                  // A tapped cell stays ringed while its card is open, so the
                  // reader can see which square the card belongs to. Inline,
                  // because the non-hover Tailwind twin was never generated.
                  ...(isTouch && hovered === tokenId
                    ? { boxShadow: "0 0 0 2px rgba(255,255,255,0.92)", zIndex: 10 }
                    : {}),
                }}
              />
            );
          })}

        {/* hover tooltip — marketplace-style card popup, fixed-positioned at
            the cursor and clamped to the viewport (same as the Packing tab) */}
        {hoveredCard &&
          hoverXY &&
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
                        left: Math.min(
                          Math.max(hoverXY.x - 196, 6),
                          Math.max(6, vw - 398),
                        ),
                        top: tooltipBelow ? hoverXY.y + 16 : hoverXY.y - 12,
                        transform: tooltipBelow
                          ? undefined
                          : "translateY(-100%)",
                      }
                }
              >
                <TokenHoverCard
                  token={hoveredCard}
                  href={isTouch ? nftExplorerUrl(hoveredCard.tokenId) : undefined}
                  onClose={isTouch ? () => setHovered(null) : undefined}
                  {...(isTouch
                    ? {
                        onPrev: step(-1),
                        onNext: step(1),
                        place: { index: at + 1, total: initialOrder.length },
                      }
                    : {})}
                />
              </div>
            </>,
            document.body,
          )}
      </div>

      {/* live draw-log ticker — one line under the stage; hover (desktop) or
          tap (touch) expands the full scrollable log above it */}
      {steps.length > 0 && (
        <div
          data-log
          className="relative mt-2 translate-y-2 opacity-0"
          onMouseEnter={() => setLogOpen(true)}
          onMouseLeave={() => setLogOpen(false)}
        >
          <div
            className={`absolute bottom-full left-0 right-0 z-40 mb-1.5 flex flex-col overflow-hidden rounded-lg border border-hairline bg-raised/95 shadow-card backdrop-blur-md transition-all duration-200 ${
              logOpen
                ? "visible translate-y-0 opacity-100"
                : "invisible translate-y-2 opacity-0"
            }`}
          >
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <h3 className="font-display text-[12px] font-semibold uppercase tracking-wide text-muted">
                Draw Log
              </h3>
              <span className="font-mono-num text-[11px] text-muted">
                {steps.length} draws · first → last
              </span>
            </div>
            <ol
              ref={logListRef}
              className="relative flex max-h-[300px] flex-col gap-1.5 overflow-y-auto p-2"
            >
              {steps.map((step) => {
                const card = cardByToken.get(step.pickedTokenId);
                const ok = step.proofValid && step.betaMatches && step.matchesRecord;
                return (
                  <li
                    key={step.checkoutId}
                    data-log-row={step.checkoutId}
                    className={`rounded-md border p-2 ${
                      step.isTarget
                        ? "border-white/40 bg-surface"
                        : "border-hairline bg-surface/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[12px] font-semibold">
                        Draw {step.ordinal} · #{step.checkoutId}
                        {step.isTarget && (
                          <span className="ml-2 font-bold text-white">YOU</span>
                        )}
                      </span>
                      <span className={`text-[11px] ${ok ? "text-gain" : "text-loss"}`}>
                        {step.proofValid ? "π✓" : "π✗"}{" "}
                        {step.betaMatches ? "β✓" : "β✗"}{" "}
                        {step.matchesRecord ? "≡✓" : "≡✗"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono-num text-[10.5px] text-muted">
                      β {truncateHex(step.randomness, 5)} · keccak(β) mod{" "}
                      {step.eligibleCount} = {step.derivedIndex} → {card?.name ?? step.pickedTokenId}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>

          <button
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            aria-expanded={logOpen}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-raised/90 px-3 py-2 text-left backdrop-blur-md"
          >
            <span
              data-ticker
              className="truncate font-mono-num text-[12px] text-white"
            >
              Replaying {steps.length} draws — first to last, every proof
              verified…
            </span>
            <span className="shrink-0 font-body text-[11px] text-muted">
              {logOpen ? "hide log ▾" : "full log ▴"}
            </span>
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <p className="font-body text-[12px] text-muted">
          One cell per card, sorted by token ID ascending — the exact eligible
          order, sampled without replacement. Hover any cell for the card's
          detail.
        </p>
        <span className="flex items-center gap-1.5 font-body text-[11px] text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-white/40" />
          available
          <span className="ml-2 inline-block h-2.5 w-2.5 rounded-[2px] bg-white/10" />
          ripped
        </span>
      </div>
    </div>
  );
}
