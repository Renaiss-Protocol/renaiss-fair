/**
 * On-chain reads — the chain is the commitment, the API is convenience.
 *
 * The vending-machine contract's merkleRoots(onChainPackId, setId) is the root the
 * operator committed before the set's first rip; the Sets tab compares its
 * browser-recomputed root against THIS value (the served set.merkleRoot is
 * the operator's runtime recomputation — display/fallback only). Reads go
 * through NEXT_PUBLIC_RPC_URL against NEXT_PUBLIC_TVM_ADDRESS; with either
 * unset every lookup resolves null and callers degrade to the served root.
 */
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { RPC_URL, TVM_ADDRESS } from "./config";

const TVM_ABI = [
  {
    type: "function",
    name: "merkleRoots",
    stateMutability: "view",
    inputs: [
      { name: "packId", type: "bytes32" },
      { name: "setId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const ZERO_ROOT = `0x${"0".repeat(64)}`;

let client: PublicClient | null = null;
const clientOf = (): PublicClient | null => {
  if (RPC_URL === null || TVM_ADDRESS === null) return null;
  client ??= createPublicClient({ transport: http(RPC_URL) });
  return client;
};

/** Roots cached per (pack, set) — a committed root never changes. */
const rootCache = new Map<string, Promise<string | null>>();

/** Receipt facts cached per tx — a mined receipt never changes. */
const receiptCache = new Map<
  string,
  Promise<{ from: string; blockHash: string } | null>
>();

/**
 * The permitFund tx's receipt facts the verify API deliberately never
 * serves: the buyer (`tx.from` — rule 1.6, the client reads it itself) and
 * the receipt's own blockHash to cross-check the witness against. null when
 * the read is not configured or the RPC call fails (retried on next call).
 */
export function getTxReceiptFacts(
  txHash: string,
): Promise<{ from: string; blockHash: string } | null> {
  const rpc = clientOf();
  if (rpc === null) return Promise.resolve(null);
  const key = txHash.toLowerCase();
  const cached = receiptCache.get(key);
  if (cached) return cached;
  const p = rpc
    .getTransactionReceipt({ hash: txHash as Hex })
    .then((r) => ({ from: r.from as string, blockHash: r.blockHash as string }))
    .catch(() => {
      receiptCache.delete(key);
      return null;
    });
  receiptCache.set(key, p);
  return p;
}

/**
 * The committed availability root, or null when the read is not configured,
 * the RPC call fails (a failed read retries on the next call), or the
 * contract has no root for this set (unset mapping ⇒ zero word).
 */
export function getOnChainMerkleRoot(
  onChainPackId: string,
  setId: number,
): Promise<string | null> {
  const rpc = clientOf();
  if (rpc === null) return Promise.resolve(null);
  const key = `${onChainPackId}:${setId}`;
  const cached = rootCache.get(key);
  if (cached) return cached;
  const p = rpc
    .readContract({
      address: TVM_ADDRESS as Hex,
      abi: TVM_ABI,
      functionName: "merkleRoots",
      args: [onChainPackId as Hex, BigInt(setId)],
    })
    .then((root) => (root === ZERO_ROOT ? null : (root as string)))
    .catch(() => {
      rootCache.delete(key);
      return null;
    });
  rootCache.set(key, p);
  return p;
}
