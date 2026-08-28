import Image from "next/image";
import Link from "next/link";
import logoIcon from "@/public/logo-icon.svg";

const BASE = process.env["NEXT_BASE_PATH"] ?? "";
const TARGET = `${BASE}/verify-a-rip`;

/**
 * Static-export-friendly root redirect. `redirect()` would export a JS-only
 * error shell, so instead: an inline script redirects instantly (carrying any
 * query/hash), a meta refresh covers script-blocked browsers, and a branded
 * splash with a no-JS link covers everything else. Most visitors see this for
 * a few milliseconds at most.
 */
export default function Home() {
  return (
    <main className="flex min-h-[82vh] flex-col items-center justify-center gap-6 px-6">
      <meta httpEquiv="refresh" content={`1;url=${TARGET}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(TARGET)} + location.search + location.hash);`,
        }}
      />
      <Image src={logoIcon} alt="Renaiss" width={44} height={44} priority />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-display text-[15px] font-semibold">
          Opening the prover
        </p>
        <p className="font-body text-[13px] text-muted">
          Every rip, verifiable in your browser.
        </p>
      </div>
      <span className="relative block h-[3px] w-44 overflow-hidden rounded-full bg-white/10">
        <span
          className="loading-sweep absolute inset-y-0 left-0 w-1/3 rounded-full"
          style={{ background: "var(--grad-brand)" }}
        />
      </span>
      <noscript>
        <p className="font-body text-[13px] text-muted">
          <Link href="/verify-a-rip" className="underline underline-offset-2">
            Continue to Verify a Rip
          </Link>
        </p>
      </noscript>
    </main>
  );
}
