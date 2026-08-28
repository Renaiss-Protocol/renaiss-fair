/**
 * Data for the whitepaper §4.4 inclusion-proof demo: a self-contained
 * SAMPLE lineup of 32 cards — exactly five pairing rounds, so the whole
 * tree fits on screen (real sets work identically, just deeper).
 *
 * Nothing here touches the fixture world: the cards are generated
 * deterministically below, but every hash, sibling path and the root are
 * computed with the production tree code (lib/merkle) — the math the demo
 * teaches is real end to end.
 */
import { keccak256, stringToHex } from "viem";
import { merkleProofOf, recomputeRoot, type MerkleLeafInput } from "./merkle";

export interface MerkleFoldDemoData {
  /** The sample card's committed facts — the leaf hashes exactly these. */
  tokenId: string;
  /** The substitute collectible the demo's tamper control swaps into the
   * leaf — a token id from OUTSIDE the committed lineup, i.e. the real
   * attack: an operator serving proof data for a card that was never
   * committed. Deterministic so server and client render identically. */
  tamperedTokenId: string;
  salt: string;
  /** Raw committed integer (2 implied decimals) — shown verbatim. */
  valueInUsd: number;
  /** The card's position in the lineup, tokenId ASC, 1-based (Card₃₀). */
  position: number;
  /** Its round-1 partner (the neighbouring leaf) — full facts, so the
   * partner cell can prove its own leaf too. */
  partner: { position: number; tokenId: string; salt: string; valueInUsd: number };
  /** The sibling path, leaf → root order — five entries. */
  siblings: string[];
  /** The root THIS 32-card lineup commits (production tree code). */
  root: string;
  setSize: number;
}

const SET_SIZE = 32;
/** Where the sample card sits in the lineup (1-based) — Card₃₀. */
const POSITION = 30;

function build(): MerkleFoldDemoData {
  // 32 sample cards: consecutive token ids (already tokenId ASC), varied
  // committed values, and per-card salts derived deterministically so the
  // demo renders identically on every build.
  const leaves: MerkleLeafInput[] = Array.from({ length: SET_SIZE }, (_, i) => ({
    tokenId: String(730001 + i),
    salt: keccak256(stringToHex(`renaiss-whitepaper-demo-card-${i + 1}`)),
    valueInUsd: 800 + ((i * 137) % 29) * 100,
  }));

  const card = leaves[POSITION - 1]!;
  // With 32 leaves (a full power of two) the round-1 partner of an
  // even-positioned card is simply its lower neighbour.
  const partner = leaves[POSITION - 2]!;

  return {
    tokenId: card.tokenId,
    // A fixed id well past the lineup's 730001…730032 range — the card an
    // operator might try to sneak into Card₃₀'s slot.
    tamperedTokenId: String(730001 + 500),
    salt: card.salt,
    valueInUsd: card.valueInUsd,
    position: POSITION,
    partner: {
      position: POSITION - 1,
      tokenId: partner.tokenId,
      salt: partner.salt,
      valueInUsd: partner.valueInUsd,
    },
    siblings: merkleProofOf(leaves, card.tokenId)!,
    root: recomputeRoot(leaves).root,
    setSize: SET_SIZE,
  };
}

export const MERKLE_FOLD_DEMO: MerkleFoldDemoData = build();
