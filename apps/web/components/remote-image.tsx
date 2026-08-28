"use client";

import Image from "next/image";
import { type ReactNode, useState } from "react";
import {
  isOptimizerDown,
  markOptimizerDown,
  optimizedImageUrl,
} from "@/lib/api/renaiss/image";

/**
 * Remote art with the app's standard load chain and a loading placeholder.
 *
 * Load chain per raw URL: shop-optimized variant → raw URL → the caller's
 * fallback (rendered INSTEAD of the frame, so each site keeps its own error
 * footprint). While the bytes are in flight the frame shows a translucent
 * slab (visible even on bg-raised surfaces like the pack listbox rows) with
 * the splash bar's loading-sweep; the image fades in over it on load.
 *
 * State tracks WHICH url downgraded/failed/loaded, not booleans — component
 * instances are reused as the shown token/pack changes, and a plain flag
 * would stick to whatever URL comes next.
 *
 * The frame must be sized by frameClassName (the img fills it), and every
 * call site parks it in a flex row, which keeps the span-based frame from
 * collapsing to inline metrics.
 */
export function RemoteImage({
  src,
  alt,
  width,
  height,
  sizes,
  frameClassName,
  imgClassName,
  placeholderClassName,
  fallback,
  ariaHidden,
}: {
  /** The raw asset URL (blob storage) — never a pre-optimized one. */
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string | undefined;
  /** Sizes the frame; the image fills it. */
  frameClassName: string;
  imgClassName: string;
  /** Rounding for the placeholder slab, matching the art's corners. */
  placeholderClassName: string;
  /** Rendered in place of the whole frame once both URLs have failed. */
  fallback: ReactNode;
  ariaHidden?: boolean | undefined;
}) {
  const [downgradedSrc, setDowngradedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const useOptimizer = !isOptimizerDown() && downgradedSrc !== src;
  const loaded = loadedSrc === src;

  if (failedSrc === src) return <>{fallback}</>;

  return (
    <span className={`relative ${frameClassName}`}>
      <span
        aria-hidden
        className={`absolute inset-0 overflow-hidden bg-white/[0.06] transition-opacity duration-300 ${
          loaded ? "opacity-0" : "opacity-100"
        } ${placeholderClassName}`}
      >
        {!loaded && (
          <span className="loading-sweep absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        )}
      </span>
      <Image
        src={useOptimizer ? optimizedImageUrl(src) : src}
        alt={alt}
        aria-hidden={ariaHidden}
        width={width}
        height={height}
        sizes={sizes}
        unoptimized
        className={`transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        } ${imgClassName}`}
        // A cached image can be complete before React attaches onLoad —
        // catch it at mount so it renders without a flash of shimmer.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0) setLoadedSrc(src);
        }}
        onLoad={() => setLoadedSrc(src)}
        onError={() => {
          if (useOptimizer) {
            markOptimizerDown(); // skip the wasted round-trip for later images
            setDowngradedSrc(src);
          } else {
            setFailedSrc(src);
          }
        }}
      />
    </span>
  );
}
