/**
 * Provenance-labeled data chips. Every value in the prover carries a colored
 * source dot; hovering reveals where the datum comes from: on-chain, the
 * Renaiss API/DB, or computed locally in the browser.
 */
import Link from "next/link";

export type DataSource = "onchain" | "api" | "local";

const SOURCES: Record<
  DataSource,
  { color: string; title: string; blurb: string }
> = {
  onchain: {
    color: "#78FF6C",
    title: "On-chain",
    blurb: "Public on BscScan, so it needs no trust in Renaiss.",
  },
  api: {
    color: "#FFC800",
    title: "API · Renaiss DB",
    blurb: "Served by Renaiss.",
  },
  local: {
    color: "#FFFFFF",
    title: "Computed in your browser",
    blurb:
      "Derived on this page from the inputs above, so there is nothing to trust.",
  },
};

export function SourceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {(Object.keys(SOURCES) as DataSource[]).map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1.5 font-body text-[11px] text-muted"
        >
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: SOURCES[s].color }}
          />
          {SOURCES[s].title}
        </span>
      ))}
    </div>
  );
}

export function DataChip({
  label,
  value,
  full,
  source,
  detail,
  href,
  externalHref,
}: {
  label: string;
  value: string;
  /** Untruncated value shown inside the hover card. */
  full?: string | undefined;
  source: DataSource;
  /** One line naming the exact origin (event, table/route, or formula). */
  detail: string;
  /** When set, the value becomes a dotted-underline link to a whitepaper section. */
  href?: string;
  /** Off-site link (block explorer) — opens a new tab; wins over `href`. */
  externalHref?: string;
}) {
  const s = SOURCES[source];
  const linkClass =
    "underline decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:decoration-2";
  return (
    <span
      data-chip
      className="group relative inline-flex max-w-full cursor-default items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 py-1.5"
    >
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: s.color }}
      />
      <span className="shrink-0 font-body text-[11px] text-muted">{label}</span>
      <span data-chip-value className="truncate font-mono-num text-[12px]">
        {externalHref ? (
          <a
            href={externalHref}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {value}
          </a>
        ) : href ? (
          <Link href={href} className={linkClass}>
            {value}
          </Link>
        ) : (
          value
        )}
      </span>

      {/* hover card — `hidden` until hover so it never occupies layout (an
          opacity-0 card still reserves its 18rem width, which pushed the page
          wider than a phone and forced a horizontal scroll on mobile). */}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden max-w-[calc(100vw-2rem)] w-72 -translate-x-1/2 translate-y-1 rounded-md border border-hairline p-3 text-left opacity-0 shadow-card transition-all duration-150 group-hover:block group-hover:translate-y-0 group-hover:opacity-100 group-hover:delay-150"
        style={{ background: "#1C1C20" }}
        role="tooltip"
      >
        <span className="flex items-center gap-2">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: s.color }}
          />
          <span
            className="font-display text-[12px] font-semibold"
            style={{ color: s.color }}
          >
            {s.title}
          </span>
        </span>
        <span className="mt-1 block font-body text-[12px] leading-snug text-white">
          {detail}
        </span>
        <span className="mt-1 block font-body text-[11px] leading-snug text-muted">
          {s.blurb}
        </span>
        {full && (
          <span className="mt-2 block break-all border-t border-hairline pt-2 font-mono-num text-[10px] leading-relaxed text-muted">
            {full}
          </span>
        )}
        {/* arrow */}
        <span
          className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-hairline"
          style={{ background: "#1C1C20" }}
        />
      </span>
    </span>
  );
}
