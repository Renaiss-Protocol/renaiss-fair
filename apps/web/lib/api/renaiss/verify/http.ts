/**
 * The public fair/verify surface — every route in this directory lives under
 *
 *   {NEXT_PUBLIC_RENAISS_API_URL}/v0/fair
 *
 * This client owns that prefix; the per-endpoint modules (get-packs,
 * get-packing, …) pass only their own tail path (REST-style — record ids
 * ride in the path, only paging stays in the query). All endpoints are
 * public, unauthenticated, CORS *; money fields are raw integers with 2
 * implied decimals (display divides by 100 — see lib/format.ts).
 */
import { fetchJson } from "../http";

const FAIR_PREFIX = "/v0/fair";

export const verifyFetch = <T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> => fetchJson<T>(`${FAIR_PREFIX}${path}`, params);

/** The v1 surface — same wire rules; only what has no v0 twin lives here
 * (the active-set root lookup). The browse lists stay on v0. */
const FAIR_PREFIX_V1 = "/v1/fair";

export const verifyFetchV1 = <T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> => fetchJson<T>(`${FAIR_PREFIX_V1}${path}`, params);

/** Shared list-endpoint pagination envelope. */
export interface WirePagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
