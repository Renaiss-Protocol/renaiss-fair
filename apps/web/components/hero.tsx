"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP, SplitText } from "./gsap";
import { DEMO_TX_HASH } from "@/lib/api/client";
import { TX_HASH_RE } from "@/lib/format";

export function Hero({
  onVerify,
  loading,
  error,
  prefill,
}: {
  onVerify: (txHash: string) => void;
  loading: boolean;
  error: string | null;
  /** Restored from the URL (?tx=), fills the input without submitting. */
  prefill?: string | undefined;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(prefill ?? "");
  const valid = TX_HASH_RE.test(tx.trim());

  useEffect(() => {
    if (prefill) setTx(prefill);
  }, [prefill]);

  useGSAP(
    () => {
      // split only the plain text, chars inside a background-clip:text
      // gradient span lose the clipped background, so the gradient part
      // animates as a whole element instead
      const split = SplitText.create("[data-split]", { type: "words, chars" });
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from(split.chars, {
          yPercent: 60,
          autoAlpha: 0,
          stagger: 0.02,
          duration: 0.6,
        })
        .from("[data-grad]", { y: 22, autoAlpha: 0, duration: 0.55 }, "-=0.35")
        .from("[data-sub]", { y: 16, autoAlpha: 0, duration: 0.5 }, "-=0.25")
        .from("[data-form]", { y: 16, autoAlpha: 0, duration: 0.5 }, "-=0.3")
        .fromTo(
          "[data-underline]",
          { scaleX: 0, transformOrigin: "left center" },
          { scaleX: 1, duration: 0.7, ease: "power2.inOut" },
          "-=0.5",
        );
    },
    { scope },
  );

  // Shake the input on a failed lookup.
  useGSAP(
    () => {
      if (error && inputWrapRef.current) {
        gsap.fromTo(
          inputWrapRef.current,
          { x: 0 },
          {
            keyframes: [{ x: -8 }, { x: 8 }, { x: -5 }, { x: 5 }, { x: 0 }],
            duration: 0.4,
          },
        );
      }
    },
    { scope, dependencies: [error] },
  );

  const submit = () => valid && !loading && onVerify(tx.trim());

  return (
    <div
      ref={scope}
      className="mx-auto max-w-3xl px-6 pb-16 pt-20 text-center md:pt-28"
    >
      <h1 className="font-display text-[40px] font-bold leading-[1.04] tracking-tight md:text-[56px]">
        <span data-split>Every rip.</span>{" "}
        <span data-grad className="relative inline-block">
          <span className="text-gradient">Provably yours.</span>
          {/* underline anchored to the gradient words so it always spans them */}
          <span
            data-underline
            className="absolute -bottom-3 left-0 block h-[3px] w-full rounded-full bg-grad-brand"
          />
        </span>
      </h1>
      <p
        data-sub
        className="mx-auto mt-5 max-w-xl font-body text-[15px] text-muted"
      >
        Paste the transaction hash of your pack rip. We replay the draw with the
        exact production math, the ECVRF proof is verified right here in your
        browser, card by card, until your pull is reached.
      </p>

      <div data-form className="mx-auto mt-8 max-w-xl">
        <div
          ref={inputWrapRef}
          className={`flex h-[52px] items-center gap-2 rounded-md border bg-raised pl-4 pr-2 ${
            error ? "border-loss" : "border-hairline focus-within:border-grad-2"
          }`}
        >
          <input
            value={tx}
            onChange={(e) => setTx(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Transaction hash (0x…)"
            spellCheck={false}
            className="w-full bg-transparent font-mono-num text-sm text-white outline-none placeholder:text-muted"
          />
          <button
            onClick={submit}
            disabled={!valid || loading}
            className="btn-primary h-9 shrink-0 px-6 text-sm"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-center gap-3">
          {error ? (
            <p className="font-body text-[13px] text-loss">{error}</p>
          ) : (
            <p className="font-body text-[13px] text-muted">
              No rip handy? Watch one get verified:
            </p>
          )}
          {/* Fills the field but stops there: verifying is the reader's move,
              so the demo lands them on the same starting line as their own rip
              rather than skipping the step being demonstrated. */}
          <button
            onClick={() => setTx(DEMO_TX_HASH)}
            disabled={loading}
            className="btn-ghost h-8 whitespace-nowrap px-4 text-[13px]"
          >
            Use Demo Rip
          </button>
        </div>
      </div>
    </div>
  );
}
