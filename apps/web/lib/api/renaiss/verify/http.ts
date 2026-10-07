/**
 * The public fair/verify surface — every route in this directory lives under
 *
 *   {NEXT_PUBLIC_RENAISS_API_URL}/v1/fair
 *
 * This client owns that prefix; the per-endpoint modules (get-packs,
 * get-packing, …) pass only their own tail path (REST-style — record ids
 * ride in the path, only paging stays in the query). All endpoints are
 * public, unauthenticated, CORS *; money fields are raw integers with 2
 * implied decimals (display divides by 100 — see lib/format.ts).
 *
 * The Packing tab reads the set-paged packings list: one row per set with a
 * `totalFailCount`, plus the per-set list of rejected runs.
 */
import { fetchJson } from "../http";

const FAIR_PREFIX = "/v1/fair";

export const verifyFetch = <T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> => fetchJson<T>(`${FAIR_PREFIX}${path}`, params);

/** The v1 surface, used by the active-set root lookup. */
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
