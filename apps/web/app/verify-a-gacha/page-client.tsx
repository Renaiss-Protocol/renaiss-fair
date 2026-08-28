"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MachineGallery } from "@/components/machine-gallery";
import { FormationChart } from "@/components/formation-chart";
import { SourceLegend } from "@/components/provenance";
import { listPacks } from "@/lib/api/client";
import { resolveActiveSet } from "@/lib/api/renaiss/verify/get-active-set";
import type { PackSummary } from "@/lib/api/types";

/**
 * /verify-a-gacha — pick a gacha machine, then see how it's formed. The machines
 * are the packs the verify API lists (every pack with verifiable history), or
 * the fixtures in mock mode. The gallery chooses one (?machine=<onChainPackId>)
 * and the chart drills into its real, replayable formation: each packing run
 * flows to the set it committed.
 */
export function BehindTheRipClient() {
  const params = useSearchParams();
  const [machines, setMachines] = useState<PackSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPacks()
      .then((packs) => {
        if (!cancelled) setMachines(packs);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ?machine= names a pack by its on-chain id; an unknown or absent one falls
  // back to the first pack the API listed.
  const wanted = params.get("machine");
  const machine =
    machines?.find((m) => m.onChainPackId === wanted) ?? machines?.[0] ?? null;

  // ?root= is the shop's deep link — the merkle root its Fair panel shows.
  // It resolves server-side to whichever machine's ACTIVE set carries that
  // root and lands on its row (?machine=&set=); a superseded root resolves
  // to nothing, and says so rather than guessing at history.
  const root = params.get("root");
  if (root !== null) return <RootRedirect root={root} />;

  return (
    <main>
      <section className="mx-auto w-full max-w-[1600px] px-4 pt-10 text-center sm:px-6 sm:pt-14 lg:px-10">
        {/* Just under the home hero's 40/56px — this is a page title, so it
            reads at the same scale without outranking the landing headline. */}
        <h1 className="font-display text-[34px] font-bold leading-[1.06] tracking-tight md:text-[48px]">
          Verify a gacha.
        </h1>
        <p className="mx-auto mt-2 max-w-2xl font-body text-[14px] text-muted">
          Every gacha machine is formed by the same VRF pipeline: its sets are{" "}
          <span className="text-white">packed</span> from a seeded selection run,
          then committed as fixed <span className="text-white">sets</span> anyone
          can replay. Pick a machine to inspect its formation.
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <span className="font-body text-[13px] text-muted">
            Each run flows to the set it committed — hover any value to see where
            it comes from.
          </span>
          <SourceLegend />
        </div>
      </section>

      {/* horizontal machine picker */}
      {machines && machine && (
        <div className="mx-auto mt-8 w-full max-w-[1600px] px-4 sm:px-6 lg:px-10">
          <MachineGallery
            machines={machines}
            selected={machine.onChainPackId}
          />
        </div>
      )}

      {/* the selected machine's formation, full width */}
      <div className="mt-10">
        {failed ? (
          <p className="px-6 py-16 text-center font-body text-[13px] text-muted">
            Could not load the pack list.
          </p>
        ) : machines?.length === 0 ? (
          // The list endpoint only serves packs with verifiable history, so an
          // empty answer is a real state, not a slow one.
          <p className="px-6 py-16 text-center font-body text-[13px] text-muted">
            No pack has a verifiable formation yet.
          </p>
        ) : !machine ? (
          <p className="px-6 py-16 text-center font-body text-[13px] text-muted">
            Loading the machines…
          </p>
        ) : (
          <FormationChart
            key={machine.onChainPackId}
            packId={machine.packId}
            onChainPackId={machine.onChainPackId}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The ?root= landing: look the root up, then swap the URL for the machine and
 * set it names. `replace`, not `push` — the root URL is a hop, and Back
 * should return to the shop, not to a lookup that would immediately re-fire.
 */
function RootRedirect({ root }: { root: string }) {
  const router = useRouter();
  const [state, setState] = useState<"resolving" | "stale" | "error">(
    "resolving",
  );

  useEffect(() => {
    // A malformed root can't be any set's commitment — same dead end as a
    // superseded one, no request needed.
    if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
      setState("stale");
      return;
    }
    let cancelled = false;
    resolveActiveSet(root)
      .then((loc) => {
        if (cancelled) return;
        if (loc === null) {
          setState("stale");
          return;
        }
        // No trailing slash: the static export serves verify-a-gacha.html,
        // so on GitHub Pages the slashed form 404s on a full load — and this
        // URL lands in the address bar, where a reload is a full load.
        router.replace(
          `/verify-a-gacha?machine=${loc.machine}&set=${loc.setId}`,
        );
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [root, router]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-16 text-center sm:px-6 sm:pt-24">
      {state === "resolving" ? (
        <p className="font-body text-[14px] text-muted">
          Finding the live set this merkle root commits…
        </p>
      ) : (
        <>
          <h1 className="font-display text-[28px] font-bold leading-[1.1] tracking-tight md:text-[36px]">
            {state === "stale"
              ? "This root is no longer live."
              : "Could not look up this root."}
          </h1>
          <p className="mx-auto mt-3 max-w-xl font-body text-[14px] leading-relaxed text-muted">
            {state === "stale" ? (
              <>
                No machine's active set carries this merkle root any more — a
                newer set has superseded it, or its set sold out. A sold-out
                set's full lineup and draw proofs appear in its machine's
                history once revealed.
              </>
            ) : (
              <>The lookup failed — the verify API may be unreachable.</>
            )}
          </p>
          <span className="mt-2 block break-all font-mono-num text-[12px] text-white/40">
            {root}
          </span>
          <button
            type="button"
            onClick={() => router.replace("/verify-a-gacha")}
            className="mt-8 rounded-full border border-hairline px-5 py-2 font-display text-[13px] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.05]"
          >
            Browse the machines
          </button>
        </>
      )}
    </main>
  );
}
