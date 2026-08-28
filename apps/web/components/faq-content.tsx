"use client";

/**
 * Plain-language FAQ for the public verifier. A NavTabs peer of /sets.
 *
 * Answers the questions a skeptical ripper actually asks ("can you pick my
 * card?", "can you see it first?", "do I have to trust your servers?") and
 * links into the formal treatment in /whitepaper. Deliberately candid about
 * what is not yet trustless: permissionless entry and resolution liveness are
 * acknowledged and roadmapped, not glossed over.
 *
 * Questions are collapsed by default and expand with the same GSAP height
 * animation as the set rows on /sets. A `#question-id` in the URL
 * auto-expands that item so deep links still land on visible content.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "./gsap";

interface QA {
  id: string;
  q: string;
  a: React.ReactNode;
}

interface Group {
  id: string;
  title: string;
  blurb: string;
  items: QA[];
}

const L = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    href={href}
    className="font-semibold text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
  >
    {children}
  </Link>
);

const GROUPS: Group[] = [
  {
    id: "fairness",
    title: "Is the draw actually fair?",
    blurb: "What stops the house from picking your card.",
    items: [
      {
        id: "pick",
        q: "Can Renaiss choose which card I get?",
        a: (
          <>
            No. Your card is decided by a verifiable random function (ECVRF)
            over a seed that includes the hash of the block your purchase
            settled in, a value that does not exist until after you commit
            funds. For one seed and one published key there is exactly one valid
            result, and every draw carries an{" "}
            <L href="/whitepaper#ecvrf-proof">80-byte proof</L>. If we swapped
            your card, that proof would fail against our published key. You can
            replay the whole thing yourself on <L href="/verify-a-rip">Verify a Rip</L>.
          </>
        ),
      },
      {
        id: "foreknowledge",
        q: "Can Renaiss see my result before I do?",
        a: (
          <>
            Yes. The draw runs on our servers, so we compute your card before
            you see it. But seeing a result is not choosing it. The proof binds
            us to the single outcome the published key produces for your seed.
            We cannot hand you a different card than the math dictates without
            the proof failing. It is{" "}
            <L href="/whitepaper#ecvrf-proof">foreknowledge, not control</L>.
          </>
        ),
      },
      {
        id: "change-set",
        q: "Can Renaiss change a set's cards after the odds are published?",
        a: (
          <>
            No. Every set&apos;s lineup is committed with a{" "}
            <L href="/whitepaper#pinning">Merkle root</L> before its first rip.
            Any card added, removed, or swapped changes that root, so a
            post-publication edit is publicly detectable. Browse the committed
            lineups on <L href="/verify-a-gacha#sets">Sets</L>.
          </>
        ),
      },
      {
        id: "odds",
        q: "Are the odds proven, or do I just have to trust them?",
        a: (
          <>
            Proven. The set-building algorithm, the{" "}
            <L href="/whitepaper#fair-set-adaptive-algorithm">
              Fair Set Algorithm
            </L>
            , is open-source, and we publish the exact inputs each set was built
            from (the candidate pool at its finality checkpoint, the
            configuration, and the block reference). Anyone can re-run it and
            confirm that the published tier bands, the expected-value window,
            and the guaranteed top-tier minimum were actually met for that set,
            rather than simply asserted. You can view the built lineup and its
            odds for any set on <L href="/verify-a-gacha#sets">Sets</L>.
          </>
        ),
      },
    ],
  },
  {
    id: "control",
    title: "Who's in control?",
    blurb: "Where you still rely on us today, stated plainly.",
    items: [
      {
        id: "servers",
        q: "Do I have to trust Renaiss's servers to open a pack?",
        a: (
          <>
            To verify, no. Verification needs only public data and our published
            key, and runs entirely in your browser. To <em>enter</em>, today
            Renaiss submits the on-chain funding transaction on your behalf,
            which does make us a gatekeeper for entry. We acknowledge that.{" "}
            <L href="/whitepaper#lim-entry">Permissionless submission</L>, so
            anyone can rip without us in the loop, is on our roadmap.
          </>
        ),
      },
      {
        id: "unresolved",
        q: "What if Renaiss just doesn't resolve my draw?",
        a: (
          <>
            A paid checkout with no recorded draw is publicly visible, and there
            is no re-roll path. We can&apos;t quietly discard a result we
            don&apos;t like, only fail to publish it. Producing the proof still
            requires our key today. Hardening{" "}
            <L href="/whitepaper#lim-entry">resolution liveness</L>, so that a
            stuck draw can always be forced to settle, is part of the same
            roadmap as permissionless entry.
          </>
        ),
      },
      {
        id: "beacon",
        q: "Is the block hash really unpredictable?",
        a: (
          <>
            At the moment you commit funds, yes. The block that seeds your draw
            has not been produced, so nobody, including us, can know its hash.
            There is, however, a small degree of influence we can&apos;t rule
            out: the validator who ends up producing that block has some say
            over its own hash. That is why we trust the chain, not Renaiss, for
            entropy, and we state the assumption plainly in the
            whitepaper&apos;s <L href="/whitepaper#lim-beacon">Limitations</L>.
          </>
        ),
      },
    ],
  },
  {
    id: "verify",
    title: "Verify it yourself",
    blurb: "Everything above is checkable without trusting us.",
    items: [
      {
        id: "how-verify",
        q: "How do I check my own rip?",
        a: (
          <>
            Open <L href="/verify-a-rip">Verify a Rip</L>, paste your transaction, and{" "}
            <L href="/whitepaper#procedure">step through it</L>: the seed is
            recomputed from public values, the ECVRF proof is verified in your
            browser, and the randomness maps to exactly one slot in the set. It
            uses no key and no database, and it does not require trusting our
            software.
          </>
        ),
      },
      {
        id: "what-is-set",
        q: 'What exactly is a "set"?',
        a: (
          <>
            A set is a fixed lineup of cards, committed before its first rip and
            drawn down{" "}
            <L href="/whitepaper#slot-mapping">without replacement</L>. Every
            set, whether live, ripped out, or upcoming, is browsable on{" "}
            <L href="/verify-a-gacha#sets">Sets</L>.
          </>
        ),
      },
      {
        id: "spec",
        q: "Where's the full specification?",
        a: (
          <>
            The <L href="/whitepaper">whitepaper</L> covers the construction end
            to end: the seed formula, the ECVRF suite, the Merkle commitment,
            the append-only ledger, and a candid security analysis.
          </>
        ),
      },
    ],
  },
];

/** Breathing room between the chrome and a question brought into view. */
const REVEAL_GAP = 12;
/** Long enough for a glide across the page to have arrived. */
const SETTLE_MS = 400;

function FaqItem({ item }: { item: QA }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  /**
   * Bring the question being opened to the top of the reading area. A question
   * opens in place, so one near the foot of the screen unfolds past it and the
   * reader clicks to no visible effect; one under the sticky chrome has the
   * same problem from the other end.
   *
   * It moves every time rather than only when the answer would not fit. A rule
   * that sometimes scrolls and sometimes does not reads as the page deciding
   * on its own, and the cases are impossible to tell apart before clicking —
   * always landing in the same place is the predictable one.
   *
   * Aimed before the expansion starts. Nothing above the question changes
   * height (each answer opens independently), so the target is already known
   * and there is no reason to make the reader wait out the tween first.
   *
   * The last questions on the page are the exception: the page is not yet tall
   * enough to put them at the top, and the browser caps the scroll at today's
   * bottom. The height that would allow it is the answer's own, so those get a
   * second aim once it has unfolded — see the tween below.
   */
  const shortBy = useRef<{ want: number; capped: number } | null>(null);

  const scrollToQuestion = (top: number) =>
    window.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });

  const revealOnOpen = () => {
    const el = rowRef.current;
    if (!el) return;
    const doc = document.documentElement;
    const chromeH =
      parseFloat(getComputedStyle(doc).getPropertyValue("--chrome-h")) || 0;
    const want =
      window.scrollY + el.getBoundingClientRect().top - chromeH - REVEAL_GAP;
    const capped = doc.scrollHeight - doc.clientHeight;
    shortBy.current = want > capped ? { want, capped } : null;
    if (Math.abs(want - window.scrollY) < 2) return; // already there
    scrollToQuestion(want);
  };

  /**
   * The second aim, once the answer has made the room for it. Deferred past
   * the end of the expansion rather than run at it: the first glide is often
   * still travelling then, and a reader caught mid-flight looks exactly like a
   * reader who has scrolled off on their own.
   */
  const settleTimer = useRef(0);
  const finishReveal = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const pending = shortBy.current;
      shortBy.current = null;
      // Only if the reader is still where the capped scroll left them. If they
      // have moved in the meantime, that is their choice and it stands.
      if (!pending || Math.abs(window.scrollY - pending.capped) > 8) return;
      scrollToQuestion(pending.want);
    }, SETTLE_MS);
  };
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Deep link: expand the item named in the URL hash after the browser's
  // native anchor scroll has already landed on it. Also covers same-document
  // hash changes (e.g. a link to another question while already on /faq).
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${item.id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [item.id]);

  // Same motion as the /sets set rows: grow from 0 height, power2.inOut.
  useGSAP(
    () => {
      const body = bodyRef.current;
      if (!body) return;
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      if (open) {
        gsap.to(body, {
          height: "auto",
          autoAlpha: 1,
          duration: 0.45,
          ease: "power2.inOut",
          clearProps: "height", // let reflow (resize, font swap) resize it after
          onComplete: finishReveal,
        });
      } else {
        gsap.to(body, {
          height: 0,
          autoAlpha: 0,
          duration: 0.35,
          ease: "power2.inOut",
        });
      }
    },
    { dependencies: [open] },
  );

  return (
    <div
      ref={rowRef}
      id={item.id}
      // Landing height for a deep link, kept level with the reveal above: the
      // chrome's height is not a constant, so a fixed margin either buries the
      // question or leaves it adrift.
      className={`scroll-mt-[calc(var(--chrome-h,64px)+12px)] rounded-lg border bg-raised transition-colors ${
        open ? "border-white/20" : "border-hairline hover:border-white/20"
      }`}
    >
      <h3 className="group flex items-center pr-4">
        <button
          type="button"
          onClick={() => {
            if (!open) revealOnOpen();
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-controls={`${item.id}-answer`}
          className="flex flex-1 items-center gap-4 p-5 pr-2 text-left"
        >
          <span className="flex-1 font-display text-[15px] font-semibold">
            {item.q}
          </span>
          <span
            aria-hidden
            className={`font-body text-xs text-muted transition-transform group-hover:text-white ${
              open ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </button>
      </h3>
      <div
        ref={bodyRef}
        id={`${item.id}-answer`}
        className="overflow-hidden"
        style={{ height: 0, opacity: 0, visibility: "hidden" }}
      >
        <p className="px-5 pb-5 font-body text-[14px] leading-[1.7] text-muted">
          {item.a}
        </p>
      </div>
    </div>
  );
}

export function FaqContent() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <h1 className="font-display text-[34px] font-bold leading-[1.06] tracking-tight md:text-[48px]">
          Frequently asked questions
        </h1>
        <p className="mt-3 font-body text-[15px] leading-relaxed text-muted">
          Straight answers about what&apos;s provable, what still relies on us,
          and how to check any of it yourself. For the formal treatment, see the{" "}
          <L href="/whitepaper">whitepaper</L>.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        {GROUPS.map((group) => (
          <section
            key={group.id}
            id={group.id}
            aria-labelledby={`${group.id}-h`}
          >
            <div className="mb-5 border-b border-hairline pb-3">
              <h2
                id={`${group.id}-h`}
                className="font-display text-xl font-semibold"
              >
                {group.title}
              </h2>
              <p className="mt-1 font-body text-[13px] text-muted">
                {group.blurb}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {group.items.map((item) => (
                <FaqItem key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-14 border-t border-hairline pt-6">
        <p className="font-body text-[13px] text-muted">
          Still have a question the math should answer?{" "}
          <L href="/whitepaper">Read the whitepaper</L> or replay a rip on{" "}
          <L href="/verify-a-rip">Verify a Rip</L>.
        </p>
      </footer>
    </main>
  );
}
