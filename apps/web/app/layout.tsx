import type { Metadata } from "next";
import { Manrope, Poppins } from "next/font/google";
import Image from "next/image";
import logoFull from "@/public/logo-full.svg";
import logoIcon from "@/public/logo-icon.svg";
import { Suspense } from "react";
import { NavTabs } from "@/components/nav-tabs";
import { WhitepaperFab } from "@/components/whitepaper-fab";
import { HeaderMeta } from "@/components/header-meta";
import { SiteChrome } from "@/components/site-chrome";
import {
  DEFAULT_WHITEPAPER_PALETTE,
  DEFAULT_WHITEPAPER_SURFACE,
  WHITEPAPER_PALETTES,
  WHITEPAPER_SURFACES,
} from "@/lib/whitepaper-palette";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});

/** Build-time base path (GitHub Pages project page); "" everywhere else. */
const BASE_PATH = process.env["NEXT_BASE_PATH"] ?? "";
const WHITEPAPER_PATH = `${BASE_PATH}/whitepaper`;
const WHITEPAPER_PALETTE_IDS = JSON.stringify(
  WHITEPAPER_PALETTES.map((palette) => palette.id),
);
const WHITEPAPER_SURFACE_IDS = JSON.stringify(
  WHITEPAPER_SURFACES.map((surface) => surface.id),
);
const WHITEPAPER_PREPAINT_SCRIPT = `(function(){var root=document.documentElement;var onWhitepaper=location.pathname.startsWith(${JSON.stringify(WHITEPAPER_PATH)});root.dataset.pageTheme=onWhitepaper?"light":"dark";if(onWhitepaper){var params=new URLSearchParams(location.search);var requested=params.get("palette");var allowed=${WHITEPAPER_PALETTE_IDS};root.dataset.wpPalette=allowed.includes(requested)?requested:${JSON.stringify(DEFAULT_WHITEPAPER_PALETTE)};var surface=params.get("surface");var surfaces=${WHITEPAPER_SURFACE_IDS};root.dataset.wpSurface=surfaces.includes(surface)?surface:${JSON.stringify(DEFAULT_WHITEPAPER_SURFACE)};}else{delete root.dataset.wpPalette;delete root.dataset.wpSurface;}})();`;

export const metadata: Metadata = {
  title: "Renaiss — Verify Your Rip",
  description:
    "Prove your pack rip resolved to the card you received. Public, cryptographic, reproducible.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: the pre-paint theme script in <head> mutates
  // data-page-theme on <html> before React hydrates, so the attribute
  // legitimately differs from the server HTML. Suppression is shallow — it
  // only covers this element's attributes, not children.
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * The header theme and whitepaper palette are data attributes on
         * <html>. WhitepaperFab and the palette switcher update them after
         * hydration, but a hard load must paint with the correct values
         * immediately. This static allowlisted script runs before first paint.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: WHITEPAPER_PREPAINT_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-screen bg-canvas text-white">
        {/* The caveat strip and the header stick as one block: the strip
            collapses on the way down and the nav closes the gap behind it,
            rather than the nav sliding out from under a hole.

            The header is a single row at every width, laid out as three
            columns so the nav sits in the true centre whatever the logo
            weighs. The side columns may compress — on a phone they are about
            43px, enough for the logo and no more. */}
        <SiteChrome>
        <header className="site-header grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 border-b border-hairline px-3 py-3 sm:gap-x-4 sm:px-6 sm:py-4 md:px-10">
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            {/* Below sm the wordmark is dropped (icon only) to keep the
                header on a single row. */}
            <span className="logo-on-dark">
              <Image
                src={logoIcon}
                alt="Renaiss"
                width={28}
                height={28}
                priority
                className="sm:hidden"
                style={{ height: 24, width: "auto" }}
              />
              <Image
                src={logoFull}
                alt="Renaiss"
                width={118}
                height={28}
                priority
                className="hidden sm:block"
                style={{ height: 28, width: "auto" }}
              />
            </span>
            <span className="logo-on-light hidden items-center gap-2">
              <Image
                src={logoIcon}
                alt="Renaiss"
                width={28}
                height={28}
                style={{ height: 24, width: "auto" }}
              />
              <span className="hidden font-display text-lg font-bold text-[#17171A] sm:inline">
                renaiss
              </span>
            </span>
            {/* No border — the weight carries it. Hidden below sm: a
                full-size nav centred by the grid leaves the side columns about
                43px, which the logo alone fills. Restoring the tag on a phone
                means a smaller nav or an off-centre one. */}
            <span className="hidden whitespace-nowrap font-body text-[11px] font-semibold text-muted sm:inline-block lg:text-xs">
              Provably Fair
            </span>
          </div>
          <div className="flex min-w-0 justify-center">
            <Suspense fallback={null}>
              <NavTabs />
            </Suspense>
          </div>
          <HeaderMeta />
        </header>
        </SiteChrome>
        {children}
        <Suspense fallback={null}>
          <WhitepaperFab />
        </Suspense>
      </body>
    </html>
  );
}
