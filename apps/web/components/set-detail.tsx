"use client";

import { useEffect, useState } from "react";
import { getSetDrawHistory, getSetLineup } from "@/lib/api/client";
import type { DrawWitness, LineupCard } from "@/lib/api/types";
import { ReplayArena } from "./replay-arena";

/**
 * Data-fetching body shared by both variants: loads the lineup + draw history
 * and renders the replay stage. No section chrome.
 */
export function SetDetailBody({
  packId,
  onChainPackId,
  setId,
  targetCheckoutId,
  vrfPublicKeyHex,
}: {
  packId: string;
  /** bytes32 TVM pack id — part of the VRF seed preimage. */
  onChainPackId: string;
  setId: number;
  targetCheckoutId?: number | undefined;
  /** Fallback key for draws without their own publicKeyHex (mock mode). */
  vrfPublicKeyHex?: string | undefined;
}) {
  const [lineup, setLineup] = useState<LineupCard[] | null>(null);
  const [draws, setDraws] = useState<DrawWitness[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLineup(null);
    setDraws(null);
    Promise.all([
      getSetLineup(packId, setId),
      getSetDrawHistory(packId, setId),
    ]).then(([cards, history]) => {
      if (!cancelled) {
        setLineup(cards);
        setDraws(history);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [packId, setId]);

  if (!lineup || !draws) {
    return (
      <div className="flex h-40 animate-pulse items-center justify-center rounded-lg border border-hairline bg-surface">
        <span className="font-body text-[13px] text-muted">Loading lineup…</span>
      </div>
    );
  }

  // Legacy pre-snapshot sets serve no lineup — there is nothing to replay.
  if (lineup.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-hairline bg-surface">
        <span className="font-body text-[13px] text-muted">
          This set predates the published verification data — its lineup and
          draw history are not replayable.
        </span>
      </div>
    );
  }

  // Sets are never small in practice (hundreds of cards), so the
  // matrix-based arena is the only replay UI. It sits in the same titled
  // panel as the provenance sections above (and the Packing tab's grids),
  // so token matrices wrap at the identical width on both tabs.
  return (
    <div className="mt-4 rounded-md border border-hairline bg-raised p-4">
      <p className="mb-2 font-display text-[13px] font-semibold">
        Draw replay — every draw recomputed from its proof
      </p>
      <ReplayArena
        lineup={lineup}
        draws={draws}
        targetCheckoutId={targetCheckoutId}
        vrfPublicKeyHex={vrfPublicKeyHex}
        onChainPackId={onChainPackId}
      />
    </div>
  );
}
