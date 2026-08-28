"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gsap } from "./gsap";
import {
  DEFAULT_PACK_ID,
  getVrfPublicKey,
  listSets,
  lookupRip,
  lookupTx,
} from "@/lib/api/client";
import type { RipLookup } from "@/lib/api/renaiss/verify/get-rip";
import { apiErrorMessage } from "@/lib/api/renaiss/error-messages";
import { USE_MOCK_DATA } from "@/lib/config";
import { TX_HASH_RE } from "@/lib/format";
import type {
  SetSummary,
  TxLookupResult,
  VrfPublicKey,
} from "@/lib/api/types";

/**
 * Shared verification state for the /a and /b pages. The looked-up tx lives
 * in ?tx= so route switches and shared links restore the whole verification.
 *
 * `eagerSets` loads the set list (and VRF key) on mount so the page
 * can offer browsing before any tx is verified.
 */
export function useVerification({ eagerSets = false } = {}) {
  const searchParams = useSearchParams();
  const urlTx = searchParams.get("tx");

  // The verify() below awaits ~1s of fetches; if the user navigates to
  // another route meanwhile, the continuation must NOT touch state or the
  // router — a stale router.replace(pathname) from an unmounted page used to
  // yank users back and forth between routes.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The rip verification payload — fixture or live /verify/rip. */
  const [rip, setRip] = useState<RipLookup | null>(null);
  /** Fixture-only legacy shape, still fed to flow-diagram's ProofMachine. */
  const [lookup, setLookup] = useState<TxLookupResult | null>(null);
  const [vrfKey, setVrfKey] = useState<VrfPublicKey | null>(null);
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!eagerSets) return;
    let cancelled = false;
    Promise.all([getVrfPublicKey(), listSets(DEFAULT_PACK_ID)]).then(
      ([key, packs]) => {
        if (cancelled) return;
        setVrfKey((k) => k ?? key);
        setSets((s) => s ?? packs);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eagerSets]);

  const verify = async (txHash: string, opts?: { fromUrl?: boolean }) => {
    setLoading(true);
    setError(null);
    let result: RipLookup | null = null;
    try {
      result = await lookupRip(txHash);
    } catch (e) {
      if (!mountedRef.current) return;
      setLoading(false);
      setError(
        apiErrorMessage(e) ??
          `Could not verify this transaction (${
            e instanceof Error ? e.message : String(e)
          }). Check the hash and try again.`,
      );
      return;
    }
    if (!mountedRef.current) return;
    if (!result) {
      setLoading(false);
      setError(
        USE_MOCK_DATA
          ? "Transaction not found in the demo dataset — try the demo rip."
          : "Transaction not found — check the hash, or try the demo rip.",
      );
      return;
    }
    // Fixture rips also hydrate the legacy consumers (flow-diagram's
    // ProofMachine); a live rip has no fixture record and lookupTx is null.
    const [legacy, key, packs] = await Promise.all([
      lookupTx(txHash),
      getVrfPublicKey(),
      listSets(result.pack.packId),
    ]);
    if (!mountedRef.current) return;
    setRip(result);
    setLookup(legacy);
    setVrfKey(key);
    setSets(packs);
    setExpandedId(result.setId);
    setLoading(false);
    // keep the tx in the URL so routes share it (and it's shareable) —
    // always read the CURRENT pathname, never the closure's stale one.
    // Native replaceState (Next syncs useSearchParams from it) rather than
    // router.replace: window.location.pathname already carries basePath,
    // which router.replace would prepend a second time.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?tx=${result.txHash}`,
    );
    if (!opts?.fromUrl) {
      // settle the eye on the facts panel once it mounts (pages without one,
      // e.g. /c, handle their own focus)
      gsap.delayedCall(0.15, () => {
        if (!document.querySelector("#facts")) return;
        gsap.to(window, {
          scrollTo: { y: "#facts", offsetY: 24 },
          duration: 0.7,
          ease: "power2.inOut",
          overwrite: "auto",
        });
      });
    }
  };

  // Restore from ?tx= — covers direct links and A↔B route switches.
  useEffect(() => {
    if (
      urlTx &&
      TX_HASH_RE.test(urlTx) &&
      !loading &&
      rip?.txHash.toLowerCase() !== urlTx.toLowerCase()
    ) {
      void verify(urlTx, { fromUrl: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTx]);

  return {
    loading,
    error,
    rip,
    lookup,
    vrfKey,
    sets,
    expandedId,
    setExpandedId,
    verify,
    urlTx,
  };
}
