/**
 * The shop's Next.js image optimizer — wraps a raw asset URL (blob storage)
 * in https://www.renaiss.xyz/_next/image?url={encoded}&w={w}&q={q} so the
 * browser downloads a resized, recompressed variant instead of the full
 * render.
 *
 * The optimizer only serves URLs/widths/qualities its next.config allows —
 * a disallowed request 400s (INVALID_IMAGE_OPTIMIZE_REQUEST). Renderers try
 * the optimized URL first and downgrade to the raw URL on error; the first
 * failure flips a session-wide switch so every later image skips the wasted
 * optimizer round-trip.
 */
const IMAGE_OPTIMIZER = "https://www.renaiss.xyz/_next/image";

export const optimizedImageUrl = (
  url: string,
  width = 640,
  quality = 73,
): string =>
  `${IMAGE_OPTIMIZER}?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`;

let optimizerDown = false;

/** An optimized URL failed to load — serve raw URLs for the session. */
export const markOptimizerDown = (): void => {
  optimizerDown = true;
};

export const isOptimizerDown = (): boolean => optimizerDown;
