/**
 * Client-side availability-root recomputation — mirrors the operator's
 * production tree (and the whitepaper §4.4) exactly:
 *
 *   leafᵢ  = keccak256(abi.encode(uint256 tokenIdᵢ, uint256 saltᵢ,
 *                                 uint256 valueInUsdᵢ))
 *   parent = keccak256(sorted sibling pair)   // OpenZeppelin-compatible
 *
 * Leaves are ordered by tokenId ASC and the tree is OpenZeppelin
 * SimpleMerkleTree's complete binary tree (leaves NOT re-sorted by hash), so
 * the root equals the vending-machine contract's merkleRoots(onChainPackId, setId).
 * Pure keccak over public data — nothing to trust.
 */
import { concat, keccak256, type Hex } from "viem";

export interface MerkleLeafInput {
  tokenId: string;
  salt: string;
  /** Construction-time integer value — committed in the leaf (§4.4). */
  valueInUsd: number;
}

export interface MerkleRecompute {
  leafCount: number;
  /** First few leaves, for display. */
  sampleLeaves: Hex[];
  /** Node counts per tree depth, deepest level first, root (1) last. */
  levelSizes: number[];
  root: Hex;
}

const word = (v: bigint): Hex =>
  `0x${v.toString(16).padStart(64, "0")}` as Hex;

/** abi.encode of three static uint256 values is their 32-byte words joined. */
export const computeLeaf = (l: MerkleLeafInput): Hex =>
  keccak256(
    concat([word(BigInt(l.tokenId)), word(BigInt(l.salt)), word(BigInt(l.valueInUsd))]),
  );

/** Commutative parent hash: keccak256 of the byte-wise sorted pair. */
const nodeHash = (a: Hex, b: Hex): Hex =>
  keccak256(concat(BigInt(a) < BigInt(b) ? [a, b] : [b, a]));

/** Fold a leaf up its sibling path to the root it belongs to — the Merkle
 * inclusion check (§4.4): the result equals the committed root iff the leaf
 * really was in the committed set. */
export const foldMerkleProof = (leaf: Hex, path: readonly string[]): Hex =>
  path.reduce<Hex>((node, sibling) => nodeHash(node, sibling as Hex), leaf);

/** OpenZeppelin SimpleMerkleTree layout: a complete binary tree stored in an
 * array of 2n−1 nodes — leaves written in REVERSE order at the tail, each
 * parent i hashing children (2i+1, 2i+2). Reproduced verbatim so the root
 * matches the operator's for any leaf count, power of two or not. */
function buildTree(leafHashes: Hex[]): Hex[] {
  const tree: Hex[] = new Array(2 * leafHashes.length - 1);
  for (let i = 0; i < leafHashes.length; i++) {
    tree[tree.length - 1 - i] = leafHashes[i]!;
  }
  for (let i = tree.length - 1 - leafHashes.length; i >= 0; i--) {
    tree[i] = nodeHash(tree[2 * i + 1]!, tree[2 * i + 2]!);
  }
  return tree;
}

/** A token's sibling path in the committed tree — what the API serves for a
 * rip; computed locally for fixture packs so the demo walks the identical
 * inclusion step. Empty array for a single-leaf tree; null if the token is
 * not in the lineup. */
export function merkleProofOf(
  leaves: MerkleLeafInput[],
  tokenId: string,
): Hex[] | null {
  const sorted = [...leaves].sort((a, b) =>
    BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1,
  );
  const leafIndex = sorted.findIndex((l) => l.tokenId === tokenId);
  if (leafIndex < 0) return null;
  const tree = buildTree(sorted.map(computeLeaf));
  const path: Hex[] = [];
  let i = tree.length - 1 - leafIndex;
  while (i > 0) {
    path.push(tree[i % 2 === 0 ? i - 1 : i + 1]!);
    i = (i - 1) >> 1;
  }
  return path;
}

export function recomputeRoot(leaves: MerkleLeafInput[]): MerkleRecompute {
  const sorted = [...leaves].sort((a, b) =>
    BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1,
  );
  const leafHashes = sorted.map(computeLeaf);
  const tree = buildTree(leafHashes);

  // Node counts per depth (a complete tree's leaves span the last two depths).
  const levelSizes: number[] = [];
  for (let d = 0; 2 ** d - 1 < tree.length; d++) {
    levelSizes.push(Math.min(2 ** d, tree.length - (2 ** d - 1)));
  }
  levelSizes.reverse();

  return {
    leafCount: sorted.length,
    sampleLeaves: leafHashes.slice(0, 3),
    levelSizes,
    root: tree[0]!,
  };
}
