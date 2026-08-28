import type { Metadata } from "next";
import { WhitepaperArticle } from "@/components/whitepaper-content";
import {
  ReadingProgress,
  WhitepaperMobileToc,
} from "@/components/whitepaper-mobile-nav";
import { WhitepaperPaletteSwitcher } from "@/components/whitepaper-palette-switcher";
import { WhitepaperToc } from "@/components/whitepaper-toc";
import { SHOW_DESIGN_CONFIG } from "@/lib/flags";

export const metadata: Metadata = {
  title: "Renaiss Gacha Whitepaper",
  description:
    "Committed collectible sets, deterministic fair-set construction, and verifiable pack draws.",
};

export default function WhitepaperPage() {
  return (
    <div className="wp-page min-h-screen bg-[#F8F7F4] text-[#17171A]">
      <ReadingProgress />
      <WhitepaperMobileToc />
      {SHOW_DESIGN_CONFIG && <WhitepaperPaletteSwitcher />}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-8 px-6 py-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:py-12">
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2">
            <WhitepaperToc />
          </div>
        </aside>
        <WhitepaperArticle />
      </div>
    </div>
  );
}
