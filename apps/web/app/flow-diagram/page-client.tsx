"use client";

import { ProofMachine } from "@/components/proof-machine";
import { RipLoader } from "@/components/rip-loader";
import { SourceLegend } from "@/components/provenance";
import { useVerification } from "@/components/use-verification";

/** /d — the proof as a dataflow machine. */
export function PageClientD() {
  const v = useVerification();

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 pb-8 pt-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          The machine.
        </h1>
        <p className="mt-2 font-body text-[14px] text-muted">
          Your card is not chosen — it is manufactured. Two public inputs go in
          the top; one card comes out the bottom. Watch the values flow.
        </p>
        <div className="mt-3">
          <SourceLegend />
        </div>
        <div className="mt-6">
          <RipLoader v={v} autoDemo />
        </div>
      </section>

      {v.lookup && v.vrfKey && (
        <ProofMachine key={v.lookup.txHash} lookup={v.lookup} vrfKey={v.vrfKey} />
      )}
    </main>
  );
}
