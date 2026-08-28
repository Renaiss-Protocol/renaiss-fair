"use client";

import { RipLoader } from "@/components/rip-loader";
import { TamperLab } from "@/components/tamper-lab";
import { useVerification } from "@/components/use-verification";

/** /f — understanding through sabotage. */
export function PageClientF() {
  const v = useVerification();

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 pb-8 pt-14">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Try to cheat.
        </h1>
        <p className="mt-2 font-body text-[14px] text-muted">
          The strongest reason to trust a proof is watching it refuse to lie.
          Tamper with any input — the verification below re-runs the real
          cryptography and fails, loudly. Then restore the truth.
        </p>
        <div className="mt-6 max-w-md">
          <RipLoader v={v} autoDemo />
        </div>
      </section>

      {v.lookup && v.vrfKey && (
        <TamperLab key={v.lookup.txHash} lookup={v.lookup} vrfKey={v.vrfKey} />
      )}
    </main>
  );
}
