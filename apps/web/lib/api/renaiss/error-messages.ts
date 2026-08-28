/**
 * Reader-facing messages for the coded errors the API returns (the
 * { "error", "code" } envelope — see ApiError in ./http.ts). One JSON file
 * per locale, keyed by error code; adding a language is a new
 * error-messages.<locale>.json plus one entry in MESSAGES.
 */
import { ApiError } from "./http";
import en from "./error-messages.en.json";

const MESSAGES: Record<string, Record<string, string>> = { en };

/** The message for a coded API error, or undefined when the code has no
 *  entry — callers keep their own generic fallback. */
export function apiErrorMessage(e: unknown, locale = "en"): string | undefined {
  return e instanceof ApiError ? MESSAGES[locale]?.[e.code] : undefined;
}
