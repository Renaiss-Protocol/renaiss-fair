/**
 * Full endpoint: GET {NEXT_PUBLIC_RENAISS_API_URL}/v1/fair/active-sets/{merkleRoot}
 *
 * The ?root= deep link's lookup — which machine's ACTIVE set carries this
 * availability merkle root. The server answers only while the root is the
 * live commitment: once a newer set supersedes it (or the set sells out) the
 * lookup 404s, so a stale link resolves to nothing rather than to a set the
 * browse lists no longer carry. Edge-cached 60s.
 */
import { ApiError } from "../http";
import { verifyFetchV1 } from "./http";

interface WireActiveSetResponse {
  pack: {
    onChainPackId: string;
    vendingMachineAddress: string;
    name: string;
    tiers: { tier: string; name: string }[];
  };
  set: {
    status: "active";
    setId: number;
    packId: string;
    merkleRoot: string;
    algorithm: string;
  };
}

/** Where a live root points: the machine (?machine=) and its selling set. */
export interface ActiveSetLocation {
  machine: string;
  setId: number;
  packName: string;
}

/** null = the root is real syntax but no machine's live commitment (stale). */
export async function resolveActiveSet(
  merkleRoot: string,
): Promise<ActiveSetLocation | null> {
  try {
    const res = await verifyFetchV1<WireActiveSetResponse>(
      `/active-sets/${merkleRoot}`,
    );
    return {
      machine: res.pack.onChainPackId,
      setId: res.set.setId,
      packName: res.pack.name,
    };
  } catch (e) {
    if (e instanceof ApiError && e.code === "GACHA_V3_ACTIVE_SET_NOT_FOUND")
      return null;
    throw e;
  }
}
