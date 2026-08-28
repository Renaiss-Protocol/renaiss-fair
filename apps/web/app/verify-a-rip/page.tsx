import { Suspense } from "react";
import type { Metadata } from "next";
import { TraceARipClient } from "./page-client";

export const metadata: Metadata = {
  title: "Verify a Rip — Renaiss",
  description:
    "Paste your pack rip's transaction hash and replay the draw step by step — the ECVRF proof is verified in your browser.",
};

export default function TraceARipPage() {
  return (
    <Suspense fallback={null}>
      <TraceARipClient />
    </Suspense>
  );
}
