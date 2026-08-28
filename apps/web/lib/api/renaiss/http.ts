/**
 * Renaiss API transport. NEXT_PUBLIC_RENAISS_API_URL is the bare host (e.g.
 * https://api.example.com) — route prefixes such as /v0/fair belong to the
 * per-surface clients (see ./verify/http.ts), never to the env var.
 */
import { RENAISS_API_URL } from "@/lib/config";

/**
 * How long a request may stall before it is treated as failed.
 *
 * A request that never settles is worse than one that fails: every caller
 * renders a loading state while the promise is pending, so a phone that
 * cannot reach the API sits on "Loading…" forever, indistinguishable from
 * still-loading and with nothing in the console to say otherwise. Failing
 * loudly turns that into an error the reader can act on.
 */
const TIMEOUT_MS = 15_000;

/** A non-2xx response that carried the apps/api error envelope
 * ({ "error": "<msg>", "code": "<CODE>" }) — the code is machine-matchable
 * while the message stays the server's human-readable text. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  if (!RENAISS_API_URL)
    throw new Error("NEXT_PUBLIC_RENAISS_API_URL is not set");
  const url = new URL(`${RENAISS_API_URL}${path}`);
  for (const [k, v] of Object.entries(params))
    url.searchParams.set(k, String(v));
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // wants Safari 16.4, and this runs on whatever phone the reader happens to
  // hold. The timer spans the body read too — a response can stall mid-stream.
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: control.signal });
    if (!res.ok) {
      // apps/api error convention: { "error": "<msg>", "code": "<CODE>" }.
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (body?.code) throw new ApiError(body.code, body.error ?? body.code);
      throw new Error(body?.error ?? `${path} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (control.signal.aborted)
      throw new Error(`${path} → no response after ${TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
