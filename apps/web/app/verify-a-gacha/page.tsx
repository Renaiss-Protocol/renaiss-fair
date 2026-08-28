import { Suspense } from "react";
import type { Metadata } from "next";
import { BehindTheRipClient } from "./page-client";

export const metadata: Metadata = {
  title: "Verify a Gacha — Renaiss",
  description:
    "See how a pack is formed: every VRF-seeded packing run and the set it committed, replayable in your browser.",
};

export default function BehindTheRipPage() {
  return (
    <Suspense fallback={null}>
      <BehindTheRipClient />
    </Suspense>
  );
}
