"use client";

import { Hero } from "@/components/hero";
import { ProofWalkthrough } from "@/components/proof-walkthrough";
import { RecipeFooter } from "@/components/page-chrome";
import { SourceLegend } from "@/components/provenance";
import { useVerification } from "@/components/use-verification";

/**
 * /verify-a-rip, the landing experience. The "Every rip. Provably yours." hero
 * feeds straight into the interactive prover (whitepaper §"Verify it yourself"):
 * the user executes each derivation, from on-chain facts to their final card,
 * with a provenance hover on every datum.
 */
export function TraceARipClient() {
  const v = useVerification();

  return (
    <main>
      <Hero
        onVerify={(tx) => void v.verify(tx)}
        loading={v.loading}
        error={v.error}
        prefill={v.urlTx ?? undefined}
      />

      {v.rip ? (
        <>
          <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6">
            <p className="font-body text-[13px] text-muted">
              Walk each step yourself, hover any value to see where it comes
              from.
            </p>
            <SourceLegend />
          </div>
          <ProofWalkthrough key={v.rip.txHash} rip={v.rip} />
        </>
      ) : (
        <RecipeFooter />
      )}
    </main>
  );
}
