import Link from "next/link";
import type { Metadata } from "next";

const BASE = process.env["NEXT_BASE_PATH"] ?? "";
const TARGET = `${BASE}/verify-a-gacha`;

export const metadata: Metadata = {
  title: "Verify a Gacha — Renaiss",
  robots: { index: false },
};

/**
 * Legacy URL: the page moved to /verify-a-gacha. Same static-export-friendly
 * redirect as the root page — an inline script redirects instantly (carrying
 * any query/hash, so #sets and #packing deep links survive), a meta refresh
 * covers script-blocked browsers, and a no-JS link covers everything else.
 */
export default function LegacyBehindTheRip() {
  return (
    <main className="flex min-h-[82vh] flex-col items-center justify-center gap-4 px-6">
      <meta httpEquiv="refresh" content={`1;url=${TARGET}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(TARGET)} + location.search + location.hash);`,
        }}
      />
      <p className="font-body text-[13px] text-muted">
        <Link href="/verify-a-gacha" className="underline underline-offset-2">
          Continue to Verify a Gacha
        </Link>
      </p>
    </main>
  );
}
