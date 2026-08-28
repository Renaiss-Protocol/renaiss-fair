"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger, useGSAP } from "./gsap";
import { getSetDrawHistory, getSetLineup } from "@/lib/api/client";
import type {
  DrawWitness,
  LineupCard,
  TxLookupResult,
  VrfPublicKey,
} from "@/lib/api/types";
import { deriveSeed, ecvrfVerifyHex } from "@/lib/verify";
import { useReplay } from "@/lib/use-replay";
import { truncateHex } from "@/lib/format";
import { CardFace } from "./card-face";

const EMPTY_LINEUP: LineupCard[] = [];
const EMPTY_DRAWS: DrawWitness[] = [];

function Scene({
  kicker,
  title,
  children,
  art,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
  art: React.ReactNode;
}) {
  return (
    <section
      data-scene
      className="mx-auto grid max-w-3xl items-center gap-8 px-6 py-16 md:grid-cols-[1fr_220px]"
    >
      <div>
        <p data-fx className="font-body text-[12px] uppercase tracking-widest text-muted">
          {kicker}
        </p>
        <h2 data-fx className="mt-1 font-display text-2xl font-bold leading-tight">
          {title}
        </h2>
        <div data-fx className="mt-3 font-body text-[15px] leading-relaxed text-white/80">
          {children}
        </div>
      </div>
      <div data-fx className="mx-auto">
        {art}
      </div>
    </section>
  );
}

/* ── tiny CSS/SVG illustrations ─────────────────────────────────────────── */

function TicketArt({ n }: { n: number | string }) {
  return (
    <div className="w-[200px] rounded-lg border border-dashed border-white/40 bg-raised p-4 text-center">
      <p className="font-body text-[10px] uppercase tracking-widest text-muted">
        Rip Ticket
      </p>
      <p className="font-display text-4xl font-bold">#{n}</p>
      <p className="mt-1 font-body text-[10px] text-muted">engraved on-chain</p>
    </div>
  );
}

function FingerprintArt({ hash }: { hash: string }) {
  const chars = hash.replace("0x", "").slice(0, 36).split("");
  return (
    <div className="w-[200px] rounded-lg border border-hairline bg-raised p-4">
      <p className="mb-2 text-center font-body text-[10px] uppercase tracking-widest text-muted">
        Block Fingerprint
      </p>
      <div className="grid grid-cols-6 gap-1">
        {chars.map((c, i) => (
          <span
            key={i}
            className="rounded-[3px] bg-white/10 py-0.5 text-center font-mono-num text-[10px] text-white/70"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function SealArt() {
  return (
    <div className="relative flex h-[170px] w-[200px] items-center justify-center rounded-lg border border-hairline bg-raised">
      <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-white/40">
        <span className="font-display text-3xl font-bold">β</span>
      </div>
      <span className="absolute -right-2 top-4 rotate-6 rounded-xs border border-message/60 bg-message/10 px-2 py-1 font-mono-num text-[11px] text-message">
        receipt π
      </span>
    </div>
  );
}

function ShelfArt({ index }: { index: number }) {
  return (
    <div className="flex w-[200px] items-end justify-center gap-1.5">
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className={`w-6 rounded-[4px] border ${
            i === index
              ? "-translate-y-2 border-white bg-white/20 shadow-glow"
              : "border-hairline bg-raised"
          }`}
          style={{ height: 64 }}
        />
      ))}
    </div>
  );
}

function LockArt() {
  return (
    <div className="flex w-[200px] flex-col items-center gap-2 rounded-lg border border-hairline bg-raised p-4">
      <div className="h-8 w-10 rounded-t-full border-2 border-b-0 border-loss/70" />
      <div className="flex h-12 w-16 items-center justify-center rounded-md border-2 border-loss/70">
        <span className="font-mono-num text-[10px] text-loss">pending</span>
      </div>
    </div>
  );
}

/**
 * /e — the story: the whole proof told in plain language, scene by scene,
 * using the demo rip's real values — and one button at the end that runs the
 * actual cryptography.
 */
export function ProofStory({
  lookup,
  vrfKey,
}: {
  lookup: TxLookupResult;
  vrfKey: VrfPublicKey;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{
    lineup: LineupCard[];
    draws: DrawWitness[];
  } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getSetLineup(lookup.pack.packId, lookup.setId),
      getSetDrawHistory(lookup.pack.packId, lookup.setId),
    ]).then(([lineup, draws]) => {
      if (!cancelled) setData({ lineup, draws });
    });
    return () => {
      cancelled = true;
    };
  }, [lookup]);

  const replay = useReplay(
    vrfKey.publicKeyHex,
    lookup.pack.onChainPackId,
    data?.lineup ?? EMPTY_LINEUP,
    data?.draws ?? EMPTY_DRAWS,
    lookup.checkoutId,
  );
  const ready = data !== null && replay !== null && replay.steps.length > 0;
  const userStep = ready ? replay.steps[replay.steps.length - 1] : undefined;
  const finalCard =
    userStep && data
      ? data.lineup.find((c) => c.tokenId === userStep.pickedTokenId)
      : undefined;
  const alpha = deriveSeed(lookup.blockHash, lookup.pack.onChainPackId, lookup.checkoutId);
  const beta = ready
    ? ecvrfVerifyHex(vrfKey.publicKeyHex, alpha, lookup.witness.proof)
    : null;
  const betaOk =
    !!beta && beta.toLowerCase() === lookup.witness.randomness.toLowerCase();

  // Scroll-reveal each scene. Scenes only mount once `ready` (see below), so
  // this builds exactly ONE set of triggers — building on every `ready`
  // transition caused duplicate from() tweens that left the story stuck
  // invisible. `once` keeps a revealed scene revealed no matter what.
  useGSAP(
    () => {
      if (!ready) return;
      gsap.utils.toArray<HTMLElement>("[data-scene]").forEach((scene) => {
        gsap.from(scene.querySelectorAll("[data-fx]"), {
          y: 24,
          autoAlpha: 0,
          stagger: 0.12,
          duration: 0.55,
          ease: "power2.out",
          scrollTrigger: { trigger: scene, start: "top 78%", once: true },
        });
      });
    },
    { scope, dependencies: [ready], revertOnUpdate: true },
  );

  // Animate the check ticks after React has rendered them.
  useGSAP(
    () => {
      if (!checked) return;
      gsap.fromTo(
        "[data-tick]",
        { autoAlpha: 0, x: -10 },
        { autoAlpha: 1, x: 0, stagger: 0.45, duration: 0.35, ease: "power2.out" },
      );
      ScrollTrigger.refresh(); // scene heights changed (button → card art)
    },
    { scope, dependencies: [checked] },
  );

  const runCheck = () => setChecked(true);

  if (!ready) {
    return (
      <div className="mx-auto flex h-60 max-w-3xl items-center justify-center px-6">
        <span className="font-body text-[13px] text-muted">
          Fetching your rip's numbers and verifying the receipts…
        </span>
      </div>
    );
  }

  return (
    <div ref={scope}>
      <Scene
        kicker="Chapter 1"
        title="You bought a rip — and got a numbered ticket."
        art={<TicketArt n={lookup.checkoutId} />}
      >
        <p>
          The moment you paid, the blockchain handed you ticket{" "}
          <strong>#{lookup.checkoutId}</strong>. It's engraved in a public
          ledger — Renaiss can't renumber it, and neither can you.
        </p>
      </Scene>

      <Scene
        kicker="Chapter 2"
        title="Then the universe rolled the dice."
        art={<FingerprintArt hash={lookup.blockHash} />}
      >
        <p>
          Your payment landed inside a block, and every block has a
          fingerprint — a jumble of characters decided by the whole network,{" "}
          <em>after</em> you paid. Nobody gets to choose it: not you, not
          Renaiss, not the validators. That fingerprint is the dice roll.
        </p>
      </Scene>

      <Scene
        kicker="Chapter 3"
        title="The house shuffles — but signs a receipt."
        art={<SealArt />}
      >
        <p>
          Renaiss feeds your ticket number and the block fingerprint into a
          special machine (a <em>VRF</em>). It outputs one random number —
          <strong> β</strong> — plus a sealed receipt — <strong>π</strong> —
          that proves β is the only number that machine could have produced.
          A "luckier" number without a matching receipt is caught instantly,
          by anyone.
        </p>
      </Scene>

      <Scene
        kicker="Chapter 4"
        title="The number points at exactly one card."
        art={<ShelfArt index={ready ? userStep!.derivedIndex % 7 : 3} />}
      >
        <p>
          {ready ? (
            <>
              At your turn, <strong>{userStep!.eligibleCount}</strong> cards
              were still on the shelf, lined up in a fixed order. β picks
              position <strong>{userStep!.derivedIndex}</strong> — no re-rolls,
              no second opinions. Cards already ripped by earlier tickets are
              off the shelf, which is why the count matters.
            </>
          ) : (
            <>Loading your shelf…</>
          )}
        </p>
      </Scene>

      <Scene
        kicker="Chapter 5"
        title="Don't take our word for any of this."
        art={
          finalCard && checked ? (
            <div className="h-[178px] w-[132px]">
              <CardFace card={finalCard} />
            </div>
          ) : (
            <button
              onClick={runCheck}
              disabled={!ready}
              className="btn-primary h-12 px-7 text-sm"
            >
              {ready ? "Check It Right Now" : "Warming up…"}
            </button>
          )
        }
      >
        <p>
          This page just downloaded the receipt and can re-run the entire math
          in your browser — the same way an auditor would.
        </p>
        {checked && (
          <ul className="mt-3 space-y-1.5 font-body text-[14px]">
            <li data-tick className={beta ? "text-gain" : "text-loss"}>
              {beta ? "✓" : "✗"} the receipt π is genuine
            </li>
            <li data-tick className={betaOk ? "text-gain" : "text-loss"}>
              {betaOk ? "✓" : "✗"} the number β is exactly what the receipt seals
            </li>
            <li data-tick className={userStep?.matchesRecord ? "text-gain" : "text-loss"}>
              {userStep?.matchesRecord ? "✓" : "✗"} β points at{" "}
              <strong>{finalCard?.name}</strong> — the card you received
            </li>
            <li data-tick className="text-muted">
              {replay ? replay.steps.length - 1 : 0} earlier draws re-checked
              along the way ({truncateHex(lookup.txHash, 5)})
            </li>
          </ul>
        )}
      </Scene>

      <Scene
        kicker="Epilogue — the honest footnote"
        title="One lock is still being installed."
        art={<LockArt />}
      >
        <p>
          The shelf's full lineup is supposed to be sealed on-chain{" "}
          <em>before</em> the first rip (a "merkle root"), so nobody could
          quietly swap the shelf itself. That seal isn't published yet — today
          you take the lineup from the API on trust. We'd rather tell you than
          hide it.
        </p>
      </Scene>
    </div>
  );
}
