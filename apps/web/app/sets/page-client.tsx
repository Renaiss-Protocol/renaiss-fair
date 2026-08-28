"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getVrfPublicKey, listPacks, listSets } from "@/lib/api/client";
import {
  fetchSetsPage,
  SETS_API_LIMIT,
} from "@/lib/api/renaiss/verify/get-sets";
import { fetchSetDetail } from "@/lib/api/renaiss/verify/get-sets-detail";
import { USE_MOCK_DATA } from "@/lib/config";
import type {
  PackSummary,
  SetSummary,
  VrfPublicKey,
} from "@/lib/api/types";
import { SourceLegend } from "@/components/provenance";
import { PackSelector, PackSelectorSkeleton } from "@/components/pack-selector";
import { SETS_PAGE_SIZE, SetRows } from "@/components/set-rows";

/**
 * /sets — the whole-set browser (think Pop Mart's "whole set" view): pick a
 * pack, then every one of its sets as a row, newest first, expand to see the
 * full lineup and replay its draw history. No verify input here — proving a
 * rip lives on /verify-a-rip.
 *
 * API call order mirrors the Packing tab: (1) /verify/packs, auto-select the
 * first pack, (2) /verify/sets pages on demand for the pager, then each
 * listed set's /verify/sets/set detail prefetches in the background (newest
 * first, PREFETCH_CONCURRENCY at a time, queue retired on pack switch).
 * Expanding a row fetches its detail immediately — fetchSetDetail dedupes
 * against an in-flight prefetch, so priority never doubles a request.
 */

/** How many set details prefetch concurrently in the background. A completed
 * set's reveal is the heavy payload (~0.25–0.5 MB) — a slot pair keeps the
 * cache warming without saturating the connection. */
const PREFETCH_CONCURRENCY = 2;

/** One pack's fetched sets: the true set count (from the list endpoint's
 * pagination) plus each fetched page, keyed by offset (one API page IS one
 * UI page — both are 10 rows). Carries its packId so state written for one
 * pack can never be filed under another. */
interface ApiPackSets {
  packId: string;
  total: number;
  pages: Map<number, SetSummary[]>;
}

/**
 * API-mode set history: fetch /verify/sets pages on demand for the pager and
 * keep each listed set's detail warming in the background.
 */
function useApiSets(selectedPackId: string | null) {
  const [sets, setSets] = useState<ApiPackSets | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetched history per pack — switching back is instant.
  const cacheRef = useRef(new Map<string, ApiPackSets>());
  // Bumped on every pack switch/unmount: the stale prefetch queue stops
  // pumping (fetched details stay in the module cache — they're immutable).
  const genRef = useRef(0);
  const queueRef = useRef<{ packId: string; setId: number }[]>([]);
  const activeRef = useRef(0);
  // List pages currently in flight ("packId:offset") — a fast pager
  // double-click must not fetch the same page twice.
  const inflightRef = useRef(new Set<string>());

  // Keep the cache holding the latest state, guarded by the state's OWN
  // packId (right after a switch this effect fires once with the previous
  // pack's sets still in state).
  useEffect(() => {
    if (sets && sets.packId === selectedPackId)
      cacheRef.current.set(sets.packId, sets);
  }, [sets, selectedPackId]);

  const pump = useCallback((gen: number) => {
    while (activeRef.current < PREFETCH_CONCURRENCY) {
      const next = queueRef.current.shift();
      if (!next) return;
      activeRef.current++;
      fetchSetDetail(next.packId, next.setId)
        .catch(() => {
          // Background failures stay silent — the cache evicts, an expand
          // retries and surfaces the error on the row.
        })
        .finally(() => {
          activeRef.current--;
          if (gen === genRef.current) pump(gen);
        });
    }
  }, []);

  /** Fetch one list page if absent, then queue its sets' details. */
  const ensureOffset = useCallback(
    (packId: string, offset: number) => {
      const key = `${packId}:${offset}`;
      if (
        cacheRef.current.get(packId)?.pages.has(offset) ||
        inflightRef.current.has(key)
      )
        return;
      inflightRef.current.add(key);
      const gen = genRef.current;
      fetchSetsPage(packId, offset)
        .finally(() => inflightRef.current.delete(key))
        .then((page) => {
          if (gen !== genRef.current) return;
          setSets((prev) => {
            const base =
              (prev?.packId === packId ? prev : null) ??
              cacheRef.current.get(packId) ??
              { packId, total: 0, pages: new Map<number, SetSummary[]>() };
            if (base.pages.has(offset)) return prev;
            const pages = new Map(base.pages);
            pages.set(offset, page.sets);
            return { packId, total: page.total, pages };
          });
          queueRef.current.push(
            ...page.sets.map((s) => ({ packId, setId: s.setId })),
          );
          pump(gen);
        })
        .catch((e: unknown) => {
          if (gen === genRef.current)
            setError(e instanceof Error ? e.message : String(e));
        });
    },
    [pump],
  );

  // Pack switch: retire the old prefetch queue, restore any cached history,
  // and make sure the first page is (being) fetched.
  useEffect(() => {
    if (USE_MOCK_DATA || selectedPackId === null) return;
    genRef.current++;
    queueRef.current = [];
    setError(null);
    setSets(cacheRef.current.get(selectedPackId) ?? null);
    ensureOffset(selectedPackId, 0);
    return () => {
      genRef.current++;
      queueRef.current = [];
    };
  }, [selectedPackId, ensureOffset]);

  return {
    // Only the selected pack's state is ever exposed — in the render between
    // a switch and its effect, `sets` still holds the previous pack's data.
    sets: sets && sets.packId === selectedPackId ? sets : null,
    error,
    ensureOffset,
  };
}

export function PageClientB() {
  // ?pack=<id> selects a pack; ?set=<id> deep-links one of its sets expanded
  // (e.g. from the Packing tab).
  const searchParams = useSearchParams();
  const linkedSet = searchParams.get("set");
  const linkedPack = searchParams.get("pack");
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [vrfKey, setVrfKey] = useState<VrfPublicKey | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [uiPage, setUiPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(
    linkedSet !== null && /^\d+$/.test(linkedSet) ? Number(linkedSet) : null,
  );
  // API-mode deep-link: the target set's page must be found server-side.
  // Sets list newest-first with near-contiguous ids, so the page is
  // ESTIMATED from the newest id and corrected at most once (gaps can only
  // move the target to an earlier page).
  const deepLinkRef = useRef<{ setId: number; attempts: number } | null>(
    linkedSet !== null && /^\d+$/.test(linkedSet)
      ? { setId: Number(linkedSet), attempts: 0 }
      : null,
  );

  const api = useApiSets(USE_MOCK_DATA ? null : selectedPackId);

  useEffect(() => {
    let cancelled = false;
    listPacks()
      .then((list) => {
        if (cancelled) return;
        setPacks(list);
        // Honor ?pack= when it names a real pack, else default to the first.
        setSelectedPackId(
          list.some((p) => p.packId === linkedPack)
            ? linkedPack
            : (list[0]?.packId ?? null),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setPacksError(e instanceof Error ? e.message : String(e));
      });
    // The global demo key backs mock replays only — API-mode draws each
    // carry their own publicKeyHex.
    if (USE_MOCK_DATA) {
      getVrfPublicKey().then((key) => {
        if (!cancelled) setVrfKey(key);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mock mode: the whole set list arrives in one call.
  useEffect(() => {
    if (!USE_MOCK_DATA || selectedPackId === null) return;
    let cancelled = false;
    setSets(null);
    listSets(selectedPackId).then((list) => {
      if (!cancelled) setSets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPackId]);

  // API-mode deep-link resolution: once fetched pages exist, land on the
  // page holding the target set — or estimate, fetch, and retry once.
  useEffect(() => {
    const link = deepLinkRef.current;
    if (USE_MOCK_DATA || !link || !api.sets || selectedPackId === null) return;
    for (const [offset, rows] of api.sets.pages) {
      if (rows.some((s) => s.setId === link.setId)) {
        deepLinkRef.current = null;
        setUiPage(offset / SETS_API_LIMIT);
        return;
      }
    }
    const newest = api.sets.pages.get(0)?.[0];
    if (newest && link.setId <= newest.setId) {
      const guess = Math.floor(
        (newest.setId - link.setId) / SETS_API_LIMIT,
      );
      // Attempt 0 tries the estimate; skipped ids can only shift the target
      // toward page 0, so attempt 1 tries the page before it. An unfetched
      // candidate is requested and awaited (attempts advance only once a
      // fetched candidate actually missed).
      while (link.attempts < 2) {
        const candidate = Math.max(0, guess - link.attempts);
        const offset = candidate * SETS_API_LIMIT;
        if (!api.sets.pages.has(offset)) {
          setUiPage(candidate);
          api.ensureOffset(selectedPackId, offset);
          return;
        }
        link.attempts++;
      }
    }
    // Unknown set (or both estimates missed) — give up collapsed.
    deepLinkRef.current = null;
    setExpandedId(null);
    setUiPage(0);
  }, [api, api.sets, selectedPackId]);

  const selectPack = (packId: string) => {
    if (packId === selectedPackId) return;
    setSelectedPackId(packId);
    setUiPage(0);
    // A ?set= deep link belongs to the previously selected pack.
    setExpandedId(null);
    deepLinkRef.current = null;
    // Keep the chosen pack in the URL so the view is shareable.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?pack=${packId}`,
    );
  };

  const gotoPage = (p: number) => {
    setUiPage(p);
    if (!USE_MOCK_DATA && selectedPackId !== null)
      api.ensureOffset(selectedPackId, p * SETS_API_LIMIT);
  };

  const selectedPack =
    packs?.find((p) => p.packId === selectedPackId) ?? null;
  const apiRows = api.sets?.pages.get(uiPage * SETS_API_LIMIT);

  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 pb-2 pt-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">Sets.</h1>
        <p className="mt-2 max-w-2xl font-body text-[14px] text-muted">
          Pick a pack, then browse its sets. Every set is a fixed lineup
          committed before its first rip. Expand any set to see the whole
          lineup and replay its draw history — every proof re-verified in
          your browser.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <p className="font-body text-[13px] text-muted">
            Walk each step yourself — hover any value to see where it comes
            from.
          </p>
          <SourceLegend />
        </div>
      </section>

      <div className="mt-6">
        {packs && selectedPackId !== null ? (
          <PackSelector
            packs={packs}
            selectedPackId={selectedPackId}
            onSelect={selectPack}
          />
        ) : packsError === null ? (
          <PackSelectorSkeleton />
        ) : null}
      </div>

      {packsError !== null ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-loss">
          Could not load the pack list ({packsError}). Reload to retry.
        </div>
      ) : USE_MOCK_DATA ? (
        sets && vrfKey && selectedPack ? (
          <SetRows
            // Remount per pack — pagination and row animations restart from
            // the new pack's first page instead of inheriting the previous
            // pack's.
            key={selectedPack.packId}
            sets={sets}
            expandedId={expandedId}
            onToggle={setExpandedId}
            packId={selectedPack.packId}
            onChainPackId={selectedPack.onChainPackId}
            vrfPublicKeyHex={vrfKey.publicKeyHex}
          />
        ) : (
          <div className="mx-auto mt-12 flex h-32 max-w-5xl animate-pulse items-center justify-center px-6">
            <span className="font-body text-[13px] text-muted">
              Loading sets…
            </span>
          </div>
        )
      ) : api.error !== null ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-loss">
          Could not load this pack&rsquo;s sets ({api.error}). Reload to retry.
        </div>
      ) : api.sets === null || !selectedPack ? (
        <div className="mx-auto max-w-5xl animate-pulse px-6 py-12 text-center font-body text-[13px] text-muted">
          Loading sets…
        </div>
      ) : api.sets.total === 0 ? (
        <div className="mx-auto max-w-5xl px-6 py-12 text-center font-body text-[13px] text-muted">
          No verifiable sets have been published for this pack yet.
        </div>
      ) : (
        <SetRows
          key={selectedPack.packId}
          sets={apiRows ?? []}
          expandedId={expandedId}
          onToggle={setExpandedId}
          packId={selectedPack.packId}
          onChainPackId={selectedPack.onChainPackId}
          pagination={{
            page: uiPage,
            pageCount: Math.ceil(api.sets.total / SETS_PAGE_SIZE),
            onGoto: gotoPage,
            loading: apiRows === undefined,
          }}
        />
      )}
    </main>
  );
}
