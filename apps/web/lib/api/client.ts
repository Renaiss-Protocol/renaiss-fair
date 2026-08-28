/**
 * API client. Each function serves the committed demo fixtures
 * (fixtures.json) until NEXT_PUBLIC_RENAISS_API_URL selects the real
 * Renaiss API (lib/api/renaiss) at build time — see lib/config.ts. The
 * demo rip's txHash is a real production rip, so in API mode the rip
 * lookups skip the fixtures entirely and resolve it live; only mock mode
 * reads the fixture world. The set-detail reads still route per pack id:
 * fixture packs answer from fixtures, on-chain ids hit /verify/sets/set.
 */
import { USE_MOCK_DATA } from "@/lib/config";
import { merkleProofOf } from "@/lib/merkle";
import { listPacks as apiListPacks } from "./renaiss/verify/get-packs";
import { fetchRip, type RipLookup } from "./renaiss/verify/get-rip";
import { fetchSetDetail } from "./renaiss/verify/get-sets-detail";
import fixtures from "./fixtures.json";
import type {
  DrawWitness,
  LineupCard,
  PackSummary,
  SetProvenanceData,
  SetSummary,
  TxLookupResult,
  VrfPublicKey,
} from "./types";

const LATENCY_MS = 450;
const delay = <T>(v: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), LATENCY_MS));

type FixturePack = (typeof fixtures.packs)[number];

const findPack = (packId: string): FixturePack | undefined =>
  fixtures.packs.find((p) => p.packId === packId);

const demoPack = findPack(fixtures.demoPackId)!;

/** The demo rip — a REAL production rip. API mode resolves it live; the
 * fixture world mirrors it under the same hash for mock mode. */
export const DEMO_TX_HASH: string = fixtures.demoTxHash;
/** The pack the demo rip belongs to — the default before any tx lookup. */
export const DEFAULT_PACK_ID: string = demoPack.packId;
/** bytes32 TVM pack id — part of the VRF seed preimage (v3-2). */
export const DEFAULT_ON_CHAIN_PACK_ID: string = demoPack.onChainPackId;

/** The demo draw key — mock replays and the (still fixture-only) Prove-it
 * flow. API-mode draws each carry their own publicKeyHex on the wire, so
 * nothing in API mode reads a global key anymore. */
export function getVrfPublicKey(): Promise<VrfPublicKey> {
  return delay(fixtures.vrf as VrfPublicKey);
}

/** Every verifiable pack — the demo pack (holding the demo rip) listed first. */
export const allPacks: PackSummary[] = fixtures.packs.map((p) => ({
  packId: p.packId,
  onChainPackId: p.onChainPackId,
  name: p.name,
  status: p.sets.every((s) => s.status === "completed")
    ? ("completed" as const)
    : ("live" as const),
  setCount: p.sets.length,
  drawnSetCount: p.sets.filter((s) => s.status === "completed").length,
  bgUrl: p.bgUrl,
  bgVideoUrl: p.bgVideoUrl,
  imgUrl: p.imgUrl,
}));

export function listPacks(): Promise<PackSummary[]> {
  if (!USE_MOCK_DATA) return apiListPacks();
  return delay(allPacks);
}

/**
 * Prove-it's one lookup. API mode asks the live /verify/rip and nothing
 * else — the demo tx is a real rip there. Mock mode scans the fixture
 * world, with the Merkle inclusion path computed locally from the fixture
 * lineup. null ⇒ the tx is unknown everywhere asked.
 */
export function lookupRip(txHash: string): Promise<RipLookup | null> {
  if (!USE_MOCK_DATA) return fetchRip(txHash);
  const needle = txHash.trim().toLowerCase();
  for (const pack of fixtures.packs) {
    for (const set of pack.sets) {
      const draw = set.draws.find((d) => d.txHash.toLowerCase() === needle);
      if (draw) return delay(fixtureRip(pack, set, draw));
    }
  }
  return delay(null);
}

type FixtureSet = FixturePack["sets"][number];
type FixtureDraw = FixtureSet["draws"][number];

function fixtureRip(
  pack: FixturePack,
  set: FixtureSet,
  draw: FixtureDraw,
): RipLookup {
  const cards = set.cards as LineupCard[];
  const card = cards.find((c) => c.tokenId === draw.resolvedTokenId)!;
  const leaves = cards.map((c) => ({
    tokenId: c.tokenId,
    salt: c.merkleSalt ?? "0x0",
    valueInUsd: c.valueInUsd,
  }));
  return {
    txHash: draw.txHash,
    buyer: draw.buyer,
    pack: {
      packId: pack.packId,
      onChainPackId: pack.onChainPackId,
      name: pack.name,
    },
    setId: set.setId,
    setStatus: set.status === "completed" ? "completed" : "active",
    merkleRoot: set.merkleRoot,
    draws: [
      {
        // The fixture world signs everything with the one demo key.
        witness: { ...toWitness(draw), publicKeyHex: fixtures.vrf.publicKeyHex },
        card,
        merkleProof: merkleProofOf(leaves, card.tokenId) ?? [],
      },
    ],
    // Fixtures are never sealed — the demo rip always walks the full
    // Tier B replay, even in its "active" set.
    replay: {
      lineupTokenIds: cards.map((c) => c.tokenId),
      priorDraws: set.draws
        .filter((d) => d.checkoutId < draw.checkoutId)
        .map(toWitness),
    },
  };
}

export function lookupTx(txHash: string): Promise<TxLookupResult | null> {
  // Fixture-only legacy read (flow-diagram's ProofMachine). In API mode the
  // demo tx is a live rip — answering it from the fixture world here would
  // pair fixture legacy data with the live lookupRip result.
  if (!USE_MOCK_DATA) return Promise.resolve(null);
  const needle = txHash.trim().toLowerCase();
  for (const pack of fixtures.packs) {
    for (const set of pack.sets) {
      const draw = set.draws.find((d) => d.txHash.toLowerCase() === needle);
      if (draw) {
        return delay({
          txHash: draw.txHash,
          buyer: draw.buyer,
          pack: {
            packId: pack.packId,
            onChainPackId: pack.onChainPackId,
            name: pack.name,
          },
          checkoutId: draw.checkoutId,
          blockHash: draw.blockHash,
          setId: set.setId,
          witness: toWitness(draw),
        });
      }
    }
  }
  return delay(null);
}

/** Fixture sets only — the API-mode Sets tab pages the server directly via
 * fetchSetsPage (lib/api/renaiss/verify/get-sets); Prove-it still browses
 * the demo pack through here. */
export function listSets(packId: string): Promise<SetSummary[]> {
  return delay(
    (findPack(packId)?.sets ?? []).map(
      ({ setId, status, cardCount, drawnCount }) => ({
        setId,
        status: status as SetSummary["status"],
        cardCount,
        drawnCount,
      }),
    ),
  );
}

/**
 * The three set-detail reads below serve fixtures for fixture packs (mock
 * mode, and Prove-it's demo pack either way); any other pack id is an
 * on-chain id, answered from ONE cached /verify/sets/set fetch — the
 * expanded row's three consumers share the request.
 */
export function getSetLineup(
  packId: string,
  setId: number,
): Promise<LineupCard[]> {
  const pack = findPack(packId);
  if (!pack) return fetchSetDetail(packId, setId).then((d) => d.lineup);
  const set = pack.sets.find((s) => s.setId === setId);
  return delay((set?.cards ?? []) as LineupCard[]);
}

export function getSetDrawHistory(
  packId: string,
  setId: number,
): Promise<DrawWitness[]> {
  const pack = findPack(packId);
  if (!pack) return fetchSetDetail(packId, setId).then((d) => d.draws);
  const set = pack.sets.find((s) => s.setId === setId);
  return delay((set?.draws ?? []).map(toWitness));
}

export function getSetProvenance(
  packId: string,
  setId: number,
): Promise<SetProvenanceData | null> {
  const pack = findPack(packId);
  if (!pack)
    return fetchSetDetail(packId, setId).then((d) => d.provenance);
  const set = pack.sets.find((s) => s.setId === setId);
  if (!set) return delay(null);
  return delay({
    merkleRoot: set.merkleRoot,
    genesis: set.genesis,
    leaves: set.cards.map((c) => ({
      tokenId: c.tokenId,
      salt: c.merkleSalt,
      valueInUsd: c.valueInUsd,
    })),
  });
}

function toWitness(draw: {
  checkoutId: number;
  setDrawSequence: number;
  blockHash: string;
  randomness: string;
  proof: string;
  resolvedTokenId: string;
}): DrawWitness {
  const { checkoutId, setDrawSequence, blockHash, randomness, proof, resolvedTokenId } = draw;
  return { checkoutId, setDrawSequence, blockHash, randomness, proof, resolvedTokenId };
}
