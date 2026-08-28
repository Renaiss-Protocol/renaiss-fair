"use client";

import { useEffect, useState } from "react";
import type { DrawWitness, LineupCard } from "./api/types";
import { replaySet, type ReplayResult } from "./verify";

/**
 * Runs the full replay + ECVRF verification off the render path. For large
 * sets this is hundreds of ed25519 verifications (~1–2ms each), so the
 * UI paints a "verifying…" state first instead of blocking on mount.
 * Returns null while computing.
 */
export function useReplay(
  vrfPublicKeyHex: string | undefined,
  onChainPackId: string,
  lineup: LineupCard[],
  draws: DrawWitness[],
  targetCheckoutId?: number,
): ReplayResult | null {
  const [replay, setReplay] = useState<ReplayResult | null>(null);

  useEffect(() => {
    setReplay(null);
    let cancelled = false;
    const t = setTimeout(() => {
      const result = replaySet(
        vrfPublicKeyHex,
        onChainPackId,
        lineup,
        draws,
        targetCheckoutId,
      );
      if (!cancelled) setReplay(result);
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vrfPublicKeyHex, onChainPackId, lineup, draws, targetCheckoutId]);

  return replay;
}
