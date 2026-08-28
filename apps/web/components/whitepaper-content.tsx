/**
 * Whitepaper content. Structure and prose adapted from the "Gacha VRF
 * Whitepaper" draft (content reference), aligned to the shipped
 * implementation: ECVRF-EDWARDS25519-SHA512-ELL2 (RFC 9381, suite 0x04),
 * 80-byte proofs, tagged seed keccak256(tag ‖ blockHash ‖ packId ‖ checkoutId),
 * "sets" naming. Rendered only inside the light /whitepaper theme.
 */
import Link from "next/link";
import { wpToneColor, type WpTone } from "@/lib/whitepaper-palette";
import { HeadingAnchor, SecLink } from "./wp-anchor";
import { MerkleFoldDemo } from "./merkle-fold-demo";

export type { WpTone } from "@/lib/whitepaper-palette";

export interface WpTocEntry {
  id: string;
  num: string;
  title: string;
  group: string;
  tone?: WpTone;
  subs: { id: string; title: string }[];
}

export const WP_TOC: WpTocEntry[] = [
  {
    id: "abstract",
    num: "◦",
    title: "Abstract",
    group: "Front matter",
    subs: [],
  },
  {
    id: "introduction",
    num: "1",
    title: "Introduction",
    group: "Front matter",
    subs: [
      { id: "trust-problem", title: "The trust problem" },
      { id: "fairness-requires", title: "What fairness requires" },
      { id: "contributions", title: "Contributions" },
    ],
  },
  {
    id: "model",
    num: "2",
    title: "Model and goals",
    group: "Front matter",
    subs: [
      { id: "actors", title: "Actors & trust" },
      { id: "threat-model", title: "Threat model" },
      { id: "security-goals", title: "Security goals" },
    ],
  },
  {
    id: "overview",
    num: "3",
    title: "Protocol overview",
    group: "Front matter",
    subs: [
      { id: "one-pull", title: "The three pillars" },
      { id: "commit-timeline", title: "The commitment timeline" },
    ],
  },
  {
    id: "fair-set-adaptive-algorithm",
    num: "4",
    title: "Fair Set Algorithm",
    group: "Pillar I · Construction",
    tone: "algorithm",
    subs: [
      { id: "config-odds", title: "Published constraints" },
      { id: "adaptive-construction", title: "Constrained construction" },
      { id: "acceptance-predicate", title: "Acceptance predicate" },
      { id: "reproducibility", title: "Deterministic construction" },
      { id: "implementation-agnostic", title: "Implementation agnostic" },
    ],
  },
  {
    id: "set-generation",
    num: "5",
    title: "Inventory and commitment",
    group: "Pillar II · Inventory",
    tone: "inventory",
    subs: [
      { id: "inventory-model", title: "Collectible inventory" },
      { id: "composition-selection", title: "Composition and selection" },
      { id: "packing", title: "Packing a set" },
      { id: "pinning", title: "On-chain Merkle commitment" },
      { id: "set-record", title: "Public set record" },
    ],
  },
  {
    id: "draw",
    num: "6",
    title: "Verifiable draw",
    group: "Pillar III · Draw",
    tone: "draw",
    subs: [
      { id: "post-commit-seed", title: "Post-commit seed" },
      { id: "ecvrf-proof", title: "ECVRF proof" },
      { id: "slot-mapping", title: "Slot mapping" },
    ],
  },
  {
    id: "ledger",
    num: "7",
    title: "Verifiable audit trail",
    group: "Pillar III · Draw",
    tone: "draw",
    subs: [],
  },
  {
    id: "verify",
    num: "8",
    title: "Verify your own pull",
    group: "Verification",
    subs: [
      { id: "ordering", title: "Checkout order" },
      {
        id: "one-seed-one-collectible",
        title: "One seed, one collectible",
      },
      { id: "procedure", title: "The verification procedure" },
    ],
  },
  {
    id: "security",
    num: "9",
    title: "Security analysis",
    group: "Analysis",
    subs: [],
  },
  {
    id: "limitations",
    num: "10",
    title: "Limitations",
    group: "Analysis",
    subs: [
      { id: "lim-beacon", title: "Randomness beacon" },
      { id: "lim-entry", title: "Permissionless entry" },
      { id: "lim-cadence", title: "Activation cadence" },
      { id: "lim-reorg", title: "Chain reorgs" },
    ],
  },
  {
    id: "conclusion",
    num: "11",
    title: "Conclusion",
    group: "End matter",
    subs: [],
  },
  {
    id: "appendices",
    num: "A-E",
    title: "Appendices",
    group: "End matter",
    subs: [],
  },
  {
    id: "references",
    num: "※",
    title: "References",
    group: "End matter",
    subs: [],
  },
];

/* ── section cross-references ───────────────────────────────────────────── */

// "2.1" → "actors", etc., derived from the TOC (sub N of section S = S.N).
const SEC_IDS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const e of WP_TOC) {
    if (!/^\d+$/.test(e.num)) continue;
    map[e.num] = e.id;
    e.subs.forEach((s, i) => {
      map[`${e.num}.${i + 1}`] = s.id;
    });
  }
  return map;
})();

/** §-reference that jumps to the section. `label` overrides the "§n" text. */
function Sec({ n, label }: { n: string; label?: string }) {
  const id = SEC_IDS[n];
  if (!id) return <>{label ?? `§${n}`}</>;
  return <SecLink id={id}>{label ?? `§${n}`}</SecLink>;
}

/** External link for References entries; same underline treatment as SecLink. */
function RefLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-black underline decoration-black/25 decoration-1 underline-offset-2 transition-colors hover:decoration-black/70"
    >
      {children}
    </a>
  );
}

/* ── typographic helpers (light theme) ──────────────────────────────────── */

function H2({
  id,
  num,
  tone,
  children,
}: {
  id: string;
  num: string;
  tone?: WpTone;
  children: React.ReactNode;
}) {
  const accent = tone ? wpToneColor(tone) : undefined;
  return (
    <h2
      id={id}
      data-wp-section={id}
      className="group mb-4 mt-16 scroll-mt-28 border-b border-black/10 pb-3 font-display text-[26px] font-bold tracking-tight first:mt-0"
      style={
        accent
          ? { borderBottomColor: wpToneColor(tone!, "line"), color: accent }
          : undefined
      }
    >
      <span
        className="mr-3 font-mono-num text-[15px] font-semibold text-black/35"
        style={accent ? { color: accent } : undefined}
      >
        {num}
      </span>
      {children}
      <HeadingAnchor id={id} />
    </h2>
  );
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="group mb-2 mt-8 scroll-mt-28 font-display text-[17px] font-semibold"
    >
      {children}
      <HeadingAnchor id={id} />
    </h3>
  );
}

/* Shared surface treatment for boxed content. Border and glow are both always
   painted; the --wp-* alpha tokens (set per data-wp-surface mode) decide which
   is visible. Untoned surfaces glow in neutral graphite. */
function wpSurfaceStyle(tone?: WpTone): React.CSSProperties {
  const solid = tone ? wpToneColor(tone, "solid") : "#3a3a40";
  const line = tone ? wpToneColor(tone, "line") : "rgba(0,0,0,0.12)";
  return {
    borderColor: `color-mix(in srgb, ${line} var(--wp-line-a, 0%), transparent)`,
    boxShadow: `0 0 20px -4px color-mix(in srgb, ${solid} var(--wp-glow-inner-a, 5%), transparent)`,
  };
}

/* Italicized pillar takeaway in the abstract; echoes the pillar-card pills
   without pulling a highlight into the prose. */
function AbstractMark({ children }: { children: React.ReactNode }) {
  return <em className="font-medium">{children}</em>;
}

function PillarSection({
  tone,
  label,
  highlight,
  summary,
  children,
}: {
  tone: WpTone;
  label: string;
  highlight: string;
  summary: string;
  children: React.ReactNode;
}) {
  const solid = wpToneColor(tone, "solid");
  return (
    <section
      className="my-14 rounded-2xl border px-5 pb-7 pt-5 sm:px-6 sm:pb-8"
      style={{
        background: `linear-gradient(145deg, ${wpToneColor(tone, "wash")} 0%, rgba(255,255,255,0.5) 100%)`,
        borderColor: `color-mix(in srgb, ${wpToneColor(tone, "line")} var(--wp-line-a, 0%), transparent)`,
        boxShadow: [
          // hairline top highlight keeps the edge crisp without a border
          "inset 0 1px 0 rgba(255,255,255,0.55)",
          // halo: even, tone-colored bloom on every side
          `0 0 36px -2px color-mix(in srgb, ${solid} var(--wp-glow-halo-a, 6%), transparent)`,
          // ambient: wider, fainter wash so the glow feathers out
          `0 0 110px 8px color-mix(in srgb, ${solid} var(--wp-glow-ambient-a, 2.5%), transparent)`,
          // grounding: near-neutral drop so the card still sits on the page
          "0 16px 44px rgba(23,23,26,0.025)",
        ].join(", "),
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p
          className="flex items-center gap-2 font-display text-[11px] font-bold uppercase tracking-[.16em]"
          style={{ color: solid }}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: solid }}
          />
          {label}
        </p>
        <p
          className="rounded-full px-2.5 py-1 font-display text-[10.5px] font-semibold leading-none"
          style={{
            color: solid,
            backgroundColor: `color-mix(in srgb, ${solid} 9%, rgba(255,255,255,0.65))`,
          }}
        >
          {highlight}
        </p>
      </div>
      <p className="mb-7 max-w-[44rem] font-body text-[13.5px] leading-relaxed text-black/60 [&+h2]:mt-0">
        {summary}
      </p>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-body text-[15px] leading-[1.75] text-black/75">
      {children}
    </p>
  );
}

function Formula({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: WpTone;
}) {
  return (
    <div
      className="my-4 overflow-x-auto rounded-md border border-black/10 bg-black/[.03] px-4 py-3 font-mono-num text-[13.5px] leading-relaxed"
      style={
        tone
          ? {
              ...wpSurfaceStyle(tone),
              backgroundColor: "rgba(255,255,255,0.62)",
            }
          : wpSurfaceStyle()
      }
    >
      {children}
    </div>
  );
}

function Callout({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: WpTone;
}) {
  return (
    <div
      className="my-4 rounded-md border border-black/15 bg-black/[.03] px-4 py-3 font-body text-[14px] italic leading-relaxed text-black/70"
      style={
        tone
          ? {
              ...wpSurfaceStyle(tone),
              backgroundColor: "rgba(255,255,255,0.62)",
            }
          : wpSurfaceStyle()
      }
    >
      {children}
    </div>
  );
}

function CardGrid({
  items,
}: {
  items: { title: string; body: React.ReactNode; tone?: WpTone }[];
}) {
  return (
    <div
      className={`my-4 grid gap-3 ${
        items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
      }`}
    >
      {items.map((it) => (
        <div
          key={it.title}
          className="rounded-md border border-black/10 bg-white p-4"
          style={
            it.tone
              ? {
                  ...wpSurfaceStyle(it.tone),
                  backgroundColor: wpToneColor(it.tone, "wash"),
                }
              : wpSurfaceStyle()
          }
        >
          <p
            className="mb-1 font-display text-[13px] font-semibold"
            style={
              it.tone ? { color: wpToneColor(it.tone) } : undefined
            }
          >
            {it.title}
          </p>
          <p className="font-body text-[13px] leading-relaxed text-black/65">
            {it.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function Table({
  head,
  rows,
  caption,
}: {
  head: string[];
  rows: React.ReactNode[][];
  caption?: string;
}) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left font-body text-[13.5px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-black/20 py-2 pr-4 font-display text-[12px] font-semibold uppercase tracking-wide text-black/50"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-black/[.07]">
              {r.map((c, j) => (
                <td
                  key={j}
                  className="py-2.5 pr-4 align-top leading-relaxed text-black/75"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && (
        <p className="mt-2 font-body text-[12px] italic text-black/45">
          {caption}
        </p>
      )}
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-black/[.05] px-1 py-0.5 font-mono-num text-[.92em]">
    {children}
  </code>
);

/* ── the article ────────────────────────────────────────────────────────── */

export function WhitepaperArticle() {
  return (
    <article className="min-w-0 max-w-[760px]">
      {/* title block */}
      <header className="mb-12">
        <p className="font-body text-[12px] uppercase tracking-[.18em] text-black/45">
          Renaiss Engineering · Whitepaper
        </p>
        <h1 className="mt-3 font-display text-[34px] font-bold leading-[1.15] tracking-tight">
          Renaiss Gacha: Committed Sets and Verifiable Collectible Draws
        </h1>
        <div
          className="mt-4 h-[3px] w-36 rounded-full"
          style={{ background: "var(--grad-brand)" }}
        />
      </header>

      <H2 id="abstract" num="◦">
        Abstract
      </H2>
      <P>
        A gacha draw normally happens inside the operator's server, and the
        player has to trust that the operator did not choose the outcome.
        Digital records do not solve this on their own, because an operator who
        sees the result first can still rewrite it. We propose a protocol built
        on three pillars.{" "}
        <span style={{ color: wpToneColor("algorithm") }}>
          <span className="font-semibold">(i) Construction.</span> The Fair Set
          Algorithm derives each set under published construction
          constraints, including an expected-value range and minimum and maximum
          collectible counts for each tier. Top tier collectibles are a
          guaranteed part of every set:{" "}
          <AbstractMark>
            top tier drops are never a maybe
          </AbstractMark>
          {"."}
        </span>{" "}
        <span style={{ color: wpToneColor("inventory") }}>
          <span className="font-semibold">(ii) Inventory.</span> Renaiss Gacha
          draws each set from one large inventory of Renaiss Collectibles, so{" "}
          <AbstractMark>
            every collectible has a fair shot
          </AbstractMark>{" "}
          at entering a set. Before the set becomes available, its Merkle root
          is recorded on-chain, so a later addition, removal, or substitution
          produces a different root.
        </span>{" "}
        <span style={{ color: wpToneColor("draw") }}>
          <span className="font-semibold">(iii) Draw.</span> Each purchase then
          derives an ECVRF output from post-commit on-chain data. An ECVRF
          (elliptic curve verifiable random function,{" "}
          <RefLink href="https://www.rfc-editor.org/rfc/rfc9381.html#name-elliptic-curve-vrf-ecvrf">
            RFC 9381
          </RefLink>
          ) is a keyed function: every output comes with a proof that anyone
          can check against the published public key. The output is
          reduced modulo the number of collectibles remaining in the set, and
          the selected collectible is removed. The proof pins down{" "}
          <AbstractMark>
            the exact collectible, proven end to end
          </AbstractMark>
          , not a tier or a range, and a verifier can reconstruct the committed
          lineup and replay the draws in order without trusting the operator's
          database.
        </span>
      </P>

      <H2 id="introduction" num="1">
        Introduction
      </H2>
      <H3 id="trust-problem">1.1 · The trust problem</H3>
      <P>
        Commerce in gacha has come to rely on the operator serving as a trusted
        third party for two separate decisions: which collectibles enter a set
        and which remaining collectible a buyer receives. A fair random draw
        cannot repair a set that was composed outside its published constraints.
        A well-built set does not help if the operator can reroll or substitute
        the selected collectible. Both decisions need public rules and evidence.
      </P>
      <Callout>
        Fairness covers the set before sale and the collectible selected after
        payment. Either claim should be independently checkable.
      </Callout>

      <H3 id="fairness-requires">1.2 · What provable fairness requires</H3>
      <CardGrid
        items={[
          {
            title: "Pillar I · Construction",
            body: "The Fair Set Algorithm must produce a set that passes the published EV and tier-count rules, so top tier drops are never a maybe.",
            tone: "algorithm",
          },
          {
            title: "Pillar II · Inventory",
            body: "The set is drawn from the full Renaiss Collectible inventory and fixed by an on-chain Merkle root before sale. Every collectible has a fair shot.",
            tone: "inventory",
          },
          {
            title: "Pillar III · Draw",
            body: "Post-commit on-chain data, ECVRF, and modulo over the remaining collectibles pin down the exact collectible, provable end to end.",
            tone: "draw",
          },
        ]}
      />

      <H3 id="contributions">1.3 · Contributions</H3>
      <P>
        This paper describes three connected mechanisms, one for each pillar.
        First, the Fair Set Algorithm derives each set from the
        collectibles in inventory. Its inputs and rules are public, so a
        verifier can inspect and reproduce the derivation, and the algorithm
        accepts a set only when it satisfies the published construction
        predicate (<Sec n="4" />). Second, a Merkle root recorded on-chain
        commits the accepted Renaiss Collectibles lineup before buyers draw
        from it (<Sec n="5" />). Third, ECVRF
        randomness derived from post-commit chain data selects an index from the
        collectibles still available (<Sec n="6" />). The resulting record can be
        replayed from public evidence (<Sec n="7" /> and <Sec n="8" />).
      </P>

      <H2 id="model" num="2">
        Model and goals
      </H2>
      <P>
        A fairness claim depends on what each participant can choose and which
        facts a verifier can recover. This section states those boundaries
        before describing the protocol.
      </P>
      <H3 id="actors">2.1 · Actors and trust</H3>
      <Table
        head={["Actor", "Role", "Trust"]}
        rows={[
          [
            "Player",
            "Pays and receives a collectible.",
            "Checks the commitment and draw evidence.",
          ],
          [
            "Operator",
            "Holds inventory and the VRF key.",
            "Trusted for custody and fulfillment, not for altering a committed result.",
          ],
          [
            "Chain",
            "Stores the set root and supplies post-commit data.",
            "Trusted for consensus, finality, and block production.",
          ],
          [
            "Verifier",
            "Anyone with a browser and public data.",
            "Recomputes the result without trusting the operator's database.",
          ],
        ]}
      />
      <H3 id="threat-model">2.2 · Threat model</H3>
      <P>
        We assume the operator is hostile and give it every capability short of
        breaking the cryptography.
      </P>
      <div className="my-4 grid gap-3 sm:grid-cols-2">
        <div
          className="rounded-md border border-black/10 bg-white p-4"
          style={wpSurfaceStyle()}
        >
          <p className="mb-1.5 font-display text-[13px] font-semibold">
            The operator can
          </p>
          <p className="font-body text-[13px] leading-relaxed text-black/65">
            see outcomes first · run the app &amp; DB · compose set lineups
            within published constraints · hold and use the VRF secret key
          </p>
        </div>
        <div
          className="rounded-md border border-black/10 bg-white p-4"
          style={wpSurfaceStyle()}
        >
          <p className="mb-1.5 font-display text-[13px] font-semibold">
            The operator cannot, without detection
          </p>
          <p className="font-body text-[13px] leading-relaxed text-black/65">
            predict a future block hash · forge a second proof for one seed ·
            edit a committed lineup without changing its root · serve a
            different result that still passes public replay
          </p>
        </div>
      </div>
      <P>
        The first capability deserves a note. Because the operator computes each
        draw on its own server, it sees the resulting collectible before the
        player does. That does not let it change the collectible: the proof binds
        the operator to the one outcome the published key produces for the seed,
        so knowing a result early gives it no way to alter it.
      </P>
      <H3 id="security-goals">2.3 · Security goals</H3>
      <Table
        head={["Goal", "Statement"]}
        rows={[
          [
            <Mono key="g1">G1 · Constrained set</Mono>,
            "Every published set passes the EV and tier-count predicate.",
          ],
          [
            <Mono key="g2">G2 · Committed lineup</Mono>,
            "The on-chain Merkle root detects any later lineup change.",
          ],
          [
            <Mono key="g3">G3 · Deterministic draw</Mono>,
            "One valid VRF output maps to one remaining collectible.",
          ],
          [
            <Mono key="g4">G4 · Verifiable record</Mono>,
            "Public evidence reproduces the collectible without database trust.",
          ],
        ]}
      />

      <H2 id="overview" num="3">
        Protocol overview
      </H2>

      <H3 id="one-pull">3.1 · The three pillars</H3>
      <P>
        The protocol separates the construction of a valid set, the inventory
        that supplies it, and the draw of a collectible. Each pillar leaves
        evidence for the next.
      </P>
      <CardGrid
        items={[
          {
            title: "Pillar I · Construction",
            body: "The deterministic algorithm proposes a lineup, then the acceptance predicate checks its EV and per-tier counts.",
            tone: "algorithm",
          },
          {
            title: "Pillar II · Inventory",
            body: "A set drawn from Renaiss Collectible inventory is committed on-chain with a Merkle root before sale.",
            tone: "inventory",
          },
          {
            title: "Pillar III · Draw",
            body: "After payment, chain data and ECVRF produce β, and keccak256(β) modulo the remaining-collectible count selects the exact collectible.",
            tone: "draw",
          },
        ]}
      />
      <P>
        When a buyer pays, the contract fixes the pack and checkout identifiers.
        A finalized block supplies the remaining seed input. The VRF proof and
        ordered draw history then reproduce the selected collectible, while the
        on-chain root confirms that the collectible came from the committed set.
      </P>

      <H3 id="commit-timeline">3.2 · The commitment timeline</H3>
      <P>
        For each draw, operator-controlled inputs are public before the relevant
        entropy exists. The finalized block hash becomes available only after
        payment. The order below is part of the protocol, not an operational
        convention.
      </P>
      <div className="my-5 flex flex-col">
        {[
          {
            t: "Before any rip",
            tag: "VRF key · algorithm",
            what: "We publish the VRF public key and open-source the Fair Set Algorithm.",
            why: "Establishes the key used to check later proofs and the rules used to build sets.",
          },
          {
            t: "Set goes live",
            tag: "Merkle root",
            what: "The lineup is built and its Merkle root is recorded on-chain.",
            why: "Any later lineup change produces a different root (§5.4).",
          },
          {
            t: "You commit funds",
            tag: "packId · checkoutId",
            what: "You fund the rip; the contract mints your packId and checkoutId.",
            why: "Two of the three seed inputs are now fixed on-chain. The third still does not exist.",
          },
          {
            t: "Block finalizes",
            tag: "blockHash",
            what: "Consensus produces the block carrying your purchase.",
            why: "The seed's entropy is set here, after your funds commit, and nobody could predict it a moment earlier.",
          },
          {
            t: "The draw",
            tag: "β · π",
            what: "ECVRF maps the seed to randomness and an 80-byte proof; your collectible is assigned and recorded.",
            why: "For a fixed seed and key, ECVRF has one verifiable output (§6).",
          },
          {
            t: "After settlement",
            tag: "replay",
            what: "A verifier re-derives the collectible from public data and the published key.",
            why: "Verification does not require the private key or operator database (§8).",
          },
        ].map((s, i, arr) => (
          <div key={s.t} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/20 bg-white font-mono-num text-[11px] font-semibold text-black/50">
                {i + 1}
              </span>
              {i < arr.length - 1 && (
                <span className="w-px flex-1 bg-black/[0.12]" />
              )}
            </div>
            <div className={i < arr.length - 1 ? "pb-5" : ""}>
              <p className="font-display text-[14px] font-semibold">
                {s.t}
                <span className="ml-2 whitespace-nowrap rounded-full border border-black/[0.12] px-2 py-0.5 font-mono-num text-[10.5px] font-medium text-black/45">
                  {s.tag}
                </span>
              </p>
              <p className="mt-1 font-body text-[13.5px] leading-relaxed text-black/70">
                {s.what}
              </p>
              <p className="mt-0.5 font-body text-[12.5px] italic leading-relaxed text-black/45">
                {s.why}
              </p>
            </div>
          </div>
        ))}
      </div>
      <Callout>
        The lineup commitment precedes sale. The block hash used for the draw
        appears after payment. Public verification checks both sides of that
        boundary.
      </Callout>

      <PillarSection
        tone="algorithm"
        label="Pillar I · Construction"
        highlight="Top tier drops are never a maybe"
        summary="Sets run back to back, one active at a time. Each must carry a fixed count of top tier collectibles and pass the published rules before it goes live. Fairness is built in rather than promised."
      >
        <H2 id="fair-set-adaptive-algorithm" num="4" tone="algorithm">
          Fair Set Algorithm
        </H2>
      <P>
        The Fair Set Algorithm derives a set from the candidate
        inventory, a published configuration, and a VRF-derived random stream.
        Random choices come from that stream. All other choices follow fixed
        scoring, balancing, and acceptance rules.
      </P>

      <H3 id="config-odds">4.1 · Published construction constraints</H3>
      <P>
        The configuration defines an expected-value range, a set-size range and
        a maximum set size, value floors for the tiers, target tier shares,
        minimum and maximum counts for each tier, and, where configured, a hard
        cap on the share of the set a tier may hold. These values govern which
        sets may be published.
        They are construction constraints, not per-draw odds — the realized
        lineup fixes the draw probabilities, derived in <Sec n="6.3" />.
      </P>
      <Table
        head={[
          "Tier",
          "Value floor",
          "Target share",
          "Minimum",
          "Maximum",
          "Share cap",
        ]}
        rows={[
          ["Tier S", "≥ $100", "1%", "N, where N ≥ 1", "N", "—"],
          ["Tier A", "≥ $90", "4%", "2", "5", "10%"],
          ["Tier B", "≥ $60", "20%", "10", "20", "30%"],
          ["Tier C", "≥ $10", "75%", "37", "60", "—"],
        ]}
        caption="Illustrative configuration. Target shares guide construction; acceptance is decided by the EV range, the set-size cap, per-tier minimum and maximum counts, and per-tier share caps where configured."
      />

      <H3 id="adaptive-construction">4.2 · Constrained construction</H3>
      <P>
        The inputs are the candidate tokens and their values, the configuration
        above, and the random stream described in <Sec n="4.4" />. The algorithm
        samples without replacement (a token picked for the set leaves the
        candidate pool), so a token cannot appear twice in one set. Construction
        treats the published rules in two classes. Hard bounds must always be
        satisfied. The minimum number of collectibles in a tier and the lower
        and upper bounds on expected value are two examples; the full list is
        the acceptance conditions of <Sec n="4.3" />. Soft targets guide the
        search but carry no guarantee. The target expected value and the
        target share of collectibles in a tier are two examples. The algorithm
        is also
        tuned to use the inventory broadly and evenly, scored by the evaluator
        described in <Sec n="4.5" />.
      </P>
      <P>
        The construction procedure itself is under continuous improvement;
        every algorithm version is open source and can be checked on this
        site&apos;s{" "}
        <Link
          href="/verify-a-gacha"
          className="font-medium underline decoration-black/25 decoration-1 underline-offset-2 transition-colors hover:decoration-black/70"
        >
          verification pages
        </Link>
        . What a verifier can rely
        on stays fixed: every random choice comes from the VRF-derived stream,
        the same inputs reproduce the same set, replay runs the algorithm
        version and configuration that built the set, and the acceptance
        predicate in <Sec n="4.3" />, not the construction stage, decides what
        is published.
      </P>
      <H3 id="acceptance-predicate">4.3 · Acceptance predicate</H3>
      <P>
        Construction and acceptance are separate. A candidate becomes the
        published set only when all of the following conditions hold:
      </P>
      <Formula tone="algorithm">
        Accept(S, C) ⇔ lowerEV ≤ floor(Σ value(collectible) ÷ |S|) ≤ upperEV
        <br />
        &nbsp;&nbsp;∧ |S| ≤ maxSetSize
        <br />
        &nbsp;&nbsp;∧ for every tier t: minₜ ≤ countₜ(S) ≤ maxₜ
        <br />
        &nbsp;&nbsp;∧ for every tier t with a share cap: countₜ(S) ≤ shareₜ ·
        |S|
        <br />
        &nbsp;&nbsp;∧ every token id in S is unique
      </Formula>
      <P>
        If no candidate passes the predicate within the attempt limit, no set
        is published from that run. The bounds are not relaxed to force a
        result.
      </P>
      <Callout tone="algorithm">
        Every accepted set starts with its configured tier counts. As
        collectibles are drawn without replacement, the remaining composition
        changes in a public and reproducible way.
      </Callout>

      <H3 id="reproducibility">4.4 · Deterministic construction</H3>
      <P>
        Build-time randomness is separate from the draw in <Sec n="6" />. The
        build stream derives from the hash and number of a finalized block, the
        on-chain packId, and the set number under a fixed domain tag. The VRF
        output expands into a deterministic sequence:
      </P>
      <Formula tone="algorithm">
        <span className="text-black/45">
          // The domain tag scopes this seed to set generation, so it can't
          <br />
          // collide with hashes from other contexts.
        </span>
        <br />
        α = keccak256( <span className="text-black/50">domainTag</span> ‖
        blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂ )
        <br />
        (β, π) = ECVRF_prove(sk, α) &nbsp;·&nbsp; rᵢ = SHA-512(β ‖ i) → [0, 1)
      </Formula>
        <P>
          Given the block reference, packId, set number, proof, configuration,
          and candidate inventory, a verifier can reconstruct the random stream
          and the accepted lineup. The Fair Set Algorithm is
          open-source and each set's inputs are published. Replaying the same
          inputs follows the same attempts and produces the
          same accepted set.
        </P>

      <H3 id="implementation-agnostic">4.5 · Implementation agnostic</H3>
      <P>
        The protocol pins down three artifacts: the input token data published
        for each packing run, the algorithm configuration carrying the hard
        bounds and soft targets of <Sec n="4.1" />, and an evaluator function
        that scores candidate algorithms. An algorithm scores higher when its
        sets fulfil the soft conditions and use the inventory more broadly and
        evenly; the exact measures can evolve without touching the hard
        bounds. Together, the three fix what a construction must consume, what
        it must respect, and what it should be good at, without fixing how it
        works.
      </P>
        <P>
          The construction algorithm itself is therefore replaceable. It can
          be improved in house, contributed by the community, or sourced
          through a decentralized process, and none of that changes what a
          verifier checks: the published inputs, the chain-derived random
          stream, and the acceptance predicate of <Sec n="4.3" /> stay the
          same.
        </P>
        <Link
          href="/verify-a-gacha#sets"
          className="my-2 inline-block rounded-full border border-black/20 px-5 py-2 font-display text-[13px] font-semibold text-black/80 transition-colors hover:border-black/50"
        >
          Browse the sets →
        </Link>
      </PillarSection>

      <PillarSection
        tone="inventory"
        label="Pillar II · Inventory"
        highlight="Every collectible has a fair shot"
        summary="Every set comes from one big on-chain inventory of Renaiss collectibles. An open source algorithm picks the lineup, and anyone can rerun it from public inputs."
      >
        <H2 id="set-generation" num="5" tone="inventory">
          Inventory and commitment
        </H2>
      <H3 id="inventory-model">5.1 · Collectible inventory</H3>
      <P>
        Renaiss maintains a large Renaiss Collectible inventory. The inventory
        is itself{" "}
        <RefLink href="https://bscscan.com/address/0x14b662fc59f87ec004c2c25e0a2a49c9f858ef8c#asset-nfts">
          an on-chain contract
        </RefLink>{" "}
        that holds every collectible, so the full
        pool a set can draw from is public rather than a private list on our
        servers. A set is a finite lineup derived from that inventory for pack
        draws. Collectible identity and value travel with the set-construction
        inputs, so the acceptance checks in <Sec n="4" /> apply to named tokens,
        not to an abstract rarity distribution.
      </P>

      <H3 id="composition-selection">5.2 · Composition and selection</H3>
      <CardGrid
        items={[
          {
            title: "Composition",
            body: (
              <>
                Which collectibles enter the set. The Fair Set Algorithm
                proposes a lineup under published construction
                constraints (<Sec n="4" />).
              </>
            ),
            tone: "algorithm",
          },
          {
            title: "Selection",
            body: (
              <>
                Which remaining collectible a buyer receives. ECVRF randomness
                selects one index after payment (<Sec n="6" />).
              </>
            ),
            tone: "draw",
          },
        ]}
      />
      <P>
        These are separate fairness claims. The construction predicate checks
        the lineup before sale. The draw proof checks each selection after a
        buyer commits funds.
      </P>

      <H3 id="packing">5.3 · Packing a set</H3>
      <P>
        A pack does not offer the whole inventory. Packing selects a set from
        the inventory contract for a single pack. That choice is not ours to
        make by hand. It runs a public algorithm that is transparent in its
        rules, reproducible from its inputs, and open source, so anyone can
        rebuild the same set from the same public data and check that the lineup
        was not hand-picked. <Sec n="4" /> gives the algorithm in full. Here we
        trace the four steps that turn the inventory contract into a committed
        set.
      </P>
      <div className="my-5 flex flex-col">
        {[
          {
            t: "Snapshot on-chain ownership",
            b: "Read every collectible the inventory contract owns at a finalized block. The snapshot is public and fixed to that block height, so anyone reading the chain starts from the same pool.",
          },
          {
            t: "Exclude in-play tokens",
            b: "Drop tokens that are currently tied up, e.g. sitting in an open set's lineup, locked to a draw awaiting settlement.",
          },
          {
            t: "Run the Fair Set Algorithm",
            b: (
              <>
                Feed the eligible tokens and the public configuration into the
                open-source algorithm (<Sec n="4" />
                ). Its rules and inputs are published, so the accepted set
                follows from public data alone.
              </>
            ),
          },
          {
            t: "Commit before the set is active",
            b: "Store the accepted set, hash it into a Merkle root, and record the root on-chain before the set opens for draws.",
          },
        ].map((s, i, arr) => (
          <div key={s.t} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white font-mono-num text-[11px] font-semibold"
                style={{
                  borderColor: wpToneColor("inventory", "line"),
                  color: wpToneColor("inventory"),
                }}
              >
                {i + 1}
              </span>
              {i < arr.length - 1 && (
                <span className="w-px flex-1 bg-black/[0.12]" />
              )}
            </div>
            <div className={i < arr.length - 1 ? "pb-5" : ""}>
              <p className="font-display text-[14px] font-semibold">{s.t}</p>
              <p className="mt-1 font-body text-[13.5px] leading-relaxed text-black/70">
                {s.b}
              </p>
            </div>
          </div>
        ))}
      </div>
      <Formula tone="inventory">
        E_avail = owned(inventory, blockₙ) ∩ eligible(pack) \ inPlay
        <br />
        S = FairSetAlgorithm(E_avail, config)
        <br />
        root = Merkle(S) &nbsp;→&nbsp; recorded on-chain before the set is active
      </Formula>

      <H3 id="pinning">5.4 · On-chain Merkle commitment</H3>
      <P>
        Before a set becomes available, each collectible in the accepted lineup
        is hashed into a Merkle tree{" "}
        <SecLink id="ref-merkle">[3]</SecLink>, and the root is recorded
        on-chain. Adding, removing, or substituting a collectible changes the
        root. The operator therefore cannot present a different lineup later
        without producing a mismatch against the on-chain commitment.
      </P>
      <Formula tone="inventory">
        leafᵢ = keccak256(abi.encode(tokenIdᵢ, saltᵢ,
        valueInUsd)) &nbsp;&nbsp;·&nbsp;&nbsp; root = Merkle(leaf₀ … leafₙ₋₁)
        &nbsp;&nbsp;·&nbsp;&nbsp; changed lineup or value ⇒ different root
      </Formula>
      <P>
        A 1,024-leaf set has depth 10, so an inclusion proof contains ten sibling
        hashes, 320 bytes of proof data. Given a collectible's token id, salt, value in
        USD, and proof path, a verifier can reconstruct the root and compare it
        with the value on-chain. A successful comparison proves that the
        collectible and its construction-time value in USD belong to the
        committed lineup.
      </P>
      <MerkleFoldDemo />
      <Callout tone="inventory">
        The Merkle root does not choose a collectible. It fixes the set from
        which the draw is allowed to choose.
      </Callout>

      <H3 id="set-record">5.5 · Public set record</H3>
      <P>
        The set record joins the accepted lineup to its on-chain Merkle root.
        Each later draw references that committed set. A database may index the
        lineup for fast access, but a verifier checks its contents against the
        root rather than treating the database as authoritative.
      </P>
        <Link
          href="/verify-a-gacha#packing"
          className="my-2 inline-block rounded-full border border-black/20 px-5 py-2 font-display text-[13px] font-semibold text-black/80 transition-colors hover:border-black/50"
        >
          Browse the packing runs →
        </Link>
      </PillarSection>

      <PillarSection
        tone="draw"
        label="Pillar III · Draw"
        highlight="The exact collectible, proven end to end"
        summary="On-chain randomness maps each pull to one of the collectibles left in the set. The proof pins down the exact collectible you receive, not a tier or a range. Replay the draw and you get the same result."
      >
        <H2 id="draw" num="6" tone="draw">
          Verifiable draw
        </H2>
      <H3 id="post-commit-seed">6.1 · Post-commit seed</H3>
      <Formula tone="draw">
        seed α = keccak256( <span className="text-black/50">domainTag</span> ‖
        blockHash ‖ packId ‖ checkoutId₃₂ )
      </Formula>
      <P>
        The seed hashes three public values under a fixed domain tag: the hash
        of the block that contains the purchase, the on-chain packId, and the
        checkout number the settlement contract assigned to the pull. The tag
        scopes the hash to one meaning (this pack-draw seed formula, version
        1), so a hash from another context or from a future revision of the
        formula cannot collide with it. It serves
        the same domain-separation role that EIP-712 defines for typed Ethereum
        data <SecLink id="ref-eip712">[5]</SecLink>; the seed itself is not
        EIP-712 encoded. Checkout numbers restart at 1 for each pack, so the
        seed includes packId as well. This keeps pulls from different packs
        distinct even when they share a block and checkout number.
      </P>
      <P>
        None of these inputs are ours to choose. The packId and checkout number
        are fixed by the contract when the purchase executes. The block hash
        does not exist at that point; validators produce it when the block
        finalizes, after funds are committed, and we learn it at the same moment
        everyone else does. To bias a draw we would have to predict the hash of
        a block that has not been built, which we cannot do. What remains is the
        chain-trust assumption of <Sec n="2.1" />: a block producer could in
        principle influence a hash, so the chain, not the operator, is the party
        trusted for entropy.
      </P>
      <div className="my-4 grid gap-2 sm:grid-cols-3">
        {[
          ["t₀ · commit", "Funds lock; packId and checkoutId are fixed."],
          ["t₁ · block finalized", "Hash unknowable at t₀, by anyone."],
          ["t₂ · draw proven", "The recorded result can be replayed."],
        ].map(([t, b]) => (
          <div
            key={t}
            className="rounded-md border border-black/10 bg-white p-3 text-center"
            style={wpSurfaceStyle()}
          >
            <p className="font-mono-num text-[12px] font-semibold text-black/60">
              {t}
            </p>
            <p className="mt-1 font-body text-[12.5px] leading-snug text-black/60">
              {b}
            </p>
          </div>
        ))}
      </div>
      <H3 id="ecvrf-proof">6.2 · The ECVRF proof: 80 bytes, deterministic</H3>
      <Formula tone="draw">
        (β, π) = ECVRF_prove(sk, α) · suite ECVRF-EDWARDS25519-SHA512-ELL2
        (0x04) · π = Γ(32) ‖ c(16) ‖ s(32)
      </Formula>
      <P>
        The suite and verification procedure follow RFC 9381{" "}
        <SecLink id="ref-rfc9381">[1]</SecLink>, an elliptic-curve realization
        of the verifiable random function primitive introduced by Micali,
        Rabin, and Vadhan <SecLink id="ref-vrf-origin">[2]</SecLink>. For one
        seed and one key
        there is exactly one valid β. A verifier runs{" "}
        <Mono>ECVRF_verify(PK, α, π)</Mono> per RFC 9381 §5.3 and recomputes β
        from the proof itself (<SecLink id="appendices">Appendix B</SecLink>).
      </P>
      <P>
        Uniqueness also settles a question the threat model raises (
        <Sec n="2.2" />
        ). Because we hold the secret key, we compute β on our own server and
        see the resulting collectible before the player. For the seed and the
        published key there is only one β we can prove, so seeing the result
        early gives us no other outcome to substitute. The proof we publish is
        the one anyone recomputes and checks.
      </P>
      <H3 id="slot-mapping">
        6.3 · Slot mapping · sampling without replacement
      </H3>
      <Formula tone="draw">index = keccak256(β) mod |E|</Formula>
      <P>
        <Mono>|E|</Mono> is the count of collectibles still available. Draws
        assign over a shrinking, canonically sorted lineup in checkout order,
        so collisions can't happen and replay is unambiguous. The modulo bias
        for |E| ≤ 2¹⁴ against a 256-bit hash is bounded below 2⁻²⁴² (Appendix A).
      </P>
      <P>
        Because the modulus makes every remaining collectible equally likely at
        each step, a tier's draw probability is just its share of the pool at
        that moment — and it shifts after every removal as the pool shrinks:
      </P>
      <Formula tone="draw">
        P(tier t | history h) = remaining collectibles in tier t after h ÷ total
        collectibles remaining after h
      </Formula>
      <div className="my-4 overflow-x-auto">
        <div
          className="flex min-w-[520px] flex-col gap-1.5 rounded-md border border-black/10 bg-white p-3 font-mono-num text-[12px] text-black/65"
          style={wpSurfaceStyle()}
        >
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-black/40">draw 1</span>
            <span>|E| = 1,024</span>
            <span className="text-black/30">→</span>
            <span>i = 412</span>
            <span className="text-black/30">→</span>
            <span className="text-black/85">#40479 removed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-black/40">draw 2</span>
            <span>|E| = 1,023</span>
            <span className="text-black/30">→</span>
            <span>i = 77</span>
            <span className="text-black/30">→</span>
            <span className="text-black/85">#12083 removed</span>
          </div>
          <div className="flex items-center gap-2 text-black/35">
            <span className="w-16 shrink-0">⋮</span>
            <span>
              each removal shifts every later index; history is part of the
              input
            </span>
          </div>
        </div>
        <p className="mt-2 font-body text-[12px] italic text-black/45">
          Fig. · Sampling without replacement over a shrinking pool: replaying
          draw n requires (and so verifies) draws 1 through n−1.
        </p>
      </div>

        <H2 id="ledger" num="7" tone="draw">
          Verifiable audit trail
        </H2>
      <P>
        Each draw record carries the verification bundle: block hash,
        checkoutId, β, π, the resolved collectible, and its draw sequence. The
        on-chain Merkle root fixes the lineup. The purchase data and finalized
        block determine α; given α and the published key, β is the single value
        that passes proof verification; and the modulo rule maps that β to one
        selected collectible. A database entry that conflicts with any of those
        facts fails independent replay.
      </P>
        <P>
          The database is an index for these records, not the source of their
          validity. For that reason, this paper calls the record verifiable
          rather than describing the whole database as immutable.
        </P>
        <Link
          href="/verify-a-rip"
          className="my-2 inline-block rounded-full border border-black/20 px-5 py-2 font-display text-[13px] font-semibold text-black/80 transition-colors hover:border-black/50"
        >
          Prove a draw →
        </Link>
      </PillarSection>

      <H2 id="verify" num="8">
        Verify your own pull
      </H2>
      <P>
        Sections <Sec n="4" /> through <Sec n="7" /> exist so that anyone can
        run this one. Verification is a short sequence of deterministic checks,
        done in a browser over numbers read from a transaction receipt. The draw
        logic follows in full. We omit the storage and indexing machinery, which
        adds nothing to the argument.
      </P>

      <H3 id="ordering">8.1 · Checkout order</H3>
      <P>
        Every pull gets a <em>checkoutId</em> at payment, a per-pack sequence
        number the settlement contract assigns as purchase transactions execute.
        The ordering is therefore fixed by consensus: checkoutIds follow block
        number, and within a block, the transaction's position in it. Neither we
        nor the player choose where in the queue a pull lands. Draws consume the
        set in ascending checkoutId order, so a set's entire draw history is one
        totally ordered sequence that anyone can reconstruct.
      </P>

      <H3 id="one-seed-one-collectible">
        8.2 · One seed, one collectible
      </H3>
      <P>
        Three deterministic functions turn public facts into a collectible;
        their exact byte encodings are fixed in{" "}
        <SecLink id="appendices">Appendix C</SecLink>. First, the seed ties the
        pull to entropy that did not exist when it was paid for:
      </P>
      <Formula tone="draw">
        α = keccak256( tag ‖ blockHash ‖ packId ‖ checkoutId₃₂ )
      </Formula>
      <P>
        The block hash is fixed by consensus only after the purchase is
        included. The packId and checkoutId are fixed at purchase. So before
        payment, neither party can predict the seed. After payment, neither
        party can change it. Second, the ECVRF maps the seed to randomness, and
        for one seed and one key there is exactly one β that any proof can
        attest to:
      </P>
      <Formula tone="draw">
        (β, π) = ECVRF_prove(sk, α) &nbsp;·&nbsp; β unique per (sk, α)
      </Formula>
      <P>
        Third, the randomness picks a slot in the surviving lineup by modulus,
        and the chosen collectible leaves the pool:
      </P>
      <Formula tone="draw">
        index = keccak256(β) mod |E| &nbsp;·&nbsp; E ← E ∖{" "}
        {"{collectible}"}
      </Formula>
      <P>
        No step leaves room for a choice. Given the published key, the set
        lineup, and the ordered draw history, the collectible at checkoutId{" "}
        <em>n</em> is fully determined.
      </P>

      <H3 id="procedure">8.3 · The verification procedure</H3>
      <div className="my-4 grid gap-2 sm:grid-cols-5">
        {[
          [
            "1",
            "Read the chain",
            "Read the set root, checkoutId, packId, block hash and buyer.",
          ],
          [
            "2",
            "Recompute α",
            "keccak256 over the tag and the three on-chain values.",
          ],
          [
            "3",
            "Verify π",
            "ECVRF_verify(PK, α, π); recomputed β must equal the record.",
          ],
          [
            "4",
            "Derive the index",
            "Replay prior draws; keccak256(β) mod |E|.",
          ],
          [
            "5",
            "Check the collectible",
            "The collectible must match the derived index and prove inclusion under the on-chain root.",
          ],
        ].map(([n, t, b]) => (
          <div
            key={n}
            className="rounded-md border border-black/10 bg-white p-3"
            style={wpSurfaceStyle()}
          >
            <p className="font-mono-num text-[15px] font-bold text-black/30">
              {n}
            </p>
            <p className="mt-0.5 font-display text-[12.5px] font-semibold">
              {t}
            </p>
            <p className="mt-1 font-body text-[12px] leading-snug text-black/60">
              {b}
            </p>
          </div>
        ))}
      </div>
      <P>
        Step 4 matters more than it appears. Because sampling is without
        replacement (<Sec n="6.3" />
        ), the verifier replays every earlier draw in the set, checking each
        proof, before deriving its own index. A single dishonest draw anywhere
        in a set's history breaks the replay of every draw after it. The
        procedure uses no secret and no database, and it does not depend on
        trusting our software. It is one pure function over public inputs (
        <SecLink id="appendices">Appendix E</SecLink>), and it runs as{" "}
        <Link
          href="/verify-a-rip"
          className="font-medium underline decoration-black/25 decoration-1 underline-offset-2 transition-colors hover:decoration-black/70"
        >
          the interactive verifier on this site
        </Link>
        .
      </P>
      <Link
        href="/verify-a-rip"
        className="my-2 inline-block rounded-full bg-[#17171A] px-6 py-2.5 font-display text-[14px] font-semibold text-white transition-opacity hover:opacity-85"
      >
        Try the verifier →
      </Link>

      <H2 id="security" num="9">
        Security analysis
      </H2>
      <P>
        Each row below is a defense with a failure mode you can reproduce. Swap
        the outcome and the proof stops verifying. Edit the lineup and the root
        changes. Alter the recorded collectible and replay reaches a different
        result. You can watch the honest path resolve, one step at a time, in{" "}
        <Link
          href="/verify-a-rip"
          className="font-medium underline decoration-black/25 decoration-1 underline-offset-2 transition-colors hover:decoration-black/70"
        >
          the interactive verifier
        </Link>
        .
      </P>
      <Table
        head={["Attack", "Defense", "Result"]}
        rows={[
          [
            "Grind for a good seed",
            <>
              The seed binds a block hash that doesn&apos;t exist at commit time
              (<Sec n="6.1" />
              ).
            </>,
            "prevented",
          ],
          [
            "Swap the outcome",
            <>
              A fixed seed and public key admit one verifiable β. A substituted
              output fails proof verification (<Sec n="6.2" />).
            </>,
            "detected",
          ],
          [
            "Thin the set after publish",
            <>
              Any lineup edit changes the Merkle root that every draw references
              (<Sec n="5.4" />
              ).
            </>,
            "detected",
          ],
          [
            "Rewrite history",
            <>
              Independent replay detects a mismatch. Database constraints also
              reject prohibited changes (<Sec n="7" />).
            </>,
            "detected",
          ],
          [
            "Abort a bad outcome",
            "Every paid checkout is numbered on-chain, draws resolve in strict checkout order, and no re-roll path exists. A withheld draw stalls the sequence and leaves a permanent gap against the published record once the set closes.",
            "detected",
          ],
        ]}
      />

      <H2 id="limitations" num="10">
        Limitations
      </H2>

      <H3 id="lim-beacon">10.1 · Randomness beacon</H3>
      <P>
        The seed's entropy is the hash of a BSC block. At the moment funds
        commit, that hash does not exist, so no party can predict it. The
        residual is that the validator who builds the block carrying a purchase
        has some influence over its own block's hash{" "}
        <SecLink id="ref-chainlink">[4]</SecLink>, and can choose whether to
        include the transaction, which gives a block producer a bounded number
        of tries at the seed. We do not run BSC validators, and each attempt
        costs a full block, so the influence is marginal, but it is not zero.
        For that reason the chain, not the operator, is the party we trust for
        entropy.
      </P>

      <H3 id="lim-entry">10.2 · Permissionless entry</H3>
      <P>
        Today the operator submits the on-chain funding transaction, so it
        decides who may enter. Because only the operator's key produces a valid
        proof, it also decides whether a paid draw is resolved. Neither power
        lets the operator change an outcome: a recorded draw cannot be altered
        or forged, and every paid checkout is numbered on-chain at purchase, so
        a checkout whose draw never enters the published record leaves a
        permanent gap that anyone can measure against the chain. What is
        missing is prevention rather than detection. We keep looking for ways
        to close that gap and are considering permissionless submission, where
        anyone could send the funding transaction without the operator in the
        loop.
      </P>

      <H3 id="lim-cadence">10.3 · Activation cadence</H3>
      <P>
        A set is built from a block chosen when the build runs (<Sec n="4.4" />
        ), so discretion over when to build is discretion over the build seed.
        Today that timing is operational rather than mechanical. A rule that
        activates sets on a fixed cadence, for example every N blocks or every
        fixed time interval, removes the operator's choice of build block, so
        activation timing
        carries no signal and cannot be used to search for a favorable
        composition.
      </P>

      <H3 id="lim-reorg">10.4 · Chain reorgs</H3>
      <P>
        A draw references a block hash. That hash always comes from a block that
        BSC's fast-finality mechanism has marked final, one that two
        thirds of the validator set has voted irreversible, so a
        reorganization cannot replace it. Reverting a finalized block would
        take at least a third of the validator set breaking the voting rules{" "}
        <SecLink id="ref-bep126">[6]</SecLink>, and BSC slashes each convicted
        validator 200 BNB of self-delegated stake, ejects it from the set, and
        jails it for 30 days; double-signing carries the same fine and jail term{" "}
        <SecLink id="ref-slash-rules">[7]</SecLink>. If finality stalls,
        resolution waits; it never falls back to an unfinalized block. A failure
        of finality itself would be a chain-level event outside the scope of
        this system. Even then, recorded draws are immutable and cannot be
        silently replaced; recovery requires a separate, visible remediation
        path rather than a second result for the same draw.
      </P>

      <H2 id="conclusion" num="11">
        Conclusion
      </H2>
      <P>
        Renaiss Gacha separates fairness into three checkable pillars. The Fair
        Set Algorithm admits a lineup only when it satisfies the
        published EV and tier-count constraints. An on-chain Merkle root
        commits the accepted set, drawn from Renaiss Collectible inventory,
        before sale. After payment,
        post-commit chain data and ECVRF determine the exact collectible among
        those remaining. Together, the commitment, construction transcript, and
        draw proof let a verifier reproduce the result without treating a
        database entry as authoritative.
      </P>

      <H2 id="appendices" num="A-E">
        Appendices
      </H2>
      <CardGrid
        items={[
          {
            title: "A · Modulo-bias bound",
            body: "For |E| ≤ 2¹⁴ and a 256-bit hash, the per-slot bias is bounded below 2⁻²⁴².",
          },
          {
            title: "B · ECVRF verification math",
            body: "Recompute U = sB − cY and V = sH − cΓ; accept iff c equals the first 16 bytes of SHA-512(suite ‖ 0x02 ‖ Y ‖ H ‖ Γ ‖ U ‖ V ‖ 0x00), then β = SHA-512(suite ‖ 0x03 ‖ 8Γ ‖ 0x00). RFC 9381 §5.3, §5.4.3, §5.2.",
          },
          {
            title: "C · Canonical byte encodings",
            body: "Exact concatenation order, endianness, and hex normalization for seed, leaf, and proof. One encoding, one hash.",
          },
          {
            title: "D · Draw-record schema",
            body: "Column-level definition of the draw row, constrained fields, and permitted lifecycle transitions.",
          },
          {
            title: "E · Reference verifier",
            body: "The complete pure-function verifier, as shipped on this site's interactive pages.",
          },
        ]}
      />

      <H2 id="references" num="※">
        References
      </H2>
      <ol className="mb-6 list-decimal space-y-1.5 pl-5 font-body text-[13.5px] leading-relaxed text-black/70">
        <li id="ref-rfc9381" className="scroll-mt-28">
          Goldberg, Reyzin, Papadopoulos, Včelák.{" "}
          <RefLink href="https://www.rfc-editor.org/rfc/rfc9381">
            <em>Verifiable Random Functions (VRFs)</em>
          </RefLink>
          . RFC 9381, IETF, 2023.
        </li>
        <li id="ref-vrf-origin" className="scroll-mt-28">
          Micali, Rabin, Vadhan.{" "}
          <RefLink href="https://doi.org/10.1109/SFFCS.1999.814584">
            <em>Verifiable Random Functions</em>
          </RefLink>
          . FOCS, 1999.
        </li>
        <li id="ref-merkle" className="scroll-mt-28">
          Merkle.{" "}
          <RefLink href="https://doi.org/10.1007/3-540-48184-2_32">
            <em>
              A Digital Signature Based on a Conventional Encryption Function
            </em>
          </RefLink>
          . CRYPTO, 1987.
        </li>
        <li id="ref-chainlink" className="scroll-mt-28">
          Breidenbach et al.{" "}
          <RefLink href="https://research.chain.link/whitepaper-v2.pdf">
            <em>
              Chainlink 2.0: Next Steps in the Evolution of Decentralized Oracle
              Networks
            </em>
          </RefLink>
          . 2021.
        </li>
        <li id="ref-eip712" className="scroll-mt-28">
          Ethereum.{" "}
          <RefLink href="https://eips.ethereum.org/EIPS/eip-712">
            <em>EIP-712: Typed structured data hashing and signing</em>
          </RefLink>
          . 2018.
        </li>
        <li id="ref-bep126" className="scroll-mt-28">
          BNB Chain.{" "}
          <RefLink href="https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP126.md">
            <em>BEP-126: Introduce Fast Finality Mechanism</em>
          </RefLink>
          . github.com/bnb-chain/BEPs, 2021.
        </li>
        <li id="ref-slash-rules" className="scroll-mt-28">
          BNB Chain.{" "}
          <RefLink href="https://docs.bnbchain.org/bnb-smart-chain/slashing/slash-rules/">
            <em>BSC Slash Rules</em>
          </RefLink>
          . BNB Chain Documentation.
        </li>
      </ol>

      <footer className="mt-14 border-t border-black/10 pt-5 pb-10">
        <p className="font-body text-[12.5px] text-black/45">
          © 2026 Renaiss Engineering · engineering@renaiss.xyz
        </p>
      </footer>
    </article>
  );
}
