"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "./gsap";
import { getSetDrawHistory, getSetLineup } from "@/lib/api/client";
import type {
  DrawWitness,
  LineupCard,
  TxLookupResult,
  VrfPublicKey,
} from "@/lib/api/types";
import { deriveSeed, ecvrfVerifyHex, SEED_DOMAIN_TAG } from "@/lib/verify";
import { useReplay } from "@/lib/use-replay";
import { truncateHex } from "@/lib/format";
import { CardFace } from "./card-face";
import { DataChip } from "./provenance";

const EMPTY_LINEUP: LineupCard[] = [];
const EMPTY_DRAWS: DrawWitness[] = [];

function Connector({ kind }: { kind: "merge2" | "merge3" | "straight" }) {
  const stroke = "rgba(255,255,255,.28)";
  const p = (d: string) => (
    <path d={d} stroke={stroke} strokeWidth={1.5} fill="none" vectorEffect="non-scaling-stroke" />
  );
  return (
    <svg
      data-edge
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="mx-auto h-7 w-full max-w-[520px]"
      aria-hidden
    >
      {kind === "straight" && p("M50 0 L50 28")}
      {kind === "merge2" && (
        <>
          {p("M28 0 C28 16 50 12 50 28")}
          {p("M72 0 C72 16 50 12 50 28")}
        </>
      )}
      {kind === "merge3" && (
        <>
          {p("M18 0 C18 18 50 12 50 28")}
          {p("M50 0 L50 28")}
          {p("M82 0 C82 18 50 12 50 28")}
        </>
      )}
    </svg>
  );
}

function OpNode({
  children,
  side,
}: {
  children: React.ReactNode;
  /** Optional side-input chips rendered flanking the operator. */
  side?: [React.ReactNode, React.ReactNode];
}) {
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-2 sm:gap-3">
      {side?.[0]}
      {side && <span className="hidden h-px w-4 bg-white/25 sm:block" />}
      <span className="whitespace-nowrap rounded-full border border-white/25 bg-raised px-5 py-2 font-mono-num text-[13px] font-semibold">
        {children}
      </span>
      {side && <span className="hidden h-px w-4 bg-white/25 sm:block" />}
      {side?.[1]}
    </div>
  );
}

/**
 * /d — the proof as a machine: a vertical dataflow that lights up stage by
 * stage, from the on-chain inputs down to the card. Same real crypto as /c,
 * different mental model: WHAT FEEDS WHAT.
 */
export function ProofMachine({
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
  const [ran, setRan] = useState(false);

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
  const alpha = deriveSeed(lookup.blockHash, lookup.pack.onChainPackId, lookup.checkoutId);
  const beta = ready
    ? ecvrfVerifyHex(vrfKey.publicKeyHex, alpha, lookup.witness.proof)
    : null;
  const finalCard =
    userStep && data
      ? data.lineup.find((c) => c.tokenId === userStep.pickedTokenId)
      : undefined;

  useGSAP(
    () => {
      if (!ready || !scope.current) return;
      gsap.set("[data-stage]", { autoAlpha: 0, y: 8 });
      gsap.set("[data-edge] path", { drawSVG: "0%" });

      const tl = gsap.timeline({ defaults: { ease: "power2.out" }, delay: 0.2 });
      const stages = gsap.utils.toArray<HTMLElement>("[data-stage]", scope.current);
      const edges = gsap.utils.toArray<SVGSVGElement>("[data-edge]", scope.current);

      stages.forEach((stage, i) => {
        tl.to(stage, { autoAlpha: 1, y: 0, duration: 0.32 });
        const values = stage.querySelectorAll("[data-chip-value]");
        values.forEach((el) => {
          const text = el.textContent ?? "";
          tl.to(
            el,
            {
              duration: 0.55,
              scrambleText: { text, chars: "0123456789abcdef", speed: 0.8 },
            },
            "<0.05",
          );
        });
        const edge = edges[i];
        if (edge) {
          tl.to(edge.querySelectorAll("path"), {
            drawSVG: "100%",
            duration: 0.3,
            ease: "power1.inOut",
          });
        }
      });
      tl.call(() => setRan(true));
    },
    { scope, dependencies: [ready], revertOnUpdate: true },
  );

  const { contextSafe } = useGSAP({ scope });
  const rerun = contextSafe(() => {
    // rebuild by re-running the effect's timeline: cheapest is a full restart
    gsap.set("[data-stage]", { autoAlpha: 0 });
    gsap.set("[data-edge] path", { drawSVG: "0%" });
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    const stages = gsap.utils.toArray<HTMLElement>("[data-stage]", scope.current!);
    const edges = gsap.utils.toArray<SVGSVGElement>("[data-edge]", scope.current!);
    stages.forEach((stage, i) => {
      tl.to(stage, { autoAlpha: 1, y: 0, duration: 0.32 });
      stage.querySelectorAll("[data-chip-value]").forEach((el) => {
        const text = el.textContent ?? "";
        tl.to(
          el,
          { duration: 0.55, scrambleText: { text, chars: "0123456789abcdef", speed: 0.8 } },
          "<0.05",
        );
      });
      const edge = edges[i];
      if (edge)
        tl.to(edge.querySelectorAll("path"), { drawSVG: "100%", duration: 0.3 });
    });
  });

  if (!ready) {
    return (
      <div className="mx-auto flex h-40 max-w-3xl items-center justify-center px-6">
        <span className="font-body text-[13px] text-muted">
          Feeding the machine — verifying {data?.draws.length ?? "…"} proofs…
        </span>
      </div>
    );
  }

  return (
    <div ref={scope} className="mx-auto max-w-3xl px-6 pb-20">
      <div className="mb-5 flex items-center justify-between">
        <p className="font-body text-[13px] text-muted">
          Follow the pipes: two public inputs at the top, your card at the
          bottom, nothing else in between. Hover any value for its source.
        </p>
        {ran && (
          <button onClick={rerun} className="btn-ghost h-8 shrink-0 px-4 text-[12px]">
            Run Again
          </button>
        )}
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-6">
        {/* inputs */}
        <div data-stage className="flex flex-wrap items-center justify-center gap-3">
          <DataChip
            label="tag"
            value={SEED_DOMAIN_TAG}
            source="api"
            detail="Published domain-separation constant — scopes the seed hash to pack draws (formula v1)."
          />
          <DataChip
            label="blockHash"
            value={truncateHex(lookup.blockHash, 6)}
            full={lookup.blockHash}
            source="onchain"
            detail="Block hash of your permitFund tx — entropy fixed by BSC consensus."
          />
          <DataChip
            label="checkoutId"
            value={String(lookup.checkoutId)}
            source="onchain"
            detail="CheckoutSuccess.checkoutIds[] — your draw's sequence number."
          />
        </div>
        <Connector kind="merge3" />

        <div data-stage>
          <OpNode>keccak256(tag ‖ ‖ )</OpNode>
        </div>
        <Connector kind="straight" />

        <div data-stage className="flex justify-center">
          <DataChip
            label="α"
            value={truncateHex(alpha, 8)}
            full={alpha}
            source="local"
            detail="The VRF input — recomputed on this page from the two inputs above."
          />
        </div>
        <Connector kind="straight" />

        <div data-stage>
          <OpNode
            side={[
              <DataChip
                key="pk"
                label="PK"
                value={truncateHex(vrfKey.publicKeyHex, 4)}
                full={vrfKey.publicKeyHex}
                source="api"
                detail="Operator's published VRF verification key."
              />,
              <DataChip
                key="pi"
                label="π"
                value={truncateHex(lookup.witness.proof, 4)}
                full={lookup.witness.proof}
                source="api"
                detail="pack_draw_records.proof — the 80-byte ECVRF proof."
              />,
            ]}
          >
            ECVRF_verify
          </OpNode>
        </div>
        <Connector kind="straight" />

        <div data-stage className="flex flex-wrap items-center justify-center gap-2">
          <DataChip
            label="β"
            value={truncateHex(beta ?? "0x00", 6)}
            full={beta ?? undefined}
            source="local"
            detail="The randomness, derived from the proof in your browser."
          />
          <span className={`font-body text-[12px] ${beta && beta.toLowerCase() === lookup.witness.randomness.toLowerCase() ? "text-gain" : "text-loss"}`}>
            {beta && beta.toLowerCase() === lookup.witness.randomness.toLowerCase()
              ? "✓ equals the stored randomness"
              : "✗ mismatch with stored randomness"}
          </span>
        </div>
        <Connector kind="straight" />

        <div data-stage>
          <OpNode
            side={[
              <DataChip
                key="lineup"
                label="lineup"
                value={`${data!.lineup.length} cards`}
                source="api"
                detail="Set lineup from the public API, sorted by token ID ASC."
              />,
              <DataChip
                key="hist"
                label="history"
                value={`${replay!.steps.length - 1} draws`}
                source="api"
                detail="Prior draws in this set — each one's π verified during the replay."
              />,
            ]}
          >
            replay without replacement
          </OpNode>
        </div>
        <Connector kind="straight" />

        <div data-stage className="flex justify-center">
          <DataChip
            label="remaining"
            value={String(userStep!.eligibleCount)}
            source="local"
            detail="Cards still available at your draw — lineup minus the replayed picks."
          />
        </div>
        <Connector kind="straight" />

        <div data-stage>
          <OpNode>keccak256(β) mod {userStep!.eligibleCount}</OpNode>
        </div>
        <Connector kind="straight" />

        <div data-stage className="flex justify-center">
          <DataChip
            label="index"
            value={String(userStep!.derivedIndex)}
            source="local"
            detail="The one slot your randomness can select — computed on this page."
          />
        </div>
        <Connector kind="straight" />

        <div data-stage className="flex flex-col items-center gap-3">
          {finalCard && (
            <div className="h-[178px] w-[132px]">
              <CardFace card={finalCard} />
            </div>
          )}
          <p
            className={`font-body text-[13px] ${
              userStep!.matchesRecord ? "text-gain" : "text-loss"
            }`}
          >
            {userStep!.matchesRecord
              ? `✓ ${finalCard?.name} — matches the recorded draw`
              : "✗ diverges from the recorded draw"}
          </p>
        </div>
      </div>
    </div>
  );
}
