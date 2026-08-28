"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { concat, keccak256, type Hex } from "viem";
import { gsap, useGSAP } from "./gsap";
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

const EMPTY_LINEUP: LineupCard[] = [];
const EMPTY_DRAWS: DrawWitness[] = [];

type Tamper = "none" | "bitflip" | "forgeBeta" | "wrongKey" | "swapRecord" | "dropTag";

/** Flip one nibble near the front of a hex string (keeps the length). */
const flipNibble = (hex: string): string => {
  const i = 6; // inside the value, past "0x"
  const c = hex[i]!;
  const flipped = ((parseInt(c, 16) ^ 0x8) & 0xf).toString(16);
  return hex.slice(0, i) + flipped + hex.slice(i + 1);
};

const TAMPERS: {
  id: Tamper;
  label: string;
  blurb: string;
  why: string;
}[] = [
  {
    id: "bitflip",
    label: "Flip one bit of the block hash",
    blurb: "Pretend the entropy was even slightly different.",
    why: "α = keccak256(tag ‖ blockHash ‖ packId ‖ checkoutId) changes completely, so the proof π — made for the REAL α — no longer verifies. One bit is enough.",
  },
  {
    id: "forgeBeta",
    label: "Forge a “luckier” randomness β",
    blurb: "The operator swaps in a number that picks a cheaper card.",
    why: "β isn't chosen — it is derived from π. Any β that doesn't match ECVRF_proof_to_hash(π) is caught by a single hash comparison.",
  },
  {
    id: "wrongKey",
    label: "Swap the operator's key",
    blurb: "Verify against a different VRF public key.",
    why: "π only verifies under the key that produced it. A swapped key breaks the chain of custody — which is why the real key must be published and pinned.",
  },
  {
    id: "dropTag",
    label: "Drop the domain tag",
    blurb: "Hash the seed without the domain tag prefix.",
    why: "The seed is keccak256(tag ‖ blockHash ‖ packId ‖ checkoutId). The tag scopes the hash to exactly one meaning — without it (or with any other tag), α is a different value and π refuses to verify.",
  },
  {
    id: "swapRecord",
    label: "Record a different card",
    blurb: "The database claims you drew something else.",
    why: "The math is untouched — β still points at YOUR card — so the record simply disagrees with the replay, visibly, for anyone who checks.",
  },
];

function StatusTile({
  ok,
  blocked,
  title,
  detail,
}: {
  ok: boolean;
  blocked?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div
      data-tile
      className={`rounded-md border p-3 ${
        blocked
          ? "border-hairline bg-raised opacity-50"
          : ok
            ? "border-gain/40 bg-raised"
            : "border-loss/60 bg-loss/10"
      }`}
    >
      <p
        className={`font-display text-[13px] font-semibold ${
          blocked ? "text-muted" : ok ? "text-gain" : "text-loss"
        }`}
      >
        {blocked ? "— blocked upstream" : ok ? `✓ ${title}` : `✗ ${title}`}
      </p>
      <p className="mt-0.5 font-body text-[12px] text-muted">{detail}</p>
    </div>
  );
}

/**
 * /f — understanding through sabotage: every control tampers with one input
 * and re-runs the REAL verification, so a lay user can see the proof fail —
 * and exactly why it fails — before restoring it to green.
 */
export function TamperLab({
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
  const [tamper, setTamper] = useState<Tamper>("none");
  const [grind, setGrind] = useState<{ tried: number; passed: number } | null>(null);

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
  const trueCard =
    userStep && data
      ? data.lineup.find((c) => c.tokenId === userStep.pickedTokenId)
      : undefined;

  // apply the active tamper, then re-run the REAL checks
  const result = useMemo(() => {
    const blockHash =
      tamper === "bitflip" ? flipNibble(lookup.blockHash) : lookup.blockHash;
    const randomness =
      tamper === "forgeBeta"
        ? keccak256(lookup.witness.randomness as Hex) +
          lookup.witness.randomness.slice(66) // keep 64-byte length
        : lookup.witness.randomness;
    const publicKey =
      tamper === "wrongKey" ? flipNibble(vrfKey.publicKeyHex) : vrfKey.publicKeyHex;
    const recordedTokenId =
      tamper === "swapRecord" && data
        ? (data.lineup.find((c) => c.tokenId !== lookup.witness.resolvedTokenId)
            ?.tokenId ?? lookup.witness.resolvedTokenId)
        : lookup.witness.resolvedTokenId;

    // "dropTag" recomputes α WITHOUT the domain-separation prefix — the
    // production formula is keccak256(tag ‖ blockHash ‖ packId ‖ checkoutId).
    const alpha =
      tamper === "dropTag"
        ? keccak256(
            concat([
              blockHash as Hex,
              lookup.pack.onChainPackId as Hex,
              `0x${lookup.checkoutId.toString(16).padStart(64, "0")}` as Hex,
            ]),
          )
        : deriveSeed(blockHash, lookup.pack.onChainPackId, lookup.checkoutId);
    const beta = ecvrfVerifyHex(publicKey, alpha, lookup.witness.proof);
    const piValid = beta !== null;
    const betaMatches =
      piValid && beta.toLowerCase() === randomness.toLowerCase();
    const cardMatches = userStep
      ? userStep.pickedTokenId === recordedTokenId
      : false;

    return { blockHash, randomness, publicKey, recordedTokenId, alpha, piValid, betaMatches, cardMatches };
  }, [tamper, lookup, vrfKey, data, userStep]);

  const allOk = result.piValid && result.betaMatches && result.cardMatches;

  // shake the board whenever a tamper lands
  useGSAP(
    () => {
      if (tamper === "none") return;
      gsap.fromTo(
        "[data-board]",
        { x: 0 },
        { keyframes: [{ x: -6 }, { x: 6 }, { x: -3 }, { x: 3 }, { x: 0 }], duration: 0.35 },
      );
      gsap.fromTo(
        "[data-tile]",
        { autoAlpha: 0.4 },
        { autoAlpha: 1, stagger: 0.06, duration: 0.25 },
      );
    },
    { scope, dependencies: [tamper] },
  );

  const { contextSafe } = useGSAP({ scope });
  const runGrinder = contextSafe(async () => {
    setGrind({ tried: 0, passed: 0 });
    const alpha = deriveSeed(lookup.blockHash, lookup.pack.onChainPackId, lookup.checkoutId);
    const TOTAL = 1000;
    let tried = 0;
    let passed = 0;
    const batch = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          for (let i = 0; i < 50 && tried < TOTAL; i++, tried++) {
            const fake = new Uint8Array(80);
            crypto.getRandomValues(fake);
            const fakeHex = `0x${Array.from(fake, (b) => b.toString(16).padStart(2, "0")).join("")}`;
            if (ecvrfVerifyHex(vrfKey.publicKeyHex, alpha, fakeHex) !== null) passed++;
          }
          setGrind({ tried, passed });
          resolve();
        }, 0);
      });
    while (tried < 1000) await batch();
  });

  if (!ready) {
    return (
      <div className="mx-auto flex h-40 max-w-3xl items-center justify-center px-6">
        <span className="font-body text-[13px] text-muted">
          Preparing the lab — verifying {data?.draws.length ?? "…"} proofs…
        </span>
      </div>
    );
  }

  const activeTamper = TAMPERS.find((t) => t.id === tamper);

  return (
    <div ref={scope} className="mx-auto max-w-3xl px-6 pb-20">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* tamper controls */}
        <div className="w-full shrink-0 md:w-[280px]">
          <h3 className="mb-2 font-display text-sm font-semibold text-muted">
            Break something
          </h3>
          <div className="flex flex-col gap-2">
            {TAMPERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTamper(tamper === t.id ? "none" : t.id)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  tamper === t.id
                    ? "border-loss/70 bg-loss/10"
                    : "border-hairline bg-surface hover:border-white/25"
                }`}
              >
                <p className="font-display text-[13px] font-semibold">{t.label}</p>
                <p className="mt-0.5 font-body text-[12px] text-muted">{t.blurb}</p>
              </button>
            ))}
            <button
              onClick={() => setTamper("none")}
              disabled={tamper === "none"}
              className="btn-secondary h-9 text-[13px] disabled:opacity-40"
            >
              Restore the Truth
            </button>
          </div>
        </div>

        {/* verification board */}
        <div className="min-w-0 flex-1">
          <h3 className="mb-2 font-display text-sm font-semibold text-muted">
            Live verification — re-run on every change
          </h3>
          <div
            data-board
            className={`rounded-lg border p-4 ${
              allOk ? "border-gain/40" : "border-loss/60"
            } bg-surface`}
          >
            <div className="mb-3 flex flex-wrap gap-2 font-mono-num text-[11px] text-muted">
              <span className={tamper === "bitflip" ? "text-loss" : ""}>
                blockHash {truncateHex(result.blockHash, 5)}
              </span>
              <span>· checkoutId {lookup.checkoutId}</span>
              <span className={tamper === "wrongKey" ? "text-loss" : ""}>
                · PK {truncateHex(result.publicKey, 5)}
              </span>
              <span className={tamper === "forgeBeta" ? "text-loss" : ""}>
                · β {truncateHex(result.randomness, 5)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <StatusTile
                ok={result.piValid}
                title="proof π verifies"
                detail="ECVRF_verify(PK, keccak256(tag ‖ blockHash ‖ packId ‖ checkoutId), π)"
              />
              <StatusTile
                ok={result.betaMatches}
                blocked={!result.piValid}
                title="β matches the proof"
                detail="proof_to_hash(π) equals the published randomness"
              />
              <StatusTile
                ok={result.cardMatches}
                blocked={!result.piValid || !result.betaMatches}
                title={`the record says ${trueCard?.name ?? "…"}`}
                detail={`keccak256(β) mod ${userStep!.eligibleCount} = ${userStep!.derivedIndex} → compared to the recorded card`}
              />
            </div>
            <p
              className={`mt-3 font-body text-[13px] ${
                allOk ? "text-gain" : "text-loss"
              }`}
            >
              {allOk
                ? "All green — untampered reality."
                : `Broken: ${activeTamper?.why}`}
            </p>
          </div>

          {/* the grinder */}
          <div className="mt-5 rounded-lg border border-hairline bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-[13px] font-semibold">
                  The forgery grinder
                </p>
                <p className="font-body text-[12px] text-muted">
                  Throw 1,000 random fake proofs at the verifier — live, in your
                  browser.
                </p>
              </div>
              <button
                onClick={() => void runGrinder()}
                disabled={grind !== null && grind.tried < 1000}
                className="btn-ghost h-9 px-4 text-[13px]"
              >
                {grind === null
                  ? "Grind 1,000 Forgeries"
                  : grind.tried < 1000
                    ? `Grinding… ${grind.tried}`
                    : "Grind Again"}
              </button>
            </div>
            {grind && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-white/40 transition-[width] duration-150"
                    style={{ width: `${(grind.tried / 1000) * 100}%` }}
                  />
                </div>
                <p
                  className={`mt-2 font-mono-num text-[13px] ${
                    grind.passed === 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {grind.passed} / {grind.tried} forged proofs accepted
                  {grind.tried >= 1000 && grind.passed === 0 && (
                    <span className="font-body text-muted">
                      {" "}
                      — that's the point.
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
