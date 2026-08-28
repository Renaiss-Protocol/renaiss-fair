/**
 * Generates lib/api/fixtures.json — a cryptographically REAL mock world.
 *
 * The VRF keypair, proofs, and draw resolution below use the exact production
 * math:
 *
 *   α     = keccak256(tag ‖ blockHash ‖ onChainPackId ‖ checkoutId as 32-byte BE)
 *   (β,π) = ECVRF-EDWARDS25519-SHA512-ELL2(sk, α)      // RFC 9381, suite 0x04
 *   index = keccak256(β) mod remaining, sampled without replacement
 *           over the lineup sorted by tokenId ASC, draws in checkoutId order
 *
 * so the app's in-browser ECVRF verification passes against these fixtures
 * for real — nothing about the *verification* is mocked, only the transport.
 *
 * Run: pnpm generate-fixtures  (output is committed; regeneration is optional)
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { concat, hexToBigInt, keccak256, stringToHex, type Hex } from "viem";
import { keygen, prove, proofToHash } from "@renaiss/ecvrf";
import { recomputeRoot } from "../lib/merkle";

const bytesToHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return Uint8Array.from(s.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
};
const rand = (n: number): Hex => bytesToHex(randomBytes(n));

// ── VRF keypair (fixture-only; regenerated on every run) ────────────────────
const { SK, pkString } = keygen();
const vrfPublicKeyHex = bytesToHex(pkString);

// The operator's draw-seed derivation (see @renaiss/verifiable-draw):
// α = keccak256(tag ‖ blockHash ‖ onChainPackId ‖ checkoutId₃₂)
const SEED_DOMAIN_TAG_HEX = stringToHex("renaiss-gacha-v3-1");
const deriveSeed = (
  blockHash: Hex,
  onChainPackId: Hex,
  checkoutId: number,
): Hex =>
  keccak256(
    concat([
      SEED_DOMAIN_TAG_HEX,
      blockHash,
      onChainPackId,
      `0x${checkoutId.toString(16).padStart(64, "0")}` as Hex,
    ]),
  );

const evaluate = (checkoutId: number, blockHash: Hex, onChainPackId: Hex) => {
  const alpha = deriveSeed(blockHash, onChainPackId, checkoutId);
  const { piString } = prove(SK, hexToBytes(alpha));
  const proof = bytesToHex(piString);
  const beta = proofToHash(piString);
  if (!beta) throw new Error("proofToHash failed on a freshly generated proof");
  const randomness = bytesToHex(beta);
  return { alpha, proof, randomness };
};

const deriveEligibleIndex = (randomness: Hex, count: number): number =>
  Number(hexToBigInt(keccak256(randomness)) % BigInt(count));

// Set-build seed (whitepaper §4.4), mirroring deriveTaskSeed in
// @renaiss/replay-fair-set:
// α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ onChainPackId ‖ setId₃₂).
// Distinct from the per-draw seed above (that one uses checkoutId); this one
// seeds the Fair Set Adaptive Algorithm build for a whole set.
const deriveGenSeed = (
  blockHash: Hex,
  blockNumber: number,
  onChainPackId: Hex,
  setId: number,
): Hex =>
  keccak256(
    concat([
      SEED_DOMAIN_TAG_HEX,
      blockHash,
      `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex,
      onChainPackId,
      `0x${setId.toString(16).padStart(64, "0")}` as Hex,
    ]),
  );

// ── World ────────────────────────────────────────────────────────────────────
type Tier = "s" | "a" | "b" | "c";
interface CardDef extends CardIdentity {
  tier: Tier;
  valueInUsd: number;
}

// The shop's public asset store — pack media and graded-card renders.
const BLOB = "https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com";

// Card identities cycle through this pool across every pack's lineups.
// Each is a REAL graded collectible from the shop's public marketplace —
// name, set, grade, and slab render all agree, exactly as a live lineup
// would. (Duplicate identities across a lineup are normal; the shop lists
// duplicates too.) Field names mirror the production collectible schema.
interface CardIdentity {
  name: string;
  setName: string;
  gradingCompany: string;
  grade: string;
  year: number;
  frontImageUrl: string;
}

const CARD_IDENTITIES: CardIdentity[] = [
  { name: "Marnie's Morpeko", setName: "Pokemon Svp En-Sv Black Star Promo", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/PSA132435174/nft_image_silver.jpg` },
  { name: "Charizard EX", setName: "Ruler of the Black Flame", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2025, frontImageUrl: `${BLOB}/graded-cards-renders/PSA105184104/nft_image.jpg` },
  { name: "Sanji ALT ART L", setName: "One Piece Card Game Paramount War Japanese", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2023, frontImageUrl: `${BLOB}/graded-cards-renders/BGS0017102178/nft_image.jpg` },
  { name: "Umbreon", setName: "Pokemon Simplified Chinese Cbb2 C-Gem Pack Vol 2", gradingCompany: "BGS", grade: "9.5 Gem Mint", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/PSA124357082/nft_image.jpg` },
  { name: "Mega Sableye & Tyranitar Gx", setName: "Pokemon Japanese Sun & Moon Miracle Twins", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2025, frontImageUrl: `${BLOB}/graded-cards-renders/PSA111794355/nft_image_golden.jpg` },
  { name: "Rocket's Mewtwo Ex", setName: "Pokemon Japanese Sv10-Glory Of Team Rocket", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2019, frontImageUrl: `${BLOB}/graded-cards-renders/PSA130058967/nft_image_silver.jpg` },
  { name: "Blastoise & Piplup GX", setName: "Pokemon Sun & Moon: Cosmic Eclipse", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2025, frontImageUrl: `${BLOB}/graded-cards-renders/PSA127636775/nft_image.jpg` },
  { name: "Pikachu", setName: "Pokemon Japanese Sv2a-Pokemon 151", gradingCompany: "PSA", grade: "8 NM-MT", year: 2019, frontImageUrl: `${BLOB}/graded-cards-renders/PSA120526817/nft_image.jpg` },
  { name: "Umbreon & Darkrai GX", setName: "Pokemon Japanese Sun & Moon Tag Team GX All Stars", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2023, frontImageUrl: `${BLOB}/graded-cards-renders/PSA103948410/nft_image_silver.jpg` },
  { name: "Greavard", setName: "Pokemon Japanese Sv1v-Violet Ex", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2019, frontImageUrl: `${BLOB}/graded-cards-renders/PSA84912580/nft_image.jpg` },
  { name: "Sogeking", setName: "One Piece Japanese OP03-Pillars of Strength", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2023, frontImageUrl: `${BLOB}/graded-cards-renders/BGS0015765900/nft_image.jpg` },
  { name: "Dark Magneton-Holo", setName: "Pokemon Japanese Rocket", gradingCompany: "BGS", grade: "9 Mint", year: 2023, frontImageUrl: `${BLOB}/graded-cards-renders/PSA152541644/nft_image_silver.jpg` },
  { name: "Giratina V", setName: "Pokemon Simplified Chinese Cs6b C-Marine Shadow: Banish", gradingCompany: "PSA", grade: "8 NM-MT", year: 1997, frontImageUrl: `${BLOB}/graded-cards-renders/PSA115538587/nft_image.jpg` },
  { name: "Espeon & Deoxys Gx", setName: "Pokemon Sm Black Star Promo", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2024, frontImageUrl: `${BLOB}/graded-cards-renders/PSA123805665/nft_image.jpg` },
  { name: "Full Art/Vaporeon V", setName: "Pokemon Japanese Sword & Shield Eevee Heroes", gradingCompany: "PSA", grade: "8 NM-MT", year: 2020, frontImageUrl: `${BLOB}/graded-cards-renders/PSA73429704/nft_image_silver.jpg` },
  { name: "Gengar-Holo", setName: "Pokemon Japanese Fossil", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2021, frontImageUrl: `${BLOB}/graded-cards-renders/PSA97437006/nft_image_silver.jpg` },
  { name: "Marnie", setName: "Japanese S Promo", gradingCompany: "PSA", grade: "6 Excellent-Mint", year: 1997, frontImageUrl: `${BLOB}/graded-cards-renders/PSA84557061/nft_image.jpg` },
  { name: "Pikachu-Rev.Foil", setName: "Pokemon Japanese 25th Anniversary Collection", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/PSA140584940/nft_image.jpg` },
  { name: "Articuno", setName: "Pokemon Fossil", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2021, frontImageUrl: `${BLOB}/graded-cards-renders/PSA73605379/nft_image.jpg` },
  { name: "Pikachu Outbreak!", setName: "Pokemon Japanese Xy Promo", gradingCompany: "PSA", grade: "9 Mint", year: 1999, frontImageUrl: `${BLOB}/graded-cards-renders/PSA82881503/nft_image.jpg` },
  { name: "Charizard V", setName: "VSTAR Universe", gradingCompany: "PSA", grade: "9 Mint", year: 2014, frontImageUrl: `${BLOB}/graded-cards-renders/PSA73309366/nft_image.jpg` },
  { name: "Pikachu", setName: "Pokemon Japanese S Promo", gradingCompany: "PSA", grade: "9 Mint", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/PSA116757789/nft_image.jpg` },
  { name: "Galarian Articuno V", setName: "Astral Radiance - English", gradingCompany: "PSA", grade: "10 Gem Mint", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/CGC6065330011/nft_image_silver.jpg` },
  { name: "Slowpoke & Psyduck Gx", setName: "Pokemon Simplified Chinese Csm2a C-Shining Synergy: Shower", gradingCompany: "CGC", grade: "10 Pristine", year: 2022, frontImageUrl: `${BLOB}/graded-cards-renders/PSA80033328/nft_image.jpg` },
];
// Placeholder rarity config — a representative tier config
// (targetNumberOfTokensPercentage 75/20/4/1, floorValueInUsd per tier).
// tier 0 → C (purple) … tier 3 → S (yellow, ~1% top tier).
// Money is an integer with 2 implied decimals (the production scale the
// verify API serves): 1000 = $10.00.
const TIER_CONFIG = [
  { tier: 0, label: "c" as Tier, floorValueInUsd: 1_000, minNumberOfTokens: 75, targetNumberOfTokensPercentage: 75 },
  { tier: 1, label: "b" as Tier, floorValueInUsd: 6_000, minNumberOfTokens: 20, targetNumberOfTokensPercentage: 20 },
  { tier: 2, label: "a" as Tier, floorValueInUsd: 9_000, minNumberOfTokens: 4, targetNumberOfTokensPercentage: 4 },
  { tier: 3, label: "s" as Tier, floorValueInUsd: 10_000, minNumberOfTokens: 1, targetNumberOfTokensPercentage: 1 },
];

// Exact tier counts for a lineup of `size` cards: top tiers first at their
// target percentage (floored at the config minimum scaled to set size, and
// never below 1 for the top tier — the "guaranteed ≥1 top-tier" rule), the
// base tier soaks up the remainder.
const tierPoolFor = (size: number): Tier[] => {
  const pool: Tier[] = [];
  let used = 0;
  for (const cfg of [...TIER_CONFIG].reverse()) {
    if (cfg.tier === 0) break;
    const n = Math.max(
      cfg.tier === 3 ? 1 : 0,
      Math.round((size * cfg.targetNumberOfTokensPercentage) / 100),
    );
    for (let k = 0; k < n; k++) pool.push(cfg.label);
    used += n;
  }
  while (used < size) {
    pool.push("c");
    used++;
  }
  // Fisher–Yates so tiers land anywhere in the tokenId order (the set build
  // is random; dots in the arena matrix shouldn't show a repeating cadence).
  for (let i = pool.length - 1; i > 0; i--) {
    const j =
      (randomBytes(2).readUInt16BE(0)) % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool;
};

// floorValueInUsd is the tier's value floor; jitter upward from it.
const TIER_FLOOR_USD: Record<Tier, number> = Object.fromEntries(
  TIER_CONFIG.map((c) => [c.label, c.floorValueInUsd]),
) as Record<Tier, number>;

// Two demo packs, mirroring the pack-selection flow on the gacha site: pick a
// pack first, then browse its sets. Each pack owns its sets; the demo rip
// lives in the FIRST pack's live set. Chronology within a pack: everything
// below the live set is fully ripped, the live set is mid-draw, everything
// above is formed but undrawn (upcoming).
interface PackDef {
  packId: string;
  name: string;
  setCount: number;
  /** The set currently mid-draw. */
  liveSetId: number;
  /** Fraction of the live set already drawn. */
  liveDrawnFraction: number;
  /** Pack-card media (served by the future pack-info API). */
  bgUrl: string;
  bgVideoUrl: string | null;
  imgUrl: string;
}

const PACK_DEFS: PackDef[] = [
  {
    packId: "7f3c2a10-9d4e-4b8f-a1c6-2e5d8f907b31",
    name: "Genesis Holo Vault",
    setCount: 14,
    liveSetId: 13,
    liveDrawnFraction: 0.6,
    bgUrl: `${BLOB}/packs/cozy/bg.jpg`,
    bgVideoUrl: `${BLOB}/packs/cozy/bg.webp`,
    imgUrl: `${BLOB}/packs/cozy/pack%20rotate.gif`,
  },
  {
    packId: "c2b7e6d4-1a83-47f0-9c5e-8d21f3a4b906",
    name: "Aurora Prism Cache",
    setCount: 6,
    liveSetId: 5,
    liveDrawnFraction: 0.35,
    bgUrl: `${BLOB}/packs/omega/bg.jpg`,
    bgVideoUrl: `${BLOB}/packs/omega/bg.omega-dmFvzPPuMr3jjYpaMEnYNXc5Td6VF4.mp4`,
    imgUrl: `${BLOB}/packs/omega/pack.gif`,
  },
];

// Real sets are never small — every lineup is 500–1000 cards.
const sizes = new Map<string, number>();
const sizeFor = (packId: string, setId: number): number => {
  const key = `${packId}:${setId}`;
  if (!sizes.has(key)) {
    sizes.set(key, 500 + (randomBytes(2).readUInt16BE(0) % 501));
  }
  return sizes.get(key)!;
};
const drawPlanFor = (def: PackDef, setId: number, size: number): number =>
  setId === def.liveSetId
    ? Math.floor(size * def.liveDrawnFraction)
    : setId < def.liveSetId
      ? size
      : 0;

let identityPtr = 0;
const buildCards = (packId: string, setId: number): CardDef[] => {
  const size = sizeFor(packId, setId);
  const tiers = tierPoolFor(size);
  return Array.from({ length: size }, (_, j) => {
    const tier = tiers[j]!;
    const floor = TIER_FLOOR_USD[tier];
    const jitter = 1 + (randomBytes(1)[0]! % 31) / 100; // floor … +30%
    const identity = CARD_IDENTITIES[identityPtr++ % CARD_IDENTITIES.length]!;
    return { ...identity, tier, valueInUsd: Math.round(floor * jitter) };
  });
};

// THE demo rip: deep inside the first pack's live set draw history —
// exercises the fast-forward montage (hundreds of compressed draws), the
// detailed approach, and the finale.
//
// Its txHash is a REAL production rip, not a random one: in API mode the
// demo button resolves it against the live /verify/rip (client.ts skips
// the fixture scan there), while mock mode serves this fixture world for
// the same hash. Every other draw keeps a random hash.
const DEMO_TX_HASH =
  "0x8069406ab4f861d8e86d75235f27ed9aeb0cc7837cc38a4fbc80aa5f1de3e30d";
const DEMO_PACK = PACK_DEFS[0]!;
const DEMO = {
  packId: DEMO_PACK.packId,
  setId: DEMO_PACK.liveSetId,
  drawOrdinal:
    drawPlanFor(
      DEMO_PACK,
      DEMO_PACK.liveSetId,
      sizeFor(DEMO_PACK.packId, DEMO_PACK.liveSetId),
    ) - 6,
};

const demoBuyer = rand(20);

let nextCheckoutId = 1;
let tokenSeq = 41_000n;

// Set-genesis provenance (mocked chain data, real derived seed).
const BASE_TS = 1_750_000_000; // fixed epoch base — keeps fixtures deterministic-ish

const packs = PACK_DEFS.map((def, packIndex) => {
  const onChainPackId = rand(32);
  const tvmAddress = rand(20);
  // Later packs launch later — offset their chronology and block heights so a
  // newer pack's sets are built after the previous pack's began.
  const tsOffset = packIndex * 20 * 86_400;
  const blockBase = 21_400_000 + packIndex * 30_000;

  const sets = Array.from(
    { length: def.setCount },
    (_, i) => i + 1,
  ).map((setId) => {
  const cards = buildCards(def.packId, setId).map((c) => ({
    ...c,
    tokenId: (tokenSeq += BigInt(1 + (randomBytes(1)[0]! % 900))).toString(),
    status: "created" as string,
    merkleSalt: rand(32) as string,
  }));

  // Availability root — the app's own recomputeRoot (lib/merkle.ts), which
  // mirrors the operator's production tree: leaf = keccak256(abi.encode(
  // tokenId, salt, valueInUsd)), OpenZeppelin sorted-pair parents. Using the
  // same function here means the fixtures and the in-browser recompute can
  // never disagree on the scheme.
  const { root: merkleRoot, levelSizes } = recomputeRoot(
    cards.map((c) => ({
      tokenId: c.tokenId,
      salt: c.merkleSalt,
      valueInUsd: c.valueInUsd,
    })),
  );

  const gBlockTimestamp = BASE_TS + tsOffset + setId * 86_400;
  const gBlockHash = rand(32);
  const gBlockNumber = blockBase + setId * 1_200;
  const genesis = {
    algorithm: "Fair Set Adaptive Algorithm",
    attempts: 1 + (setId % 3),
    triggerTime: new Date((gBlockTimestamp + 42) * 1000).toISOString(),
    blockNumber: gBlockNumber,
    blockHash: gBlockHash,
    onChainPackId,
    // α = keccak256(tag ‖ blockHash ‖ blockNumber₃₂ ‖ packId ‖ setId₃₂).
    seed: deriveGenSeed(gBlockHash, gBlockNumber, onChainPackId, setId),
  };

  // Production ordering: lineup sorted by tokenId ASC, sampled without replacement.
  const eligible = [...cards].sort((a, b) =>
    BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1,
  );

  const drawPlan = drawPlanFor(def, setId, cards.length);
  const draws = [];
  for (let ordinal = 1; ordinal <= drawPlan; ordinal++) {
    const checkoutId = nextCheckoutId++;
    const blockHash = rand(32);
    const { proof, randomness } = evaluate(checkoutId, blockHash, onChainPackId);
    const index = deriveEligibleIndex(randomness, eligible.length);
    const [picked] = eligible.splice(index, 1);
    picked!.status = ordinal % 3 === 0 ? "token-released" : "token-assigned";

    const isDemo =
      def.packId === DEMO.packId &&
      setId === DEMO.setId &&
      ordinal === DEMO.drawOrdinal;
    draws.push({
      checkoutId,
      setDrawSequence: ordinal,
      txHash: isDemo ? DEMO_TX_HASH : rand(32),
      blockHash,
      randomness,
      proof,
      resolvedTokenId: picked!.tokenId,
      buyer: isDemo ? demoBuyer : rand(20),
    });
  }

  return {
    setId,
    status: drawPlan === 0
      ? "upcoming"
      : drawPlan === cards.length
        ? "completed"
        : "active",
    cardCount: cards.length,
    drawnCount: drawPlan,
    merkleRoot,
    merkleLevelSizes: levelSizes,
    genesis,
    cards,
    draws,
  };
  });

  return {
    packId: def.packId,
    onChainPackId,
    name: def.name,
    bgUrl: def.bgUrl,
    bgVideoUrl: def.bgVideoUrl,
    imgUrl: def.imgUrl,
    tvmAddress,
    sets,
  };
});

const demoDraw = packs.find((p) => p.packId === DEMO.packId)!.sets[
  DEMO.setId - 1
]!.draws[DEMO.drawOrdinal - 1]!;

const fixtures = {
  generatedNote:
    "Real ECVRF fixtures — proofs verify against vrfPublicKeyHex. Regenerate with pnpm generate-fixtures.",
  vrf: { suite: "ECVRF-EDWARDS25519-SHA512-ELL2", publicKeyHex: vrfPublicKeyHex },
  packs,
  demoPackId: DEMO.packId,
  demoTxHash: demoDraw.txHash,
  demoBuyer,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "../lib/api/fixtures.json");
writeFileSync(out, JSON.stringify(fixtures));
console.log(`fixtures written → ${out}`);
console.log(`demo tx hash (live set): ${demoDraw.txHash}`);
console.log(`vrf public key: ${vrfPublicKeyHex}`);
