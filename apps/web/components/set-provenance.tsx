"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "./gsap";
import { getSetProvenance } from "@/lib/api/client";
import type { SetProvenanceData } from "@/lib/api/types";
import { USE_MOCK_DATA } from "@/lib/config";
import { getOnChainMerkleRoot } from "@/lib/onchain";
import { recomputeRoot, type MerkleRecompute } from "@/lib/merkle";
import { truncateHex } from "@/lib/format";
import { DataChip } from "./provenance";

/**
 * Build provenance for one set, shown inside its expanded row:
 * 1. Genesis — the exact inputs of the Fair Set Algorithm build.
 * 2. Lineup commitment — the on-chain availability root, plus a one-click
 *    recomputation that hashes every collectible token id back to the root.
 *
 * `genesisOnly` renders just the genesis block — for a still-sealed set (live
 * or upcoming), we show how the lineup was built without revealing the lineup
 * or its size (the commitment section counts and hashes every card).
 */
export function SetProvenance({
  packId,
  setId,
  genesisOnly = false,
}: {
  packId: string;
  setId: number;
  genesisOnly?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  // undefined = loading; null = the set has no published build record.
  const [data, setData] = useState<SetProvenanceData | null | undefined>();
  // The root committed on-chain — the comparison target when readable
  // (needs NEXT_PUBLIC_RPC_URL + NEXT_PUBLIC_TVM_ADDRESS); null falls back
  // to the API-served root. Mock packs have no chain to ask.
  const [onchainRoot, setOnchainRoot] = useState<string | null>(null);
  const [result, setResult] = useState<MerkleRecompute | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setResult(null);
    setOnchainRoot(null);
    getSetProvenance(packId, setId).then((d) => {
      if (!cancelled) setData(d);
    });
    // In API mode packId IS the bytes32 on-chain id the contract keys on.
    if (!USE_MOCK_DATA) {
      getOnChainMerkleRoot(packId, setId).then((root) => {
        if (!cancelled) setOnchainRoot(root);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [packId, setId]);

  useGSAP(
    () => {
      if (!result) return;
      gsap.fromTo(
        "[data-merkle-step]",
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          stagger: 0.18,
          duration: 0.35,
          ease: "power2.out",
        },
      );
    },
    { scope, dependencies: [result] },
  );

  if (data === undefined) {
    return (
      <div className="mb-4 animate-pulse rounded-md border border-hairline bg-raised p-4">
        <span className="font-body text-[12px] text-muted">
          Loading set provenance…
        </span>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mb-4 rounded-md border border-hairline bg-raised p-4">
        <span className="font-body text-[12px] text-muted">
          No build record has been published for this set.
        </span>
      </div>
    );
  }

  const g = data.genesis;
  // The chain is the commitment; the served root is display/fallback. When
  // both are readable they must agree — a divergence means the operator's
  // runtime recomputation drifted from what was committed.
  if (onchainRoot && data.merkleRoot && onchainRoot !== data.merkleRoot) {
    console.warn(
      `verify: served merkleRoot diverges from the on-chain commitment (pack ${packId}, set ${setId})`,
    );
  }
  const publishedRoot = onchainRoot ?? data.merkleRoot;
  const publishedSource: "onchain" | "api" =
    onchainRoot || USE_MOCK_DATA ? "onchain" : "api";
  const matches =
    result &&
    publishedRoot !== null &&
    result.root.toLowerCase() === publishedRoot.toLowerCase();

  const run = () => {
    setComputing(true);
    // yield a frame so the button state paints before ~1k keccaks
    setTimeout(() => {
      setResult(recomputeRoot(data.leaves));
      setComputing(false);
    }, 30);
  };

  return (
    <div ref={scope} className="mb-4 flex flex-col gap-3">
      {/* genesis — legacy sets predate the packing log and have none */}
      {g === null ? (
        <div className="rounded-md border border-hairline bg-raised p-4">
          <p className="mb-1 font-display text-[13px] font-semibold">
            Set genesis
          </p>
          <p className="font-body text-[12px] text-muted">
            This set predates the packing log — no build record was published,
            so its genesis inputs cannot be shown.
          </p>
        </div>
      ) : (
      <div className="rounded-md border border-hairline bg-raised p-4">
        <p className="mb-2 font-display text-[13px] font-semibold">
          Set genesis — how this lineup was built
        </p>
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="algorithm"
            value={g.algorithm}
            source="api"
            href="/whitepaper#fair-set-adaptive-algorithm"
            detail="The fair-set-adaptive algorithm that formed this lineup, as recorded with the run. Open-source, with the exact build inputs published so anyone can re-run it and reproduce this lineup."
          />
          <DataChip
            label="trigger"
            href="/whitepaper#lim-cadence"
            value={g.triggerTime.replace("T", " ").slice(0, 19) + "Z"}
            source="api"
            detail="When the build job fired. A published every-N-blocks cadence is the roadmap (whitepaper §10.3)."
          />
          <DataChip
            label="block"
            href="/whitepaper#reproducibility"
            value={`#${g.blockNumber.toLocaleString()}`}
            source="onchain"
            detail="The finalized checkpoint block that seeds the build. Its hash and number are both seed inputs; a finalized block can never be reorged out."
          />
          <DataChip
            label="blockHash"
            href="/whitepaper#reproducibility"
            value={truncateHex(g.blockHash, 5)}
            full={g.blockHash}
            source="onchain"
            detail="Hash of the genesis block — one of the seed inputs."
          />
          <DataChip
            label="packId"
            href="/whitepaper#reproducibility"
            value={truncateHex(g.onChainPackId, 5)}
            full={g.onChainPackId}
            source="onchain"
            detail="The pack's 32-byte on-chain id — a seed input, so two builds anchored to the same block can never share a seed."
          />
          <DataChip
            label="set #"
            href="/whitepaper#reproducibility"
            value={`#${setId}`}
            source="api"
            detail="The set number being built — the final seed input, alongside the pack id and block reference."
          />
          <DataChip
            label="seed"
            href="/whitepaper#reproducibility"
            value={truncateHex(g.seed, 5)}
            full={g.seed}
            source="local"
            detail="keccak256(tag ‖ blockHash ‖ blockNumber ‖ packId ‖ set #) — the deterministic RNG seed; re-running the algorithm with it reproduces this exact lineup."
          />
          <DataChip
            label="attempts"
            href="/whitepaper#fair-set-adaptive-algorithm"
            value={String(g.attempts)}
            source="api"
            detail="Builds tried before one satisfied the EV band and every tier min/max."
          />
        </div>
      </div>
      )}

      {/* lineup commitment — hidden while the set is sealed, since it counts
          and hashes every card in the lineup (and for legacy sets that serve
          no lineup at all). */}
      {!genesisOnly && data.leaves.length > 0 && (
      <div className="rounded-md border border-hairline bg-raised p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-[13px] font-semibold">
            Lineup commitment — hash the whole set back to its root
          </p>
          <button
            onClick={run}
            disabled={computing}
            className="btn-secondary h-8 whitespace-nowrap px-4 text-[12px]"
          >
            {computing
              ? "Hashing…"
              : result
                ? "Recompute Again"
                : `Recompute Root (${data.leaves.length} cards)`}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <DataChip
            label="published root"
            href="/whitepaper#pinning"
            value={publishedRoot ? truncateHex(publishedRoot, 6) : "—"}
            {...(publishedRoot ? { full: publishedRoot } : {})}
            source={publishedSource}
            detail={
              publishedSource === "onchain"
                ? "The set's availability root, read from the vending-machine contract's merkleRoots on-chain — commits every card before the first rip. Any lineup edit changes it."
                : "The set's availability root as served by the API (the on-chain read is not configured) — commits every card before the first rip. Any lineup edit changes it."
            }
          />
        </div>

        {result && (
          <ol className="mt-3 flex flex-col gap-2">
            <li
              data-merkle-step
              className="rounded-md border border-hairline bg-surface p-3"
            >
              <p className="font-display text-[12px] font-semibold">
                1 · Hash every card into a leaf
              </p>
              <p className="mt-1 font-mono-num text-[11.5px] text-muted">
                leafᵢ = keccak256( abi.encode(tokenIdᵢ, saltᵢ, valueᵢ) ) —{" "}
                {result.leafCount} leaves, lineup sorted by token ID ascending
              </p>
              <p className="mt-1 break-all font-mono-num text-[11px] text-muted">
                leaf₀ {truncateHex(result.sampleLeaves[0] ?? "0x", 8)} · leaf₁{" "}
                {truncateHex(result.sampleLeaves[1] ?? "0x", 8)} · leaf₂{" "}
                {truncateHex(result.sampleLeaves[2] ?? "0x", 8)} · …
              </p>
            </li>
            <li
              data-merkle-step
              className="rounded-md border border-hairline bg-surface p-3"
            >
              <p className="font-display text-[12px] font-semibold">
                2 · Pair and hash upward
              </p>
              <p className="mt-1 font-mono-num text-[11.5px] text-muted">
                parent = keccak256( sorted(left, right) ) — OpenZeppelin
                SimpleMerkleTree, nodes per depth:
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono-num text-[11px]">
                {result.levelSizes.map((n, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-muted">
                      {n}
                    </span>
                    {i < result.levelSizes.length - 1 && (
                      <span className="text-white/25">→</span>
                    )}
                  </span>
                ))}
              </div>
            </li>
            <li
              data-merkle-step
              className={`rounded-md border p-3 ${
                matches
                  ? "border-gain/50 bg-surface"
                  : "border-loss/60 bg-loss/10"
              }`}
            >
              <p
                className={`font-display text-[12px] font-semibold ${matches ? "text-gain" : "text-loss"}`}
              >
                3 ·{" "}
                {matches
                  ? "✓ Derived root equals the published root"
                  : "✗ Root mismatch — the lineup diverges from the commitment"}
              </p>
              <p className="mt-1 break-all font-mono-num text-[11px] text-muted">
                derived {result.root}
              </p>
            </li>
          </ol>
        )}
      </div>
      )}
    </div>
  );
}
