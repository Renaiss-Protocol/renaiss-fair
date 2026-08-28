"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { gsap, useGSAP } from "./gsap";
import type { RipDraw, RipLookup } from "@/lib/api/renaiss/verify/get-rip";
import type { DrawWitness, LineupCard } from "@/lib/api/types";
import { nftExplorerUrl, USE_MOCK_DATA } from "@/lib/config";
import { getOnChainMerkleRoot, getTxReceiptFacts } from "@/lib/onchain";
import { computeLeaf, foldMerkleProof } from "@/lib/merkle";
import { deriveSeed, ecvrfVerifyHex, SEED_DOMAIN_TAG } from "@/lib/verify";
import { useReplay } from "@/lib/use-replay";
import { formatTokenId, truncateHex } from "@/lib/format";
import { CardFace } from "./card-face";
import { DataChip } from "./provenance";
import { RemoteImage } from "./remote-image";

/**
 * How long a step's result takes to finish arriving: the block fades in, then
 * its chips land one at a time — with five of them the last settles at
 * 0.12 + 0.07x4 + 0.3s. The step below is armed once that is done.
 */
const RESULT_SETTLE = 0.72;

const EMPTY_LINEUP: LineupCard[] = [];
const EMPTY_DRAWS: DrawWitness[] = [];

/** The revealed card's actual render — shop-optimized variant → raw URL →
 * the abstract CardFace slab (same downgrade chain as the token grids). */
function RevealCardArt({ card }: { card: LineupCard }) {
  const fallback = (
    <div className="h-[178px] w-[132px] shrink-0">
      <CardFace card={card} />
    </div>
  );
  if (card.frontImageUrl === undefined) return fallback;
  return (
    <RemoteImage
      src={card.frontImageUrl}
      alt={card.name}
      width={302}
      height={354}
      frameClassName="aspect-[302/354] w-[168px] shrink-0"
      imgClassName="h-full w-full rounded-lg border border-white/10 bg-white/[0.04] object-contain"
      placeholderClassName="rounded-lg"
      fallback={fallback}
    />
  );
}

/**
 * A step's result appearing once the reader runs it. The block fades in, then
 * its data pills land one at a time — the derivation reads as values arriving
 * rather than a panel switching on.
 *
 * A hidden tab suspends requestAnimationFrame, which would freeze these tweens
 * and leave the result invisible; the animation is decoration, so it is skipped
 * outright in that case. clearProps drops the inline styles once it lands, so an
 * interrupted tween cannot leave anything hidden either.
 */
function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const settle = "opacity,visibility,transform";
      gsap.fromTo(
        ref.current,
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.35,
          ease: "power2.out",
          clearProps: settle,
        },
      );
      const chips = gsap.utils.toArray<HTMLElement>("[data-chip]", ref.current);
      if (chips.length > 0) {
        gsap.from(chips, {
          autoAlpha: 0,
          y: 8,
          scale: 0.96,
          duration: 0.3,
          stagger: 0.07,
          delay: 0.12,
          ease: "power2.out",
          clearProps: settle,
        });
      }
    },
    { scope: ref },
  );
  return <div ref={ref}>{children}</div>;
}

function Step({
  n,
  title,
  plain,
  done,
  enabled,
  actionLabel,
  onAction,
  waiting,
  locked,
  children,
}: {
  n: number;
  title: string;
  /** Plain-language "what this means" line, always visible, so a
      non-technical reader knows why the step matters before clicking. */
  plain: React.ReactNode;
  done: boolean;
  enabled: boolean;
  actionLabel: string;
  onAction: () => void;
  /** Replaces the action button while prerequisites load. */
  waiting?: string | undefined;
  /** Replaces the action button entirely — the step cannot run yet (a
      sealed set's Tier B); unlike `waiting`, nothing is coming until the
      world changes. */
  locked?: string | undefined;
  children: React.ReactNode;
}) {
  const [explain, setExplain] = useState(false);
  return (
    <li
      data-step={n}
      // The step that is runnable but not yet run is the only one the reader
      // can act on, so it carries the sweeping border; the rest sit plain.
      className={`rounded-lg p-5 transition-opacity ${
        done || enabled ? "" : "opacity-40"
      } ${
        enabled && !done
          ? "step-active"
          : "border border-hairline bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono-num text-[13px] ${
            done ? "border-gain text-gain" : "border-hairline text-muted"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {/* The plain-language gloss is there for whoever wants it, but it is
            three lines of prose on every step; folded behind the title it stops
            pushing the actual derivation down the page. */}
        <button
          type="button"
          onClick={() => setExplain((o) => !o)}
          aria-expanded={explain}
          aria-label={`What "${title}" means`}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
            explain
              ? "border-white/40 bg-white/10 text-white"
              : "border-hairline text-muted hover:border-white/30 hover:text-white"
          }`}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 16v-5" />
            <path d="M12 8h.01" />
          </svg>
        </button>
        {/* The action sits right of the title where the row has room. On a
            phone the title fills the row and this wraps below it, where hugging
            the right edge stranded it away from the step it belongs to. */}
        {!done && enabled && (
          <span className="sm:ml-auto">
            {locked ? (
              <span className="font-body text-[12px] text-muted">
                🔒 {locked}
              </span>
            ) : waiting ? (
              <span className="font-body text-[12px] text-muted">
                {waiting}
              </span>
            ) : (
              <button
                onClick={onAction}
                className="btn-secondary h-9 px-5 text-[13px]"
              >
                {actionLabel}
              </button>
            )}
          </span>
        )}
      </div>
      {explain && (
        <div className="mt-3 flex items-start gap-2.5 rounded-md bg-white/[.04] px-3.5 py-2.5">
          <span
            aria-hidden
            className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--grad-brand)" }}
          />
          <p className="font-body text-[13px] leading-relaxed text-muted">
            <span className="font-semibold text-white/85">
              What this means ·{" "}
            </span>
            {plain}
          </p>
        </div>
      )}
      {done && (
        <Reveal>
          <div className="mt-4">{children}</div>
        </Reveal>
      )}
    </li>
  );
}

/**
 * Interactive prover — the full verification recipe end-to-end from one
 * /verify/rip lookup (or its fixture twin): the user clicks through every
 * derivation from the on-chain facts to their final card. Tier A (steps
 * 1–4: seed, ECVRF, Merkle inclusion) works even while the set is still
 * ripping; Tier B (steps 5–6: the full index replay) unlocks once the
 * server serves the replay payload — a sealed set never leaks its lineup.
 * All crypto runs on click, in the browser; every datum carries a
 * provenance hover.
 */
export function ProofWalkthrough({ rip }: { rip: RipLookup }) {
  const scope = useRef<HTMLDivElement>(null);
  const [drawIndex, setDrawIndex] = useState(0);
  const [done, setDone] = useState(0);
  /**
   * How far the reader may see ahead. It trails `done`: a step's result lands
   * first, and only once it has settled does the step below light up. Running
   * both at once split the eye between the values just revealed and a freshly
   * glowing panel underneath them.
   */
  const [armed, setArmed] = useState(0);
  /** Pending arm, so switching draws mid-step cannot arm the old one late. */
  const armTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  const [betaHex, setBetaHex] = useState<string | null>(null);
  const [derivedRoot, setDerivedRoot] = useState<string | null>(null);
  // The commitments the API cannot fake: the on-chain root (when the RPC
  // read is configured) and the receipt's tx.from — the API never serves
  // buyer addresses, the browser reads its own.
  const [onchainRoot, setOnchainRoot] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    from: string;
    blockHash: string;
  } | null>(null);

  const target: RipDraw = rip.draws[drawIndex] ?? rip.draws[0]!;
  const witness = target.witness;
  const sealed = rip.replay === null;

  useEffect(() => {
    if (USE_MOCK_DATA) return;
    let cancelled = false;
    getOnChainMerkleRoot(rip.pack.onChainPackId, rip.setId).then((root) => {
      if (!cancelled) setOnchainRoot(root);
    });
    if (!rip.buyer) {
      getTxReceiptFacts(rip.txHash).then((facts) => {
        if (!cancelled) setReceipt(facts);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [rip]);

  // Tier B: replay every prior draw of the set (their cards are DERIVED,
  // never served) up to the user's own; the target's key doubles as the
  // fallback for prior draws, which carry none.
  const replayLineup = useMemo<LineupCard[]>(
    () =>
      rip.replay
        ? rip.replay.lineupTokenIds.map((tokenId) => ({
            tokenId,
            name: `#${tokenId}`,
            tier: "c",
            valueInUsd: 0,
          }))
        : EMPTY_LINEUP,
    [rip.replay],
  );
  const replayDraws = useMemo<DrawWitness[]>(
    () =>
      rip.replay
        ? [
            ...rip.replay.priorDraws.filter(
              (p) => p.checkoutId !== witness.checkoutId,
            ),
            witness,
          ]
        : EMPTY_DRAWS,
    [rip.replay, witness],
  );
  const replay = useReplay(
    witness.publicKeyHex,
    rip.pack.onChainPackId,
    replayLineup,
    replayDraws,
    witness.checkoutId,
  );
  const ready = !sealed && replay !== null && replay.steps.length > 0;
  const userStep = ready ? replay.steps[replay.steps.length - 1] : undefined;
  const priorCount = ready ? replay.steps.length - 1 : 0;

  const alpha = useMemo(
    () =>
      deriveSeed(
        witness.blockHash,
        rip.pack.onChainPackId,
        witness.checkoutId,
      ),
    [witness, rip.pack.onChainPackId],
  );
  const betaMatches =
    betaHex !== null &&
    betaHex.toLowerCase() === witness.randomness.toLowerCase();

  // The chain outranks the API: compare against the on-chain root whenever
  // it is readable, else the served root (labeled honestly).
  const publishedRoot = onchainRoot ?? rip.merkleRoot;
  const rootSource: "onchain" | "api" =
    onchainRoot || USE_MOCK_DATA ? "onchain" : "api";
  const inclusionOk =
    derivedRoot !== null &&
    publishedRoot !== null &&
    derivedRoot.toLowerCase() === publishedRoot.toLowerCase();

  const buyer = rip.buyer ?? receipt?.from;
  const receiptBlockMismatch =
    receipt !== null &&
    receipt.blockHash.toLowerCase() !== witness.blockHash.toLowerCase();

  /**
   * The moment the rip is found: the five steps deal in from the top, then the
   * page carries the reader down to the first one. Verifying is a request to be
   * shown the proof, so landing them on step 1 finishes the thought rather than
   * leaving the trail below the fold — and it matches how the steps already hand
   * off to each other as they are run.
   *
   * Skipped when the tab is hidden: requestAnimationFrame is suspended there,
   * which would freeze the tween and leave the whole walkthrough invisible.
   */
  useGSAP(
    () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // The steps arrive one at a time, so the reader watches the derivation
      // being laid out rather than meeting six panels at once.
      //
      // Each step also carries Tailwind's transition-opacity, so it can dim to
      // 40% while it is still locked. Left in place that transition fights the
      // tween: the browser lags every opacity GSAP writes, then runs a second
      // time when clearProps drops the inline value — which is why a locked
      // step used to land at full brightness and visibly sink. Suppressing the
      // transition for the length of the tween keeps the fade clean, and
      // clearing it afterwards hands the dimming back to CSS.
      const steps = gsap.utils.toArray<HTMLElement>(
        "[data-step]",
        scope.current,
      );
      gsap.set(steps, { transition: "none" });
      gsap.from(steps, {
        autoAlpha: 0,
        y: 22,
        duration: 0.45,
        stagger: 0.14,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform,transition",
      });
      // Resolve where to scroll to when the tween fires, not when it is
      // scheduled: this walkthrough replaces the recipe footer as it mounts, so
      // everything above step 1 is still settling and a target measured now
      // overshoots by about the height of what was removed.
      gsap.delayedCall(0.25, () => {
        const first = scope.current?.querySelector('[data-step="1"]');
        if (!first) return;
        const y = first.getBoundingClientRect().top + window.scrollY - 140;
        gsap.to(window, {
          scrollTo: { y: Math.max(0, y) },
          duration: 0.65,
          ease: "power2.inOut",
          overwrite: "auto",
        });
      });
    },
    { scope },
  );

  const advance = (n: number) => {
    setDone(n);
    // Let the step's own result finish arriving before handing the reader on:
    // the next step lights up, and the eye is guided to it, only once the
    // values just derived have settled.
    //
    // This waits on a plain timer, never on gsap.delayedCall — a hidden tab
    // suspends requestAnimationFrame, and arming the next step off the
    // animation clock would strand the reader on this one for as long as the
    // tab stayed in the background. With the animation skipped there is
    // nothing to wait for either, so it arms at once.
    const hidden = typeof document !== "undefined" && document.hidden;
    window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(
      () => {
        setArmed(n);
        const next = scope.current?.querySelector(`[data-step="${n + 1}"]`);
        if (next && !hidden) {
          gsap.to(window, {
            scrollTo: { y: next, offsetY: 140 },
            duration: 0.5,
            ease: "power2.inOut",
            overwrite: "auto",
          });
        }
      },
      hidden ? 0 : RESULT_SETTLE * 1000,
    );
  };

  const pickDraw = (i: number) => {
    if (i === drawIndex) return;
    setDrawIndex(i);
    // A different draw is a different proof — restart the walkthrough.
    window.clearTimeout(armTimer.current);
    setDone(0);
    setArmed(0);
    setBetaHex(null);
    setDerivedRoot(null);
  };

  const sealedNote =
    "Unlocks when this set completes — a sealed set never reveals its lineup, but steps 1–3 and the final on-chain Merkle check already prove your card and its committed slot.";

  return (
    <div ref={scope} className="mx-auto max-w-3xl px-6 pb-20">
      {rip.draws.length > 1 && (
        <div className="mb-4 rounded-lg border border-hairline bg-surface p-4">
          <p className="mb-2 font-body text-[13px] text-muted">
            This transaction ripped{" "}
            <span className="font-mono-num text-white">
              {rip.draws.length}
            </span>{" "}
            cards — each draw carries its own proof. Pick one to verify:
          </p>
          <div className="flex flex-wrap gap-2">
            {rip.draws.map((d, i) => (
              <button
                key={d.witness.checkoutId}
                onClick={() => pickDraw(i)}
                aria-pressed={i === drawIndex}
                title={d.card.name}
                className={`h-8 rounded-full border px-4 font-mono-num text-[12px] ${
                  i === drawIndex
                    ? "border-white/60 bg-raised font-bold text-white"
                    : "border-hairline text-muted hover:text-white"
                }`}
              >
                #{i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        <Step
          n={1}
          title="Collect the on-chain facts"
          plain="You don't have to take our word for any of this. These numbers live on the public blockchain, where anyone can look them up and no one, including us, can change them after the fact."
          done={done >= 1}
          enabled
          actionLabel="Read your transaction"
          onAction={() => advance(1)}
        >
          <p className="mb-3 font-body text-[13px] text-muted">
            Everything here comes from your transaction, decoded from the{" "}
            <span className="font-mono-num">CheckoutSuccess</span> event. Hover
            any value to see its source.
          </p>
          <div className="flex flex-wrap gap-2">
            <DataChip
              label="tx"
              value={truncateHex(rip.txHash, 6)}
              full={rip.txHash}
              source="onchain"
              detail="Your permitFund transaction hash."
            />
            <DataChip
              label="packId"
              href="/whitepaper#post-commit-seed"
              value={truncateHex(rip.pack.onChainPackId, 6)}
              full={rip.pack.onChainPackId}
              source="onchain"
              detail="CheckoutSuccess.packId, indexed event field on the vending-machine contract."
            />
            <DataChip
              label="checkoutId"
              href="/whitepaper#post-commit-seed"
              value={String(witness.checkoutId)}
              source="onchain"
              detail="CheckoutSuccess.checkoutIds[], your draw's sequence number in this pack."
            />
            <DataChip
              label="blockHash"
              href="/whitepaper#post-commit-seed"
              value={truncateHex(witness.blockHash, 6)}
              full={witness.blockHash}
              source="onchain"
              detail="Block hash of the permitFund tx, the entropy, fixed by chain consensus after you signed."
            />
            {buyer && (
              <DataChip
                label="buyer"
                value={truncateHex(buyer, 5)}
                full={buyer}
                source="onchain"
                detail={
                  rip.buyer
                    ? "CheckoutSuccess.user, the rip is bound to your address."
                    : "tx.from, read from the RPC receipt by your browser — the verify API never serves buyer addresses."
                }
              />
            )}
          </div>
          {receiptBlockMismatch && (
            <p className="mt-3 font-body text-[13px] text-loss">
              ✗ The RPC receipt's block hash differs from the served witness —
              the record does not belong to this transaction's block.
            </p>
          )}
        </Step>

        <Step
          n={2}
          title="Recompute the VRF input α"
          plain="Those facts are blended into one number: the seed of your unique random draw, which determines your final card. Because the block hash didn't exist until after you paid, nobody could know this seed in advance, not even us."
          done={done >= 2}
          enabled={armed >= 1}
          actionLabel="Compute α"
          onAction={() => advance(2)}
        >
          <p className="mb-3 font-mono-num text-[13px] text-muted">
            α = keccak256( tag ‖ blockHash ‖ packId ‖ checkoutId as 32-byte BE )
          </p>
          <div className="flex flex-wrap gap-2">
            <DataChip
              label="tag"
              href="/whitepaper#post-commit-seed"
              value={SEED_DOMAIN_TAG}
              source="api"
              detail="Published domain-separation constant, scopes this hash to exactly one meaning (pack draw seed, formula v1), so seeds can never collide with any other keccak256 use."
            />
            <DataChip
              label="α"
              href="/whitepaper#post-commit-seed"
              value={truncateHex(alpha, 8)}
              full={alpha}
              source="local"
              detail="keccak256 over the tag and the three on-chain values from step 1, just ran on this page."
            />
          </div>
        </Step>

        <Step
          n={3}
          title="Verify the ECVRF proof π"
          plain="Your seed allows exactly one valid random number, and this checks the cryptographic receipt for it, right here in your browser. If we had swapped your result for a different one, this check would fail."
          done={done >= 3}
          enabled={armed >= 2}
          actionLabel="Run ECVRF_verify(PK, α, π)"
          onAction={() => {
            setBetaHex(
              witness.publicKeyHex
                ? ecvrfVerifyHex(witness.publicKeyHex, alpha, witness.proof)
                : null,
            );
            advance(3);
          }}
        >
          <p className="mb-3 font-body text-[13px] text-muted">
            RFC 9381 §5.3, ECVRF-EDWARDS25519-SHA512-ELL2, executed in your
            browser just now, using the same implementation the backend runs.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <DataChip
              label="PK"
              href="/whitepaper#ecvrf-proof"
              value={truncateHex(witness.publicKeyHex ?? "0x", 6)}
              full={witness.publicKeyHex ?? ""}
              source="api"
              detail="This draw's published VRF verification key — served per draw, so key rotation never breaks old rips."
            />
            <DataChip
              label="π"
              href="/whitepaper#ecvrf-proof"
              value={truncateHex(witness.proof, 6)}
              full={witness.proof}
              source="api"
              detail="pack_draw_records.proof, 80-byte ECVRF proof stored at draw resolution."
            />
            <DataChip
              label="stored β"
              href="/whitepaper#ecvrf-proof"
              value={truncateHex(witness.randomness, 6)}
              full={witness.randomness}
              source="api"
              detail="pack_draw_records.randomness, the β the backend recorded for this draw."
            />
            {betaHex && (
              <DataChip
                label="derived β"
                href="/whitepaper#ecvrf-proof"
                value={truncateHex(betaHex, 6)}
                full={betaHex}
                source="local"
                detail="ECVRF_proof_to_hash(π), recomputed from the proof in your browser."
              />
            )}
          </div>
          <div className="flex flex-wrap gap-3 font-body text-[13px]">
            <span className={betaHex ? "text-gain" : "text-loss"}>
              {betaHex
                ? "✓ π verifies against PK and α"
                : "✗ π failed verification"}
            </span>
            <span className={betaMatches ? "text-gain" : "text-loss"}>
              {betaMatches
                ? "✓ derived β equals stored randomness"
                : "✗ β does not match the stored randomness"}
            </span>
          </div>
        </Step>

        <Step
          n={4}
          title="Derive the eligible index"
          plain="Your random number points at exactly one position among the cards still left in the set. There are no re-rolls and no second chances: one seed selects one slot. Replaying everyone's earlier draws proves the whole set's history is honest, not just yours."
          done={done >= 4}
          enabled={armed >= 3}
          actionLabel={`Compute keccak256(β) mod ${userStep?.eligibleCount ?? "…"}`}
          onAction={() => advance(4)}
          locked={sealed ? sealedNote : undefined}
          waiting={
            sealed || ready
              ? undefined
              : `Replaying ${replayDraws.length} draws (verifying every π)…`
          }
        >
          <p className="mb-3 font-body text-[13px] text-muted">
            Draws sample <em>without replacement</em>, so your draw's modulus is
            the count of cards still available, reproduced by replaying every
            prior draw in this set.
          </p>
          <div className="flex flex-wrap gap-2">
            <DataChip
              label="prior draws"
              href="/whitepaper#procedure"
              value={String(priorCount)}
              source="api"
              detail="Every draw of this set before yours — proofs only, no cards or buyers; each one's π verified during the replay."
            />
            <DataChip
              label="remaining"
              href="/whitepaper#slot-mapping"
              value={String(userStep?.eligibleCount ?? 0)}
              source="local"
              detail="The set's committed lineup, minus the cards removed by the replayed prior draws."
            />
            <DataChip
              label="index"
              href="/whitepaper#slot-mapping"
              value={`keccak256(β) mod ${userStep?.eligibleCount} = ${userStep?.derivedIndex}`}
              source="local"
              detail="The one and only slot your randomness can select, computed on this page."
            />
          </div>
        </Step>

        <Step
          n={5}
          title="Reveal your card"
          plain="The card sitting at that position is the card you were dealt. If it matches the one we recorded for you, the math, not our word, has proven your rip was fair."
          done={done >= 5}
          enabled={armed >= 4}
          actionLabel="Reveal Card"
          onAction={() => advance(5)}
          locked={sealed ? sealedNote : undefined}
        >
          {userStep && (
            <div className="flex flex-wrap items-start gap-6">
              <RevealCardArt card={target.card} />
              <div className="min-w-0 flex-1">
                <p className="font-body text-[13px] text-muted">
                  The remaining lineup, sorted by token ID ascending, at
                  position{" "}
                  <span className="font-mono-num text-white">
                    {userStep.derivedIndex}
                  </span>{" "}
                  holds:
                </p>
                {target.card.setName && (
                  <p className="mt-1.5 font-body text-[13px] leading-snug text-muted">
                    {target.card.setName}
                  </p>
                )}
                <p className="mt-1 font-display text-[15px] font-bold leading-snug">
                  {target.card.name}
                </p>
                <p className="mt-1 font-mono-num text-[11.5px] text-muted">
                  Token ID:{" "}
                  <a
                    href={nftExplorerUrl(target.card.tokenId)}
                    target="_blank"
                    rel="noreferrer"
                    title={target.card.tokenId}
                    className="underline decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:decoration-2"
                  >
                    {formatTokenId(target.card.tokenId)}
                  </a>
                </p>
                <p
                  className={`mt-2 font-body text-[13px] ${
                    userStep.matchesRecord ? "text-gain" : "text-loss"
                  }`}
                >
                  {userStep.matchesRecord
                    ? "✓ Matches the card the backend recorded, this rip is provably yours."
                    : "✗ Does NOT match the recorded card, the record diverges from the math."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <DataChip
                    label="recorded card"
                    href="/whitepaper#slot-mapping"
                    value={formatTokenId(witness.resolvedTokenId ?? "0")}
                    full={witness.resolvedTokenId ?? ""}
                    source="api"
                    detail="The draw record's resolution — what Renaiss says you drew."
                  />
                  <DataChip
                    label="derived card"
                    href="/whitepaper#slot-mapping"
                    value={formatTokenId(userStep.pickedTokenId)}
                    full={userStep.pickedTokenId}
                    source="local"
                    detail="The card the replayed math landed on — derived in your browser, independent of the record."
                  />
                </div>
              </div>
            </div>
          )}
        </Step>
        <Step
          n={6}
          title="On-chain Merkle check — prove your card in set"
          plain={
            <>
              A different claim from the draw math above — this verifies the
              lineup, not the randomness. Before the first rip, every card of
              the set was hashed into one fingerprint (the Merkle root) and
              published. Folding your card's hash up its inclusion path onto
              that fingerprint proves it sat in the committed lineup all
              along, not slipped in afterwards
              {sealed
                ? " — and it works even while the set is still sealed."
                : "."}
            </>
          }
          done={derivedRoot !== null}
          enabled={sealed ? armed >= 3 : armed >= 5}
          actionLabel={`Fold ${target.merkleProof.length} hashes to the root`}
          onAction={() => {
            const leaf = computeLeaf({
              tokenId: target.card.tokenId,
              salt: target.card.merkleSalt ?? "0x0",
              valueInUsd: target.card.valueInUsd,
            });
            setDerivedRoot(foldMerkleProof(leaf, target.merkleProof));
          }}
        >
          <p className="mb-3 font-mono-num text-[13px] text-muted">
            leaf = keccak256( abi.encode(tokenId, salt, value) ) → parent =
            keccak256( sorted pair ) … → root
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
              <DataChip
                label="tokenId"
                externalHref={nftExplorerUrl(target.card.tokenId)}
                value={formatTokenId(target.card.tokenId)}
                full={target.card.tokenId}
                source="api"
                detail="Your card's token id — one of the three values its leaf commits. Click to see the token on BscScan."
              />
              <DataChip
                label="salt"
                href="/whitepaper#pinning"
                value={truncateHex(target.card.merkleSalt ?? "0x", 5)}
                full={target.card.merkleSalt ?? ""}
                source="api"
                detail="The card's Merkle leaf salt — revealed at draw time, it keeps unsold cards' leaves unguessable."
              />
              <DataChip
                label="path"
                href="/whitepaper#pinning"
                value={`${target.merkleProof.length} hashes`}
                source="api"
                detail="The sibling hashes from your leaf to the root — ⌈log₂(set size)⌉ nodes, nothing else of the lineup is revealed."
              />
              {derivedRoot && (
                <DataChip
                  label="derived root"
                  href="/whitepaper#pinning"
                  value={truncateHex(derivedRoot, 6)}
                  full={derivedRoot}
                  source="local"
                  detail="Your leaf folded up the path, computed on this page just now."
                />
              )}
              <DataChip
                label="published root"
                href="/whitepaper#pinning"
                value={publishedRoot ? truncateHex(publishedRoot, 6) : "—"}
                {...(publishedRoot ? { full: publishedRoot } : {})}
                source="onchain"
                detail={
                  rootSource === "onchain"
                    ? "The vending-machine contract's merkleRoots(packId, setId), read from the chain just now — committed before the set's first rip."
                    : "The vending-machine contract's merkleRoots(packId, setId) — committed on-chain before the set's first rip. This copy is relayed by the API; anyone can read the same value straight off the contract."
                }
              />
          </div>
          <p
            className={`font-body text-[13px] ${
              inclusionOk ? "text-gain" : "text-loss"
            }`}
          >
            {inclusionOk
              ? "✓ Your card's leaf folds exactly to the committed root — it was in the lineup before the first rip."
              : "✗ The folded root does not match the commitment — this card was not in the committed lineup."}
          </p>
        </Step>
      </ol>

      {derivedRoot !== null && (sealed ? done >= 3 : done >= 5) && (
        <Reveal>
          <p className="mt-6 text-center font-body text-[13px] text-muted">
            {sealed
              ? "Tier A verified — the full draw replay unlocks here once this set completes. Full recipe in the "
              : "Every step above is reproducible from public data and the API witness. Full recipe in the "}
            <Link
              href="/whitepaper"
              className="underline decoration-white/30 underline-offset-2 hover:text-white"
            >
              whitepaper
            </Link>
            .
          </p>
        </Reveal>
      )}
    </div>
  );
}
