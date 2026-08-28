"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { computeLeaf, foldMerkleProof, type MerkleLeafInput } from "@/lib/merkle";
import { MERKLE_FOLD_DEMO as DATA } from "@/lib/wp-merkle-demo";
import { wpToneColor } from "@/lib/whitepaper-palette";

const GAIN = "#127a3f";
const LOSS = "#b3362c";
const GHOST = "rgba(0,0,0,0.13)";
const ROUNDS = 5;
/** Cell height per level, leaves → root — the pyramid grows as it narrows. */
const CELL_H = [10, 12, 15, 19, 24, 30];

/** 0x3fa4…9c21-style truncation — honest digits, whitepaper-compact. */
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** "Card" with its number as a small right-bottom subscript: Card₃₀. */
function CardNo({ no }: { no: number }) {
  return (
    <span className="font-display font-semibold">
      Card
      <sub className="text-[9px]">{no}</sub>
    </span>
  );
}

/** A full-width, wrapped, copyable hash line for the popover. */
function HashLine({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="mt-1.5">
      <p className="font-body text-[10.5px] uppercase tracking-wide text-black/45">
        {label}
      </p>
      <p
        className="break-all font-mono-num text-[10.5px] leading-relaxed"
        style={bad ? { color: LOSS } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

interface PopState {
  /** 0 = leaves … 5 = root. */
  level: number;
  /** "me" — the path cell; "partner" — the round-1 partner leaf. */
  which: "me" | "partner";
  x: number;
  y: number;
  /** Anchor cell's bottom — the panel flips below when short on room. */
  bottom: number;
}

/**
 * Whitepaper §4.4 — the inclusion proof as the WHOLE tournament pyramid: a
 * sample 32-card lineup (exactly five pairing rounds) drawn to scale,
 * 32 → 16 → 8 → 4 → 2 → 1. Each click plays one real keccak256 round AND
 * logs it in a fold ledger — current node hash + served sibling → parent,
 * truncated but genuine, visibly different at every level. The tamper
 * control swaps a DIFFERENT TOKEN ID into the leaf (the real attack: the
 * operator substituting a collectible that was never committed) — the leaf
 * hash changes instantly and every played round derails in red next to its
 * honest value. Reset returns to the pristine leaf. All data deterministic:
 * no randomness at render, so server and client HTML match.
 */
export function MerkleFoldDemo() {
  /** The whole widget starts folded — one line inviting the reader in. */
  const [open, setOpen] = useState(false);
  /** Rounds played so far (0 = only the leaves row is lit). */
  const [stage, setStage] = useState(0);
  const [tampered, setTampered] = useState(false);
  const [pop, setPop] = useState<PopState | null>(null);

  const tokenId = tampered ? DATA.tamperedTokenId : DATA.tokenId;

  // Both full rolling chains, computed once with the production tree code —
  // chain[0] is the leaf, chain[i] the output of round i. The honest chain
  // stays on screen while tampered, so the derailment is value-by-value.
  const chains = useMemo(() => {
    const climb = (id: string) => {
      const leaf: MerkleLeafInput = {
        tokenId: id,
        salt: DATA.salt,
        valueInUsd: DATA.valueInUsd,
      };
      const out: `0x${string}`[] = [computeLeaf(leaf)];
      for (const sibling of DATA.siblings)
        out.push(foldMerkleProof(out[out.length - 1]!, [sibling]));
      return out;
    };
    return { honest: climb(DATA.tokenId), tampered: climb(DATA.tamperedTokenId) };
  }, []);
  const chain = tampered ? chains.tampered : chains.honest;

  const complete = stage >= ROUNDS;
  const matches = complete && chain[ROUNDS]!.toLowerCase() === DATA.root.toLowerCase();
  const pristine = stage === 0 && !tampered;
  const accent = wpToneColor("inventory");
  const pathColor = tampered ? LOSS : accent;

  /** The path's cell index at each level — halving all the way up. */
  const pathAt = (level: number) => (DATA.position - 1) >> level;

  const reset = () => {
    setStage(0);
    setTampered(false);
    setPop(null);
  };

  const openPop = (
    e: React.MouseEvent<HTMLElement>,
    level: number,
    which: "me" | "partner",
  ) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPop((p) =>
      p?.level === level && p.which === which
        ? null // tap the same cell again to close
        : { level, which, x: r.left + r.width / 2, y: r.top, bottom: r.bottom },
    );
  };

  /** One pyramid row + the merge connectors above it (levels ≥ 1). */
  const row = (level: number) => {
    const count = DATA.setSize >> level;
    const lit = stage >= level;
    const myPos = pathAt(level);
    const partnerPos = level === 0 ? DATA.partner.position - 1 : -1;
    return (
      <div key={level}>
        {level > 0 && (
          // Right-angle merges: every pair of the level below folds into
          // one cell here; the path's own merge is accented once played.
          <svg
            className="block h-[12px] w-full"
            viewBox="0 0 1000 12"
            preserveAspectRatio="none"
            aria-hidden
          >
            {Array.from({ length: count }, (_, j) => {
              const below = count * 2;
              const c1 = ((2 * j + 0.5) / below) * 1000;
              const c2 = ((2 * j + 1.5) / below) * 1000;
              const mid = ((j + 0.5) / count) * 1000;
              const onPath = j === myPos && stage >= level;
              return (
                <path
                  key={j}
                  d={`M ${c1} 0 V 5 H ${c2} V 0 M ${mid} 5 V 12`}
                  fill="none"
                  stroke={onPath ? pathColor : GHOST}
                  strokeWidth={onPath ? 1.6 : 1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
        <div className="flex w-full" style={{ height: CELL_H[level] }}>
          {Array.from({ length: count }, (_, j) => {
            const isMe = j === myPos;
            const isPartner = j === partnerPos;
            const interactive = (isMe && lit) || isPartner;
            return (
              <span
                key={j}
                className="flex flex-1 items-stretch justify-center"
              >
                <button
                  {...(interactive
                    ? {
                        onClick: (e: React.MouseEvent<HTMLButtonElement>) =>
                          openPop(e, level, isMe ? "me" : "partner"),
                        title: "tap for the full values",
                      }
                    : { disabled: true, tabIndex: -1 })}
                  className="rounded-[2px]"
                  style={{
                    width: `min(78%, ${CELL_H[level]! + 8}px)`,
                    background: isMe
                      ? lit
                        ? pathColor
                        : "transparent"
                      : GHOST,
                    border: isMe
                      ? `1.5px solid ${pathColor}`
                      : isPartner
                        ? `1px solid rgba(0,0,0,0.4)`
                        : "none",
                    cursor: interactive ? "pointer" : "default",
                  }}
                  aria-label={
                    isMe
                      ? `your card's ${level === 0 ? "leaf" : `round-${level} winner`}`
                      : isPartner
                        ? "the round-1 partner"
                        : undefined
                  }
                />
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  /** One played fold in the ledger — the concrete values of level i:
   * the current node, the served sibling it pairs with, and the parent
   * they hash to. Level 0 shows the leaf's raw inputs instead. */
  const ledgerRow = (i: number) => {
    const current = i === stage;
    const label = i === 0 ? "leaf" : i === ROUNDS ? "root" : `round ${i}`;
    const bad = tampered ? { color: LOSS } : undefined;
    return (
      <div
        key={i}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-r-sm py-[3px] pl-2"
        style={{
          borderLeft: `2px solid ${current ? pathColor : "rgba(0,0,0,0.08)"}`,
          background: current ? "rgba(255,255,255,0.65)" : undefined,
        }}
      >
        <span className="min-w-[52px] shrink-0 font-body text-[10px] uppercase tracking-wide text-black/45">
          {label}
        </span>
        {i === 0 ? (
          <span className="font-mono-num text-[10.5px]">
            keccak256( id <b style={bad}>{tokenId}</b> ‖ salt {short(DATA.salt)} ‖
            value {DATA.valueInUsd} ) = <b style={bad}>{short(chain[0]!)}</b>
          </span>
        ) : (
          <span className="font-mono-num text-[10.5px]">
            <span style={bad}>{short(chain[i - 1]!)}</span>
            {" + sib "}
            {short(DATA.siblings[i - 1]!)}
            {" → "}
            <b style={bad}>{short(chain[i]!)}</b>
          </span>
        )}
        {tampered && (
          <span className="font-mono-num text-[10px] text-black/35 line-through">
            honest {short(chains.honest[i]!)}
          </span>
        )}
      </div>
    );
  };

  /** The popover body for the tapped cell. */
  const popBody = (p: PopState) => {
    if (p.which === "partner") {
      const pt = DATA.partner;
      return (
        <>
          <p className="font-display text-[12px] font-bold">
            <CardNo no={pt.position} /> — the round-1 partner
          </p>
          <p className="mt-0.5 font-mono-num text-[10.5px] text-black/60">
            tokenId {pt.tokenId} · value {pt.valueInUsd}
          </p>
          <HashLine label="its salt" value={pt.salt} />
          <HashLine label="its leaf = keccak256( tokenId ‖ salt ‖ value )" value={DATA.siblings[0]!} />
        </>
      );
    }
    if (p.level === 0) {
      return (
        <>
          <p className="font-display text-[12px] font-bold">
            <CardNo no={DATA.position} /> — your card's leaf
          </p>
          <p className="mt-0.5 font-mono-num text-[10.5px] text-black/60">
            tokenId{" "}
            {tampered ? (
              <b style={{ color: LOSS }}>{tokenId} (swapped in)</b>
            ) : (
              tokenId
            )}{" "}
            · value {DATA.valueInUsd}
          </p>
          <HashLine label="salt" value={DATA.salt} />
          <HashLine
            label="leaf = keccak256( tokenId ‖ salt ‖ value )"
            value={chain[0]!}
            bad={tampered}
          />
        </>
      );
    }
    return (
      <>
        <p className="font-display text-[12px] font-bold">
          Round {p.level}
          {p.level === ROUNDS ? " — the root" : ""}
        </p>
        <HashLine
          label={p.level === 1 ? "your leaf" : `your round-${p.level - 1} winner`}
          value={chain[p.level - 1]!}
          bad={tampered}
        />
        <HashLine
          label="paired with (served sibling — winner of the elided pairs)"
          value={DATA.siblings[p.level - 1]!}
        />
        <HashLine
          label={`keccak256( sorted pair ) → ${p.level === ROUNDS ? "ROOT" : "winner"}`}
          value={chain[p.level]!}
          bad={tampered}
        />
      </>
    );
  };

  return (
    <div
      className="my-5 rounded-md border px-4 py-4"
      style={{
        borderColor: wpToneColor("inventory", "line"),
        background: `linear-gradient(145deg, ${wpToneColor("inventory", "wash")} 0%, rgba(255,255,255,0.55) 100%)`,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="font-display text-[14px] font-bold" style={{ color: accent }}>
          Try it yourself — climb one card up to its root
        </span>
        <span className="shrink-0 font-body text-[12px] text-black/50">
          {open ? "collapse ▴" : "expand ▾"}
        </span>
      </button>
      <p className="mt-1 font-body text-[13px] leading-relaxed text-black/60">
        A sample set of 32 cards — exactly {ROUNDS} pairing rounds, the whole
        tournament on one screen. Your card is <CardNo no={DATA.position} />;
        each click plays one real keccak256 round and logs its actual hashes
        below the tree. Then swap a different token id into the leaf and watch
        every round derail. Hover or tap any lit cell for the full values.
        (Real sets commit the same way, just deeper.)
      </p>

      {open && (
        <>
          <div className="mt-3 font-mono-num text-[11.5px]">
            <span className="break-all">
              tokenId{" "}
              {tampered ? (
                <>
                  <s className="text-black/40">{DATA.tokenId}</s>{" "}
                  <mark
                    className="rounded-sm px-0.5 font-bold"
                    style={{ background: "#f6d5d1", color: LOSS }}
                  >
                    {DATA.tamperedTokenId}
                  </mark>{" "}
                  <span className="font-body" style={{ color: LOSS }}>
                    ← a different collectible swapped into the leaf
                  </span>
                </>
              ) : (
                DATA.tokenId
              )}{" "}
              · value {DATA.valueInUsd} · salt {short(DATA.salt)} ·{" "}
              <CardNo no={DATA.position} /> of {DATA.setSize}
            </span>
          </div>

          {/* the pyramid — leaves down to the root */}
          <div className="mt-4 overflow-x-auto">
            <div className="mx-auto min-w-[320px]" style={{ maxWidth: "440px" }}>
              <div className="relative mb-1 h-[16px]">
                <span
                  className="absolute whitespace-nowrap font-body text-[11px] text-black/45"
                  style={{
                    left: `${Math.min(88, Math.max(12, ((DATA.position - 0.5) / DATA.setSize) * 100))}%`,
                    transform: "translateX(-50%)",
                  }}
                >
                  <CardNo no={DATA.partner.position} /> ·{" "}
                  <CardNo no={DATA.position} /> sit here ↓
                </span>
              </div>
              {Array.from({ length: ROUNDS + 1 }, (_, level) => row(level))}
              <p className="mt-1.5 text-center font-body text-[11px] text-black/45">
                ROOT — one fingerprint for all {DATA.setSize} cards
              </p>
            </div>
          </div>

          {/* the fold ledger — one row of real values per played level */}
          <div className="mt-3 flex flex-col gap-[3px] border-t border-black/10 pt-2.5">
            {Array.from({ length: stage + 1 }, (_, i) => ledgerRow(i))}
          </div>

          {/* legend + the control row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-body text-[11px] text-black/45">
              <span style={{ color: pathColor }}>■</span> your card's path ·{" "}
              <span className="text-black/30">■</span> the rest of the set
              (computed the same way)
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {!complete && (
                <>
                  <span className="font-mono-num text-[11px] text-black/45">
                    round {stage} of {ROUNDS}
                  </span>
                  <button
                    onClick={() => setStage((s) => s + 1)}
                    className="rounded-md border border-black/25 bg-white px-3.5 py-1 font-body text-[12px] font-semibold shadow-sm hover:bg-black/[.04]"
                  >
                    {stage === ROUNDS - 1
                      ? "▶ play final round"
                      : `▶ play round ${stage + 1}`}
                  </button>
                </>
              )}
              <button
                onClick={() => setTampered((t) => !t)}
                className="rounded-md border border-black/20 bg-white/70 px-3 py-1 font-body text-[12px] font-semibold hover:bg-white"
                style={tampered ? undefined : { color: LOSS }}
              >
                {tampered ? "Restore the real token id" : "Tamper: swap the token id"}
              </button>
              <button
                onClick={reset}
                disabled={pristine}
                className="rounded-md border border-black/20 bg-white/70 px-3 py-1 font-body text-[12px] font-semibold hover:bg-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/70"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {complete && (
            <div className="mt-3 border-t border-black/10 pt-3">
              <p className="font-body text-[12px] text-black/55">
                recomputed root: round {ROUNDS}'s output, folded up from your
                card's leaf
              </p>
              <p
                className="break-all font-mono-num text-[10.5px] leading-relaxed"
                style={tampered ? { color: LOSS } : undefined}
              >
                {chain[ROUNDS]}
              </p>
              <p className="mt-1.5 font-body text-[12px] text-black/55">
                committed root: the fingerprint the set locked on-chain before
                its first rip
              </p>
              <p className="break-all font-mono-num text-[10.5px] leading-relaxed">
                {DATA.root}
              </p>
              <p
                className="mt-2 font-body text-[13px] font-semibold"
                style={{ color: matches ? GAIN : LOSS }}
              >
                {matches
                  ? `✓ the roots match: this token id, salt and value are locked inside the committed fingerprint.`
                  : `✗ the roots mismatch. The leaf hashed a different collectible (tokenId ${DATA.tamperedTokenId} instead of ${DATA.tokenId}), so the first hash changed and every round after it derailed. No choice of siblings can steer a swapped card back to the committed root.`}
              </p>
            </div>
          )}
        </>
      )}

      {/* the values popover — hover/tap, one at a time, tap-away closes */}
      {pop !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPop(null)} />
            <div
              className="fixed z-50 rounded-lg border border-black/15 bg-white/98 p-3 shadow-xl"
              style={{
                width: "min(90vw, 360px)",
                left: Math.min(
                  Math.max(8, pop.x - 180),
                  (typeof window !== "undefined" ? window.innerWidth : 1200) - 368,
                ),
                ...(pop.y > 260
                  ? { top: pop.y - 8, transform: "translateY(-100%)" }
                  : { top: pop.bottom + 8 }),
              }}
            >
              {popBody(pop)}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
