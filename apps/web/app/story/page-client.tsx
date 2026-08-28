"use client";

import { ProofStory } from "@/components/proof-story";
import { RipLoader } from "@/components/rip-loader";
import { useVerification } from "@/components/use-verification";

/** /e — the proof as a plain-language story. */
export function PageClientE() {
  const v = useVerification();

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 pb-4 pt-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          How your card was really picked.
        </h1>
        <p className="mt-2 font-body text-[14px] text-muted">
          No hex, no jargon — the whole story in five chapters, told with your
          rip's real numbers. Scroll.
        </p>
        <div className="mt-6 max-w-md">
          <RipLoader v={v} autoDemo />
        </div>
      </section>

      {v.lookup && v.vrfKey && (
        <ProofStory key={v.lookup.txHash} lookup={v.lookup} vrfKey={v.vrfKey} />
      )}
    </main>
  );
}
