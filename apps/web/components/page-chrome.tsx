/** Small shared page chrome. */

import Link from "next/link";

export function RecipeFooter() {
  return (
    <footer className="mx-auto max-w-3xl px-6 pb-16 text-center">
      <p className="font-body text-[12px] text-muted">
        Verification recipe: α = keccak256(tag ‖ blockHash ‖ packId ‖
        checkoutId) · ECVRF (RFC 9381, edwards25519-SHA512-ELL2) · card =
        keccak256(β) mod remaining, without replacement. Full recipe in the{" "}
        <Link
          href="/whitepaper"
          className="underline decoration-white/30 underline-offset-2 hover:text-white"
        >
          whitepaper
        </Link>
        .
      </p>
    </footer>
  );
}
