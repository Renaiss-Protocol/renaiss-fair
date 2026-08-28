/**
 * Data-source config — NEXT_PUBLIC_* so it is inlined at build time (the
 * site is a static export; switching modes means rebuilding).
 *
 * Set NEXT_PUBLIC_RENAISS_API_URL to the Renaiss API host (e.g.
 * https://api.example.com — no path; route prefixes like /v0/fair live in
 * lib/api/renaiss) to serve production data; unset ⇒ the mock client serves
 * the committed demo fixtures.
 */
export const RENAISS_API_URL: string | null =
  process.env["NEXT_PUBLIC_RENAISS_API_URL"]?.replace(/\/+$/, "") || null;

export const USE_MOCK_DATA: boolean = RENAISS_API_URL === null;

/**
 * On-chain root reads (API mode) — the published-root chip compares the
 * recomputed root against the vending-machine contract's merkleRoots(packId, setId)
 * read straight from the chain, the actual commitment. Both must be set;
 * otherwise the chip falls back to the API-served root (display-grade).
 */
export const RPC_URL: string | null =
  process.env["NEXT_PUBLIC_RPC_URL"] || null;

/** Vending-machine contract address (0x…, 20 bytes). */
export const TVM_ADDRESS: string | null =
  process.env["NEXT_PUBLIC_TVM_ADDRESS"] || null;

/**
 * RenaissRegistry — the NFT collection the drawn tokens live on (distinct
 * from the vending machine the verify API serves as
 * `pack.vendingMachineAddress`). The API doesn't serve this address yet, so
 * it is pinned here; move it onto the pack payload when it does. Defaults
 * to the chapel (BSC testnet) deployment.
 */
export const NFT_ADDRESS: string =
  process.env["NEXT_PUBLIC_NFT_ADDRESS"] ||
  "0x57eE95884Ac93E6d081Fd9366AFEF9891C8Eceb4";

/** Block explorer for the chain the registry is deployed on. */
export const EXPLORER_URL: string = (
  process.env["NEXT_PUBLIC_EXPLORER_URL"] || "https://testnet.bscscan.com"
).replace(/\/+$/, "");

/** Explorer page for one token — takes the DECIMAL token id (explorer NFT
 * routes use decimal, display uses hex via formatTokenId). */
export const nftExplorerUrl = (tokenId: string): string =>
  `${EXPLORER_URL}/nft/${NFT_ADDRESS}/${tokenId}`;
