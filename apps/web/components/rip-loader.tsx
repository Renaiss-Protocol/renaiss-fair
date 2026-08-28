"use client";

import { useEffect, useState } from "react";
import { DEMO_TX_HASH } from "@/lib/api/client";
import { TX_HASH_RE } from "@/lib/format";
import type { useVerification } from "./use-verification";

/** Compact tx-hash loader shared by the proof-visualization pages. */
export function RipLoader({
  v,
  autoDemo = false,
}: {
  v: ReturnType<typeof useVerification>;
  /** Load the demo rip on mount when no ?tx= is present. */
  autoDemo?: boolean;
}) {
  const [tx, setTx] = useState(v.urlTx ?? "");
  const valid = TX_HASH_RE.test(tx.trim());

  useEffect(() => {
    if (v.urlTx) setTx(v.urlTx);
  }, [v.urlTx]);

  useEffect(() => {
    if (autoDemo && !v.urlTx && !v.lookup && !v.loading) {
      setTx(DEMO_TX_HASH);
      void v.verify(DEMO_TX_HASH, { fromUrl: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDemo]);

  return (
    <div>
      <div
        className={`flex h-11 items-center gap-2 rounded-md border bg-raised pl-3 pr-1.5 ${
          v.error ? "border-loss" : "border-hairline focus-within:border-white/30"
        }`}
      >
        <input
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && valid && !v.loading && void v.verify(tx.trim())
          }
          placeholder="Transaction hash — 0x…"
          spellCheck={false}
          className="w-full bg-transparent font-mono-num text-[13px] text-white outline-none placeholder:text-muted"
        />
        <button
          onClick={() => void v.verify(tx.trim())}
          disabled={!valid || v.loading}
          className="btn-primary h-8 shrink-0 px-4 text-[13px]"
        >
          {v.loading ? "Loading…" : "Verify"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {v.error && <span className="font-body text-[12px] text-loss">{v.error}</span>}
        <button
          onClick={() => {
            setTx(DEMO_TX_HASH);
            void v.verify(DEMO_TX_HASH);
          }}
          disabled={v.loading}
          className="btn-ghost h-7 whitespace-nowrap px-3 text-[12px]"
        >
          Use Demo Rip
        </button>
      </div>
    </div>
  );
}
